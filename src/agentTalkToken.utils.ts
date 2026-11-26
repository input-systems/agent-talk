import {
    AGENT_TALK_LIMIT,
    AGENT_TALK_SIGNING_ALGORITHM,
    AGENT_TALK_VERSION,
    DAY_MS,
    MINUTE_MS,
    AGENT_TALK_TOKEN_REJECT_REASON,
} from "./agentTalk.constants.js";
import type {
    AgentTalkAddress,
    AgentTalkPresenceClaims,
    AgentTalkPublicKeyResolver,
    AgentTalkSigningKey,
    AgentTalkStepType,
    AgentTalkTokenClaims,
    AgentTalkTokenCheck,
    AgentTalkValueType,
} from "./agentTalk.types.js";
import { getIsJsonObject } from "./agentTalkJson.utils.js";
import { decodeJws, signJws, verifyJws } from "./agentTalkJws.utils.js";

const PRESENCE_TOKEN_TYPE = "agent-talk-presence";
const TALK_TOKEN_TYPE = "agent-talk-talk";

const normalizeAddress = (address: string): AgentTalkAddress => address.trim().toLowerCase();

const toSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

export const createAgentTalkPresenceToken = async (input: {
    issuer: string;
    address: string;
    accepts: AgentTalkStepType[];
    types: AgentTalkValueType[];
    isOpen?: boolean;
    now: Date;
    key: AgentTalkSigningKey;
}): Promise<string> => {
    const issuedAt = toSeconds(input.now);
    const claims: AgentTalkPresenceClaims = {
        v: AGENT_TALK_VERSION,
        iss: input.issuer,
        sub: normalizeAddress(input.address),
        acc: input.accepts,
        types: input.types,
        ...(input.isOpen === true ? { isOpen: true } : {}),
        iat: issuedAt,
        exp: issuedAt + (AGENT_TALK_LIMIT.PRESENCE_MAX_DAYS * DAY_MS) / 1000,
    };

    return await signJws(claims, { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: input.key.kid, typ: PRESENCE_TOKEN_TYPE }, input.key.privateKey);
};

export const createAgentTalkToken = async (input: {
    issuer: string;
    talkId: string;
    stepId: string;
    address: string;
    expiresAt: Date;
    now: Date;
    key: AgentTalkSigningKey;
}): Promise<string> => {
    const claims: AgentTalkTokenClaims = {
        v: AGENT_TALK_VERSION,
        iss: input.issuer,
        talk: input.talkId,
        step: input.stepId,
        sub: normalizeAddress(input.address),
        iat: toSeconds(input.now),
        exp: toSeconds(input.expiresAt),
    };

    return await signJws(claims, { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: input.key.kid, typ: TALK_TOKEN_TYPE }, input.key.privateKey);
};

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

const isPresenceClaims = (value: unknown): value is AgentTalkPresenceClaims =>
    getIsJsonObject(value) &&
    typeof value.v === "number" &&
    typeof value.iss === "string" &&
    typeof value.sub === "string" &&
    isStringArray(value.acc) &&
    isStringArray(value.types) &&
    (value.isOpen === undefined || typeof value.isOpen === "boolean") &&
    typeof value.iat === "number" &&
    typeof value.exp === "number";

const isTalkTokenClaims = (value: unknown): value is AgentTalkTokenClaims =>
    getIsJsonObject(value) &&
    typeof value.v === "number" &&
    typeof value.iss === "string" &&
    typeof value.talk === "string" &&
    typeof value.step === "string" &&
    typeof value.sub === "string" &&
    typeof value.iat === "number" &&
    typeof value.exp === "number";

const checkSignedToken = async <T extends { v: number; iss: string; sub: string; iat: number; exp: number }>(input: {
    token: string;
    type: string;
    isClaims: (value: unknown) => value is T;
    lifetimeMaxDays: number;
    // the sender the token has to name; undefined when it came from a link, which no sender carries
    from: string | undefined;
    now: Date;
    getPublicKey: AgentTalkPublicKeyResolver;
}): Promise<AgentTalkTokenCheck<T>> => {
    const decoded = decodeJws(input.token);
    if (!decoded || decoded.header.typ !== input.type || !input.isClaims(decoded.payload)) {
        return { isValid: false, reason: AGENT_TALK_TOKEN_REJECT_REASON.MALFORMED };
    }

    const claims = decoded.payload;
    const publicKey = await input.getPublicKey(claims.iss, decoded.header.kid);
    if (!publicKey) return { isValid: false, reason: AGENT_TALK_TOKEN_REJECT_REASON.UNKNOWN_KEY };
    if (!(await verifyJws(decoded, publicKey))) return { isValid: false, reason: AGENT_TALK_TOKEN_REJECT_REASON.BAD_SIGNATURE };
    if (claims.v !== AGENT_TALK_VERSION) return { isValid: false, reason: AGENT_TALK_TOKEN_REJECT_REASON.WRONG_VERSION };
    if (input.from !== undefined && claims.sub !== normalizeAddress(input.from))
        return { isValid: false, reason: AGENT_TALK_TOKEN_REJECT_REASON.FROM_MISMATCH };

    // a token dated ahead of now would stay good past its cap, so the cap is counted from a start that has come
    const now = toSeconds(input.now);
    if (claims.iat > now + (AGENT_TALK_LIMIT.TOKEN_CLOCK_SKEW_MINUTES * MINUTE_MS) / 1000) {
        return { isValid: false, reason: AGENT_TALK_TOKEN_REJECT_REASON.POST_DATED };
    }
    if (claims.exp - claims.iat > (input.lifetimeMaxDays * DAY_MS) / 1000)
        return { isValid: false, reason: AGENT_TALK_TOKEN_REJECT_REASON.TOO_LONG };
    if (!(now < claims.exp)) return { isValid: false, reason: AGENT_TALK_TOKEN_REJECT_REASON.EXPIRED };

    return { isValid: true, claims };
};

// the signature and the From match only; the caller still checks the mail was authenticated as From
// (an aligned dkim or spf pass, or its own send record) and that the token sat on the message itself
export const checkAgentTalkPresenceToken = async (input: {
    token: string;
    from: string;
    now: Date;
    getPublicKey: AgentTalkPublicKeyResolver;
}): Promise<AgentTalkTokenCheck<AgentTalkPresenceClaims>> =>
    await checkSignedToken({
        ...input,
        type: PRESENCE_TOKEN_TYPE,
        isClaims: isPresenceClaims,
        lifetimeMaxDays: AGENT_TALK_LIMIT.PRESENCE_MAX_DAYS,
    });

// names a talk and grants nothing: membership is checked with the talk's host. it dies with its ask, so a stale
// email is only an email again
export const checkAgentTalkToken = async (input: {
    token: string;
    from: string;
    now: Date;
    getPublicKey: AgentTalkPublicKeyResolver;
}): Promise<AgentTalkTokenCheck<AgentTalkTokenClaims>> =>
    await checkSignedToken({
        ...input,
        type: TALK_TOKEN_TYPE,
        isClaims: isTalkTokenClaims,
        lifetimeMaxDays: AGENT_TALK_LIMIT.ASK_EXPIRY_MAX_DAYS,
    });

// a talk token from an answer link: whoever holds the link may read the ask and answer it, so there is no sender to
// match. the caller still checks the step with the talk's host, and that `sub` asked it
export const checkAgentTalkLinkToken = async (input: {
    token: string;
    now: Date;
    getPublicKey: AgentTalkPublicKeyResolver;
}): Promise<AgentTalkTokenCheck<AgentTalkTokenClaims>> =>
    await checkSignedToken({
        ...input,
        from: undefined,
        type: TALK_TOKEN_TYPE,
        isClaims: isTalkTokenClaims,
        lifetimeMaxDays: AGENT_TALK_LIMIT.ASK_EXPIRY_MAX_DAYS,
    });
