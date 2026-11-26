import { AGENT_TALK_VERSION } from "./agentTalk.constants.js";
import type { AgentTalkSignedStep } from "./agentTalk.types.js";
import { getIsJsonObject } from "./agentTalkJson.utils.js";

// the direct carrier (protocol 9): one https post per step, the signed step whole in the body, the calling service's token in
// the authorization header. 202 when the receiver took it; one refusal for every step it did not take, whatever the reason

// a request body above this is refused before it is parsed further
export const AGENT_TALK_DIRECT_BODY_MAX_BYTES = 64 * 1024;

export const AGENT_TALK_DIRECT_STATUS = {
    TAKEN: 202,
    BAD_REQUEST: 400,
    REFUSED: 403,
} as const;

export const AGENT_TALK_DIRECT_ERROR = {
    NOT_ACCEPTED: "not_accepted",
    BAD_REQUEST: "bad_request",
    UNSUPPORTED_VERSION: "unsupported_version",
} as const;

// a door id longer than this is not one a document names
const DOOR_ID_MAX = 128;

export type AgentTalkDirectResponse = { status: number; body: Record<string, unknown> };

// the step was taken
export const AGENT_TALK_DIRECT_TAKEN: AgentTalkDirectResponse = { status: AGENT_TALK_DIRECT_STATUS.TAKEN, body: {} };

// the one answer for every step a receiver does not take, whatever the reason: an unknown address, no allowance, a service it
// does not recognise, a bad signature or token, a replay (rule 1: nothing is learned by asking)
export const AGENT_TALK_DIRECT_REFUSAL: AgentTalkDirectResponse = {
    status: AGENT_TALK_DIRECT_STATUS.REFUSED,
    body: { error: AGENT_TALK_DIRECT_ERROR.NOT_ACCEPTED },
};

const BAD_REQUEST: AgentTalkDirectResponse = {
    status: AGENT_TALK_DIRECT_STATUS.BAD_REQUEST,
    body: { error: AGENT_TALK_DIRECT_ERROR.BAD_REQUEST },
};

const UNSUPPORTED_VERSION: AgentTalkDirectResponse = {
    status: AGENT_TALK_DIRECT_STATUS.BAD_REQUEST,
    body: { error: AGENT_TALK_DIRECT_ERROR.UNSUPPORTED_VERSION, versions: [AGENT_TALK_VERSION] },
};

// the body a step travels in: the step whole, without `seq` (only its host numbers it), and the door it is for when a first ask
// goes to an open door, as the door's document names it
export const createAgentTalkDirectBody = (step: AgentTalkSignedStep, door?: string) => {
    const { seq: _seq, ...unnumbered } = step;

    return { v: AGENT_TALK_VERSION, step: unnumbered, ...(door ? { door } : {}) };
};

// the step a body carries, still to be validated and verified, and the door it names; or the answer to a body that is not one.
// a version this one does not speak is said as such, so a newer sender can step down; nothing else is told
export const readAgentTalkDirectBody = (
    body: unknown,
): { isValid: true; step: unknown; door: string | null } | { isValid: false; response: AgentTalkDirectResponse } => {
    if (!getIsJsonObject(body)) return { isValid: false, response: BAD_REQUEST };
    if (typeof body.v === "number" && body.v !== AGENT_TALK_VERSION) return { isValid: false, response: UNSUPPORTED_VERSION };
    if (body.v !== AGENT_TALK_VERSION || !getIsJsonObject(body.step)) return { isValid: false, response: BAD_REQUEST };
    if (body.door !== undefined && !(typeof body.door === "string" && body.door.length > 0 && body.door.length <= DOOR_ID_MAX)) {
        return { isValid: false, response: BAD_REQUEST };
    }

    return { isValid: true, step: body.step, door: typeof body.door === "string" ? body.door : null };
};

// the headers a service calls another's direct url with: its service token, bound to that url
export const getAgentTalkDirectRequestHeaders = (token: string): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
});

export const AGENT_TALK_DIRECT_OUTCOME = {
    TAKEN: "taken",
    REFUSED: "refused",
    FAILED: "failed",
} as const;

export type AgentTalkDirectOutcome = (typeof AGENT_TALK_DIRECT_OUTCOME)[keyof typeof AGENT_TALK_DIRECT_OUTCOME];

// how a call went, from its status and body: taken (2xx), refused (the uniform refusal), or failed (anything else, retried)
export const getAgentTalkDirectOutcome = (status: number, body: unknown): AgentTalkDirectOutcome => {
    if (status >= 200 && status < 300) return AGENT_TALK_DIRECT_OUTCOME.TAKEN;
    if (status === AGENT_TALK_DIRECT_STATUS.REFUSED && getIsJsonObject(body) && body.error === AGENT_TALK_DIRECT_ERROR.NOT_ACCEPTED) {
        return AGENT_TALK_DIRECT_OUTCOME.REFUSED;
    }

    return AGENT_TALK_DIRECT_OUTCOME.FAILED;
};
