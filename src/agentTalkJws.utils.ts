import { AGENT_TALK_SIGNING_ALGORITHM } from "./agentTalk.constants.js";
import type { AgentTalkSigningKey } from "./agentTalk.types.js";
import { getCanonicalJson, getIsJsonObject } from "./agentTalkJson.utils.js";

// compact jws (rfc 7515) with ed25519 through webcrypto, so node and the browser share one path

const ED25519 = "Ed25519";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type JwsHeader = { alg: typeof AGENT_TALK_SIGNING_ALGORITHM; kid: string; typ?: string };

export const toBase64Url = (bytes: Uint8Array): string => {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
    if (!/^[A-Za-z0-9_-]*$/.test(value)) {
        throw new TypeError("not base64url");
    }
    const padded = value
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
};

// one segment of a jws: the canonical json of a value, base64url. throws for a value with no canonical form
export const encodeJwsSegment = (value: unknown): string => toBase64Url(textEncoder.encode(getCanonicalJson(value)));

export const generateAgentTalkSigningKeyPair = async (): Promise<CryptoKeyPair> =>
    await crypto.subtle.generateKey({ name: ED25519 }, true, ["sign", "verify"]);

export const exportAgentTalkPublicKeyJwk = async (key: CryptoKey, kid: string): Promise<JsonWebKey & { kid: string }> => ({
    ...(await crypto.subtle.exportKey("jwk", key)),
    kid,
});

// a service's private signing key from its jwk. the kid names the key in every token and step it signs, so a
// receiver can find the matching public key
export const importAgentTalkSigningKeyJwk = async (jwk: JsonWebKey & { kid?: string }): Promise<AgentTalkSigningKey> => {
    if (!jwk.kid) throw new TypeError("a signing key needs a kid");

    return { kid: jwk.kid, privateKey: await crypto.subtle.importKey("jwk", jwk, { name: ED25519 }, false, ["sign"]) };
};

export const importAgentTalkPublicKeyJwk = async (jwk: JsonWebKey): Promise<CryptoKey> =>
    await crypto.subtle.importKey("jwk", jwk, { name: ED25519 }, true, ["verify"]);

export const signJws = async (payload: unknown, header: JwsHeader, privateKey: CryptoKey): Promise<string> => {
    const signingInput = `${encodeJwsSegment(header)}.${encodeJwsSegment(payload)}`;
    const signature = await crypto.subtle.sign({ name: ED25519 }, privateKey, textEncoder.encode(signingInput));
    return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
};

const isJwsHeader = (value: unknown): value is JwsHeader =>
    getIsJsonObject(value) && value.alg === AGENT_TALK_SIGNING_ALGORITHM && typeof value.kid === "string";

type DecodedJws = { header: JwsHeader; payload: unknown; signingInput: string; signature: Uint8Array<ArrayBuffer> };

// decodes without checking the signature; callers verify with the key the header's kid names
export const decodeJws = (token: string): DecodedJws | null => {
    const segments = token.split(".");
    if (segments.length !== 3) return null;

    const [headerSegment = "", payloadSegment = "", signatureSegment = ""] = segments;

    try {
        const header: unknown = JSON.parse(textDecoder.decode(fromBase64Url(headerSegment)));
        if (!isJwsHeader(header)) return null;

        return {
            header,
            payload: JSON.parse(textDecoder.decode(fromBase64Url(payloadSegment))),
            signingInput: `${headerSegment}.${payloadSegment}`,
            signature: fromBase64Url(signatureSegment),
        };
    } catch {
        return null;
    }
};

export const verifyJws = async (decoded: DecodedJws, publicKey: CryptoKey): Promise<boolean> =>
    await crypto.subtle.verify({ name: ED25519 }, publicKey, decoded.signature, textEncoder.encode(decoded.signingInput));
