import { AGENT_TALK_LIMIT, AGENT_TALK_SIGNING_ALGORITHM, MINUTE_MS } from "./agentTalk.constants.js";
import type { AgentTalkPublicKeyResolver, AgentTalkSigningKey } from "./agentTalk.types.js";
import { getIsJsonObject } from "./agentTalkJson.utils.js";
import { decodeJws, signJws, verifyJws } from "./agentTalkJws.utils.js";

const SERVICE_TOKEN_TYPE = "JWT";

// a service token lives at most this long (protocol 9.3)
export const AGENT_TALK_SERVICE_TOKEN_LIFETIME_SECONDS = 5 * 60;

// the claims of the bearer a service calls another's direct url with: which service calls, the endpoint it is for, and an id
// the receiver remembers so the same token is never taken twice
export type AgentTalkServiceTokenClaims = { iss: string; aud: string; iat: number; exp: number; jti: string };

// why a service token does not count. local only: the caller hears the uniform refusal
export const AGENT_TALK_SERVICE_TOKEN_REJECT_REASON = {
    MALFORMED: "malformed",
    UNKNOWN_KEY: "unknownKey",
    BAD_SIGNATURE: "badSignature",
    WRONG_AUDIENCE: "wrongAudience",
    POST_DATED: "postDated",
    TOO_LONG: "tooLong",
    EXPIRED: "expired",
} as const;

export type AgentTalkServiceTokenRejectReason =
    (typeof AGENT_TALK_SERVICE_TOKEN_REJECT_REASON)[keyof typeof AGENT_TALK_SERVICE_TOKEN_REJECT_REASON];

export type AgentTalkServiceTokenCheck =
    | { isValid: true; claims: AgentTalkServiceTokenClaims; kid: string }
    | { isValid: false; reason: AgentTalkServiceTokenRejectReason };

const toSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

const isServiceTokenClaims = (value: unknown): value is AgentTalkServiceTokenClaims =>
    getIsJsonObject(value) &&
    typeof value.iss === "string" &&
    typeof value.aud === "string" &&
    typeof value.iat === "number" &&
    typeof value.exp === "number" &&
    typeof value.jti === "string" &&
    value.jti.length > 0 &&
    value.jti.length <= 128;

// a compact jws (EdDSA) a service signs with its agent talk key to call another service's direct url. no shared secret: the
// receiver already holds the key
export const createAgentTalkServiceToken = async (input: {
    issuer: string;
    audience: string;
    now: Date;
    key: AgentTalkSigningKey;
    jti?: string;
}): Promise<string> => {
    const issuedAt = toSeconds(input.now);
    const claims: AgentTalkServiceTokenClaims = {
        iss: input.issuer,
        aud: input.audience,
        iat: issuedAt,
        exp: issuedAt + AGENT_TALK_SERVICE_TOKEN_LIFETIME_SECONDS,
        jti: input.jti ?? crypto.randomUUID(),
    };

    return await signJws(claims, { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: input.key.kid, typ: SERVICE_TOKEN_TYPE }, input.key.privateKey);
};

// the signature by a key the receiver holds for the token's iss, the audience is this endpoint, and the token is current and
// short lived. the caller still checks the jti was not seen before
export const checkAgentTalkServiceToken = async (input: {
    token: string;
    audience: string;
    now: Date;
    getPublicKey: AgentTalkPublicKeyResolver;
}): Promise<AgentTalkServiceTokenCheck> => {
    const decoded = decodeJws(input.token);
    if (!decoded || decoded.header.typ !== SERVICE_TOKEN_TYPE || !isServiceTokenClaims(decoded.payload)) {
        return { isValid: false, reason: AGENT_TALK_SERVICE_TOKEN_REJECT_REASON.MALFORMED };
    }

    const claims = decoded.payload;
    const publicKey = await input.getPublicKey(claims.iss, decoded.header.kid);
    if (!publicKey) return { isValid: false, reason: AGENT_TALK_SERVICE_TOKEN_REJECT_REASON.UNKNOWN_KEY };
    if (!(await verifyJws(decoded, publicKey))) return { isValid: false, reason: AGENT_TALK_SERVICE_TOKEN_REJECT_REASON.BAD_SIGNATURE };
    if (claims.aud !== input.audience) return { isValid: false, reason: AGENT_TALK_SERVICE_TOKEN_REJECT_REASON.WRONG_AUDIENCE };

    const now = toSeconds(input.now);
    if (claims.iat > now + (AGENT_TALK_LIMIT.TOKEN_CLOCK_SKEW_MINUTES * MINUTE_MS) / 1000) {
        return { isValid: false, reason: AGENT_TALK_SERVICE_TOKEN_REJECT_REASON.POST_DATED };
    }
    if (claims.exp - claims.iat > AGENT_TALK_SERVICE_TOKEN_LIFETIME_SECONDS) {
        return { isValid: false, reason: AGENT_TALK_SERVICE_TOKEN_REJECT_REASON.TOO_LONG };
    }
    if (!(now < claims.exp)) return { isValid: false, reason: AGENT_TALK_SERVICE_TOKEN_REJECT_REASON.EXPIRED };

    return { isValid: true, claims, kid: decoded.header.kid };
};
