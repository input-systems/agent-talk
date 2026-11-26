import { AGENT_TALK_SIGNING_ALGORITHM } from "./agentTalk.constants.js";
import type { AgentTalkPublicKeyResolver, AgentTalkSigningKey } from "./agentTalk.types.js";
import { getIsJsonObject } from "./agentTalkJson.utils.js";
import { decodeJws, encodeJwsSegment, signJws, verifyJws } from "./agentTalkJws.utils.js";

// one signature over an agent card (a2a 1.0, 4.4.7 and 8.4): the protected header and the signature, base64url, over the card
// in jcs (rfc 8785) with `signatures` left out. the card itself is the payload and travels beside it
export type AgentTalkAgentCardSignature = { protected: string; signature: string; header?: Record<string, unknown> };

const CARD_SIGNATURE_TYPE = "JOSE";

const getUnsignedCard = (card: Record<string, unknown>): Record<string, unknown> => {
    const { signatures: _signatures, ...unsigned } = card;
    return unsigned;
};

// the card with one signature by this key, replacing any it had
export const signAgentTalkAgentCard = async <T extends Record<string, unknown>>(
    card: T,
    key: AgentTalkSigningKey,
): Promise<T & { signatures: AgentTalkAgentCardSignature[] }> => {
    const unsigned = getUnsignedCard(card);
    const jws = await signJws(unsigned, { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: key.kid, typ: CARD_SIGNATURE_TYPE }, key.privateKey);
    const [protectedHeader = "", , signature = ""] = jws.split(".");

    return { ...(unsigned as T), signatures: [{ protected: protectedHeader, signature }] };
};

// whether one of the card's signatures checks out against a key the caller holds for this issuer. a card with no signature, or
// one only by keys the caller does not hold, does not
export const verifyAgentTalkAgentCard = async (
    card: unknown,
    issuer: string,
    getPublicKey: AgentTalkPublicKeyResolver,
): Promise<boolean> => {
    if (!getIsJsonObject(card) || !Array.isArray(card.signatures)) return false;

    let payload: string;
    try {
        payload = encodeJwsSegment(getUnsignedCard(card));
    } catch {
        return false;
    }

    for (const signature of card.signatures.slice(0, 8)) {
        if (!getIsJsonObject(signature) || typeof signature.protected !== "string" || typeof signature.signature !== "string") continue;
        const decoded = decodeJws(`${signature.protected}.${payload}.${signature.signature}`);
        if (!decoded) continue;
        const publicKey = await getPublicKey(issuer, decoded.header.kid);
        if (publicKey && (await verifyJws(decoded, publicKey))) return true;
    }

    return false;
};
