import { AGENT_TALK_SIGNING_ALGORITHM, AGENT_TALK_STEP_TYPE, AGENT_TALK_VALUE_TYPE } from "./agentTalk.constants.js";
import type {
    AgentTalkPrivateType,
    AgentTalkPublicKeyResolver,
    AgentTalkSignedStep,
    AgentTalkSigningKey,
    AgentTalkStepEnvelope,
    AgentTalkUnsignedStep,
} from "./agentTalk.types.js";
import { decodeJws, encodeJwsSegment, signJws, verifyJws } from "./agentTalkJws.utils.js";

const KNOWN_STEP_TYPES: readonly string[] = Object.values(AGENT_TALK_STEP_TYPE);
const KNOWN_VALUE_TYPES: readonly string[] = Object.values(AGENT_TALK_VALUE_TYPE);

// a receiver shows only the text of a step or value whose type it does not know: a private one, or one a later
// version added. these narrow to the types this version does know
export const getIsKnownAgentTalkStep = <T extends { type: string }>(step: T): step is Exclude<T, { type: AgentTalkPrivateType }> =>
    KNOWN_STEP_TYPES.includes(step.type);

export const getIsKnownAgentTalkValue = <T extends { type: string }>(value: T): value is Exclude<T, { type: AgentTalkPrivateType }> =>
    KNOWN_VALUE_TYPES.includes(value.type);

const getSignedContent = (step: AgentTalkUnsignedStep | AgentTalkSignedStep): AgentTalkUnsignedStep => {
    const { seq: _seq, sig: _sig, ...content } = step as Partial<Pick<AgentTalkStepEnvelope, "seq" | "sig">> & AgentTalkUnsignedStep;
    return content;
};

// detached compact jws (rfc 7515 appendix f) over the canonical step without seq and sig
export const signAgentTalkStep = async (step: AgentTalkUnsignedStep, key: AgentTalkSigningKey): Promise<string> => {
    const jws = await signJws(getSignedContent(step), { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: key.kid }, key.privateKey);
    const [header = "", , signature = ""] = jws.split(".");

    return `${header}..${signature}`;
};

// null for a step with no canonical form (nested too deep, a number json cannot hold): nobody can have signed it
const getSignedPayload = (step: AgentTalkSignedStep): string | null => {
    try {
        return encodeJwsSegment(getSignedContent(step));
    } catch {
        return null;
    }
};

export const verifyAgentTalkStep = async (
    step: AgentTalkSignedStep,
    issuer: string,
    getPublicKey: AgentTalkPublicKeyResolver,
): Promise<boolean> => {
    const [header = "", detached, signature = ""] = step.sig.split(".");
    if (detached !== "") return false;

    const payload = getSignedPayload(step);
    if (payload === null) return false;

    const decoded = decodeJws(`${header}.${payload}.${signature}`);
    if (!decoded) return false;

    const publicKey = await getPublicKey(issuer, decoded.header.kid);
    if (!publicKey) return false;

    return await verifyJws(decoded, publicKey);
};
