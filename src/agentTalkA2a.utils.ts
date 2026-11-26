import {
    AGENT_TALK_A2A_EXTENSION_URI,
    AGENT_TALK_A2A_VERSION,
    AGENT_TALK_ANSWER_RESULT,
    AGENT_TALK_MEDIA_TYPE,
    AGENT_TALK_STEP_TYPE,
    AGENT_TALK_VERSION,
} from "./agentTalk.constants.js";
import type { AgentTalkSignedStep, AgentTalkSigningKey } from "./agentTalk.types.js";
import { signAgentTalkAgentCard } from "./agentTalkAgentCard.utils.js";
import { getIsJsonObject } from "./agentTalkJson.utils.js";

// the a2a 1.0 json-rpc binding of agent talk (protocol 9). names and enum spellings as the a2a 1.0 proto has them

export const A2A_HEADER = {
    VERSION: "A2A-Version",
    EXTENSIONS: "A2A-Extensions",
} as const;

export const A2A_METHOD = {
    SEND_MESSAGE: "SendMessage",
    GET_TASK: "GetTask",
} as const;

export const A2A_PROTOCOL_BINDING = "JSONRPC";

// json-rpc and a2a error codes (a2a 1.0, 5.4 and 9.5)
export const A2A_ERROR_CODE = {
    PARSE: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL: -32603,
    TASK_NOT_FOUND: -32001,
    UNSUPPORTED_OPERATION: -32004,
    EXTENSION_SUPPORT_REQUIRED: -32008,
    VERSION_NOT_SUPPORTED: -32009,
} as const;

export const A2A_ROLE = {
    USER: "ROLE_USER",
    AGENT: "ROLE_AGENT",
} as const;

export const A2A_TASK_STATE = {
    SUBMITTED: "TASK_STATE_SUBMITTED",
    WORKING: "TASK_STATE_WORKING",
    INPUT_REQUIRED: "TASK_STATE_INPUT_REQUIRED",
    COMPLETED: "TASK_STATE_COMPLETED",
    REJECTED: "TASK_STATE_REJECTED",
    CANCELED: "TASK_STATE_CANCELED",
} as const;

export type A2aTaskState = (typeof A2A_TASK_STATE)[keyof typeof A2A_TASK_STATE];

// the one answer for every step a receiver does not take, whatever the reason: an unknown address, no allowance, a service it
// does not recognise, a bad signature or token, a replay (rule 1: nothing is learned by asking)
export const AGENT_TALK_A2A_REFUSAL = { code: A2A_ERROR_CODE.UNSUPPORTED_OPERATION, message: "Not accepted" } as const;

// a json-rpc request body above this is refused before it is parsed further
export const AGENT_TALK_A2A_BODY_MAX_BYTES = 64 * 1024;

export type A2aPart = { text?: string; data?: unknown; mediaType?: string; metadata?: Record<string, unknown> };

export type A2aMessage = {
    messageId: string;
    contextId?: string;
    taskId?: string;
    role: (typeof A2A_ROLE)[keyof typeof A2A_ROLE];
    parts: A2aPart[];
    metadata?: Record<string, unknown>;
    extensions?: string[];
    referenceTaskIds?: string[];
};

export type A2aArtifact = { artifactId: string; parts: A2aPart[] };

export type A2aTask = {
    id: string;
    contextId: string;
    status: { state: A2aTaskState; timestamp: string };
    artifacts?: A2aArtifact[];
};

export type A2aSendMessageResult = { task: A2aTask } | { message: A2aMessage };

export type A2aJsonRpcError = { code: number; message: string };

export type A2aJsonRpcResponse =
    | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
    | { jsonrpc: "2.0"; id: string | number | null; error: A2aJsonRpcError };

// how a step travels in an a2a message: its id and talk as the message's, the step in words as a text part, the signed step
// whole in one data part. metadata says only which carrier it was; a receiver trusts nothing in it
export const createAgentTalkA2aMessage = (
    step: AgentTalkSignedStep,
    place: { taskId?: string; referenceTaskIds?: string[] } = {},
): A2aMessage => {
    const { seq: _seq, ...unnumbered } = step;

    return {
        messageId: step.id,
        contextId: step.talk,
        role: A2A_ROLE.USER,
        ...(place.taskId ? { taskId: place.taskId } : {}),
        ...(place.referenceTaskIds ? { referenceTaskIds: place.referenceTaskIds } : {}),
        extensions: [AGENT_TALK_A2A_EXTENSION_URI],
        parts: [{ text: step.text }, { data: { v: AGENT_TALK_VERSION, step: unnumbered }, mediaType: AGENT_TALK_MEDIA_TYPE }],
        metadata: { [AGENT_TALK_A2A_EXTENSION_URI]: { carrier: "a2a" } },
    };
};

// the signed step a message carries, still to be validated and verified, or null: exactly one agent talk data part of this
// version, whose step names the message's id and context
export const readAgentTalkA2aMessage = (message: unknown): { step: unknown } | null => {
    if (!getIsJsonObject(message) || !Array.isArray(message.parts)) return null;
    const dataParts = message.parts.filter(
        (part): part is { data: Record<string, unknown> } =>
            getIsJsonObject(part) && part.mediaType === AGENT_TALK_MEDIA_TYPE && getIsJsonObject(part.data),
    );
    const [part] = dataParts;
    if (dataParts.length !== 1 || !part || part.data.v !== AGENT_TALK_VERSION || !getIsJsonObject(part.data.step)) return null;

    const { step } = part.data;
    if (step.id !== message.messageId || step.talk !== message.contextId) return null;

    return { step };
};

// the task an ask opens at its receiver, or moves to with a later step on it: the receiver's view, never the host's verdict
export const getAgentTalkA2aTaskState = (step: AgentTalkSignedStep): A2aTaskState => {
    switch (step.type) {
        case AGENT_TALK_STEP_TYPE.ASK:
            return A2A_TASK_STATE.SUBMITTED;
        case AGENT_TALK_STEP_TYPE.WAIT:
            return A2A_TASK_STATE.WORKING;
        case AGENT_TALK_STEP_TYPE.ANSWER:
            return step.result === AGENT_TALK_ANSWER_RESULT.DECLINED ? A2A_TASK_STATE.REJECTED : A2A_TASK_STATE.COMPLETED;
        case AGENT_TALK_STEP_TYPE.CLOSE:
            return A2A_TASK_STATE.CANCELED;
        case AGENT_TALK_STEP_TYPE.SAY:
        case AGENT_TALK_STEP_TYPE.HOLD:
        case AGENT_TALK_STEP_TYPE.RESUME:
            return A2A_TASK_STATE.WORKING;
        // a private step type another service defined: it moves nothing a receiver knows of
        default:
            return A2A_TASK_STATE.WORKING;
    }
};

// what SendMessage answers for a step the receiver took: a task for an ask (its id is the ask's) or a step on a task it holds,
// an acknowledging message for anything else
export const getAgentTalkA2aSendResult = (step: AgentTalkSignedStep, taskId: string | undefined, now: Date): A2aSendMessageResult => {
    const id = step.type === AGENT_TALK_STEP_TYPE.ASK ? step.id : taskId;
    if (id) return { task: { id, contextId: step.talk, status: { state: getAgentTalkA2aTaskState(step), timestamp: now.toISOString() } } };

    return {
        message: { messageId: `ack_${step.id}`, contextId: step.talk, role: A2A_ROLE.AGENT, parts: [{ text: "Received." }] },
    };
};

// an ask's task as its receiver holds it, read from the steps it holds (GetTask): its state is the last step on the ask, or a
// close of the talk, and an answer is the task's artifact, the signed step whole as a step in a message carries it. the
// receiver's view only: the host still judges the answer on its own clock (rule 12)
export const getAgentTalkA2aTask = (ask: AgentTalkSignedStep, steps: AgentTalkSignedStep[]): A2aTask => {
    const onAsk = steps.filter((step) => step.id !== ask.id && (step.re === ask.id || step.type === AGENT_TALK_STEP_TYPE.CLOSE));
    const answer = onAsk.findLast((step) => step.type === AGENT_TALK_STEP_TYPE.ANSWER);
    const close = onAsk.find((step) => step.type === AGENT_TALK_STEP_TYPE.CLOSE);
    const last = answer ?? close ?? onAsk.at(-1) ?? ask;
    const task: A2aTask = {
        id: ask.id,
        contextId: ask.talk,
        status: { state: getAgentTalkA2aTaskState(last), timestamp: last.at },
    };
    if (!answer) return task;

    const { seq: _seq, ...unnumbered } = answer;
    return {
        ...task,
        artifacts: [
            {
                artifactId: answer.id,
                parts: [{ text: answer.text }, { data: { v: AGENT_TALK_VERSION, step: unnumbered }, mediaType: AGENT_TALK_MEDIA_TYPE }],
            },
        ],
    };
};

// a GetTask call for an ask's task
export const createA2aGetTaskRequest = (id: string, taskId: string) => ({
    jsonrpc: "2.0" as const,
    id,
    method: A2A_METHOD.GET_TASK,
    params: { id: taskId },
});

export const createA2aJsonRpcRequest = (id: string, message: A2aMessage) => ({
    jsonrpc: "2.0" as const,
    id,
    method: A2A_METHOD.SEND_MESSAGE,
    params: { message },
});

export const createA2aJsonRpcError = (id: string | number | null, error: A2aJsonRpcError): A2aJsonRpcResponse => ({
    jsonrpc: "2.0",
    id,
    error: { code: error.code, message: error.message },
});

// the headers a service calls another's a2a endpoint with: its service token, the version, and the extension it speaks
export const getAgentTalkA2aRequestHeaders = (token: string): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    [A2A_HEADER.VERSION.toLowerCase()]: AGENT_TALK_A2A_VERSION,
    [A2A_HEADER.EXTENSIONS.toLowerCase()]: AGENT_TALK_A2A_EXTENSION_URI,
});

// the error the version and extension headers earn before anything else is read, or null when both are right. an absent
// version is a2a 0.3, which this binding does not speak
export const getAgentTalkA2aHeaderError = (headers: {
    version: string | undefined;
    extensions: string | undefined;
}): A2aJsonRpcError | null => {
    if (headers.version?.trim() !== AGENT_TALK_A2A_VERSION) {
        return { code: A2A_ERROR_CODE.VERSION_NOT_SUPPORTED, message: `A2A-Version ${AGENT_TALK_A2A_VERSION} is required` };
    }
    const extensions = (headers.extensions ?? "").split(",").map((uri) => uri.trim());
    if (!extensions.includes(AGENT_TALK_A2A_EXTENSION_URI)) {
        return { code: A2A_ERROR_CODE.EXTENSION_SUPPORT_REQUIRED, message: `The extension ${AGENT_TALK_A2A_EXTENSION_URI} is required` };
    }

    return null;
};

// one kind of request an open door handles, as an a2a skill
export type A2aSkill = { id: string; name: string; description: string; tags: string[] };

// a service's own agent card (protocol 9.1): its a2a endpoint, the agent talk extension with where its keys and its per-address
// cards are, the service token as its security scheme, and no skills: a service card lists nothing a person's agent can do.
// an open door's card (per address) is the same with the skills it handles and its `tenant`, the opaque id the endpoint routes
// the door's calls by. signed with the service's agent talk key over the card in jcs
export const createAgentTalkServiceCard = async (input: {
    name: string;
    description: string;
    version: string;
    providerOrganization: string;
    providerUrl: string;
    a2aUrl: string;
    keysUrl: string;
    addressCardUrl: string;
    key: AgentTalkSigningKey;
    skills?: A2aSkill[];
    tenant?: string;
}) =>
    await signAgentTalkAgentCard(
        {
            name: input.name,
            description: input.description,
            version: input.version,
            provider: { organization: input.providerOrganization, url: input.providerUrl },
            supportedInterfaces: [
                {
                    url: input.a2aUrl,
                    protocolBinding: A2A_PROTOCOL_BINDING,
                    protocolVersion: AGENT_TALK_A2A_VERSION,
                    ...(input.tenant ? { tenant: input.tenant } : {}),
                },
            ],
            capabilities: {
                streaming: false,
                pushNotifications: false,
                extensions: [
                    {
                        uri: AGENT_TALK_A2A_EXTENSION_URI,
                        description: "Agent talk: signed steps between people's agents, the same steps email carries.",
                        required: true,
                        params: { keys: input.keysUrl, addressCard: input.addressCardUrl },
                    },
                ],
            },
            securitySchemes: {
                agentTalkServiceToken: {
                    httpAuthSecurityScheme: {
                        scheme: "Bearer",
                        bearerFormat: "JWT",
                        description:
                            "An EdDSA JWT signed with the calling service's agent talk key: iss, aud (this endpoint), iat, exp (5 min), jti.",
                    },
                },
            },
            // no scopes: an empty list is left out, as a2a 1.0 canonicalization (8.4.1) drops an empty field no one requires
            securityRequirements: [{ schemes: { agentTalkServiceToken: {} } }],
            defaultInputModes: [AGENT_TALK_MEDIA_TYPE, "text/plain"],
            defaultOutputModes: [AGENT_TALK_MEDIA_TYPE, "text/plain"],
            skills: input.skills ?? [],
        },
        input.key,
    );
