import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentTalkPublicKeyResolver, AgentTalkSignedStep, AgentTalkUnsignedStep } from "../../src/agentTalk.types.js";
import { formatAgentTalkStepBlock, readAgentTalkStepBlock } from "../../src/agentTalkBlock.utils.js";
import { createAgentTalkDirectBody, getAgentTalkDirectOutcome, readAgentTalkDirectBody } from "../../src/agentTalkDirect.utils.js";
import {
    formatAgentTalkHeader,
    formatAgentTalkLinkHeader,
    parseAgentTalkHeader,
    parseAgentTalkLinkHeader,
} from "../../src/agentTalkHeader.utils.js";
import { getCanonicalJson } from "../../src/agentTalkJson.utils.js";
import { encodeJwsSegment, importAgentTalkPublicKeyJwk, importAgentTalkSigningKeyJwk, signJws } from "../../src/agentTalkJws.utils.js";
import {
    readAgentTalkServiceDocument,
    signAgentTalkServiceDocument,
    verifyAgentTalkServiceDocument,
} from "../../src/agentTalkServiceDocument.utils.js";
import type { AgentTalkServiceDocument } from "../../src/agentTalkServiceDocument.utils.js";
import { checkAgentTalkServiceToken } from "../../src/agentTalkServiceToken.utils.js";
import { signAgentTalkStep, verifyAgentTalkStep } from "../../src/agentTalkStep.utils.js";
import { checkAgentTalkLinkToken, checkAgentTalkPresenceToken, checkAgentTalkToken } from "../../src/agentTalkToken.utils.js";

// runs every vector in this folder through the reference implementation, so the vectors and the code cannot drift apart.
// regenerate with `pnpm vectors:generate` after a deliberate change

type KeyReference = { iss: string; kid: string };
type Jwk = JsonWebKey & { kid: string };
type VectorFile<T> = { description: string; version: number; cases: (T & { name: string; description: string })[] };

type KeyCase = { issuer: string; isRecognised: boolean; publicJwks: { keys: Jwk[] }; testOnlyPrivateJwk: Jwk };
type CanonicalCase = { inputJson: string; expected: { canonical: string } | { error: true } };
type StepSignatureCase =
    | {
          kind: "sign";
          signer: string;
          step: AgentTalkUnsignedStep;
          expected: { protectedHeader: Record<string, unknown>; canonicalPayload: string; signingInput: string; sig: string };
      }
    | { kind: "verify"; step: AgentTalkSignedStep; issuer: string; receiverKeys: KeyReference[]; expected: { isValid: boolean } };
type TokenCase = { token: string; from: string | null; now: string; receiverKeys: KeyReference[]; signer?: string; expected: unknown };
type ServiceTokenCase = { token: string; audience: string; now: string; receiverKeys: KeyReference[]; signer?: string; expected: unknown };
type HeaderCase =
    | { kind: "format"; input: { presence?: string; talk?: string }; expected: { value: string; length: number } }
    | { kind: "parse"; input: string; expected: unknown }
    | { kind: "formatLink"; input: string; expected: string }
    | { kind: "parseLink"; input: string; expected: string | null };
type BlockCase =
    | { kind: "format"; input: { token: string; step: AgentTalkSignedStep }; expected: string | null }
    | {
          kind: "read";
          email: { from: string; messageId: string; html: string; headerClaims?: { talk: string; step: string } };
          now: string;
          receiverKeys: KeyReference[];
          expected: unknown;
      };
type ServiceDocumentCase =
    | {
          kind: "sign";
          signer: string;
          document: AgentTalkServiceDocument;
          expected: { protectedHeader: Record<string, unknown>; canonicalPayload: string; signedDocument: Record<string, unknown> };
      }
    | { kind: "verify"; document: unknown; issuer: string; receiverKeys: KeyReference[]; expected: { isValid: boolean } }
    | { kind: "read"; document: unknown; expected: unknown };
type DirectBodyCase =
    | { kind: "create"; input: { step: AgentTalkSignedStep; door?: string }; expected: unknown }
    | { kind: "read"; body: unknown; expected: unknown }
    | { kind: "outcome"; status: number; body: unknown; expected: string };

const VECTORS_DIRECTORY = import.meta.dirname;

const readVectors = <T>(fileName: string): VectorFile<T> => {
    const vectors = JSON.parse(readFileSync(join(VECTORS_DIRECTORY, fileName), "utf8")) as VectorFile<T>;
    expect(vectors.version).toBe(1);
    expect(vectors.cases.length).toBeGreaterThan(0);
    return vectors;
};

const keyCases = readVectors<KeyCase>("keys.json").cases;

const getKeyCase = (issuer: string): KeyCase => {
    const keyCase = keyCases.find((candidate) => candidate.issuer === issuer);
    if (!keyCase) throw new Error(`no keys for ${issuer}`);
    return keyCase;
};

const getSigningKey = async (issuer: string) => await importAgentTalkSigningKeyJwk(getKeyCase(issuer).testOnlyPrivateJwk);

// a resolver over only the keys a case says the receiver holds
const createResolver =
    (held: KeyReference[]): AgentTalkPublicKeyResolver =>
    async (issuer, kid) => {
        if (!held.some((reference) => reference.iss === issuer && reference.kid === kid)) return null;
        const jwk = keyCases.find((candidate) => candidate.issuer === issuer)?.publicJwks.keys.find((key) => key.kid === kid);
        return jwk ? await importAgentTalkPublicKeyJwk(jwk) : null;
    };

const decodeSegment = (segment: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;

// a genuine signature is reproducible: ed25519 is deterministic, so signing the token's own header and payload again
// gives the same bytes
const expectReproducible = async (token: string, signer: string | undefined) => {
    if (signer === undefined) return;
    const [header = "", payload = ""] = token.split(".");
    const { privateKey } = await getSigningKey(signer);
    const decodedHeader = decodeSegment(header) as { alg: "EdDSA"; kid: string; typ?: string };

    expect(await signJws(decodeSegment(payload), decodedHeader, privateKey)).toBe(token);
};

describe("keys.json", () => {
    it.each(keyCases)("$name: the private key signs what the public key verifies", async (keyCase) => {
        const { d: _d, ...publicPart } = keyCase.testOnlyPrivateJwk;
        const [publicJwk] = keyCase.publicJwks.keys;

        expect(publicJwk).toMatchObject(publicPart);
        const message = new TextEncoder().encode("agent talk");
        const { privateKey } = await getSigningKey(keyCase.issuer);
        const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, message);

        await expect(
            crypto.subtle.verify({ name: "Ed25519" }, await importAgentTalkPublicKeyJwk(publicJwk ?? {}), signature, message),
        ).resolves.toBe(true);
    });
});

describe("canonical-json.json", () => {
    it.each(readVectors<CanonicalCase>("canonical-json.json").cases)("$name", ({ inputJson, expected }) => {
        const input: unknown = JSON.parse(inputJson);

        if ("error" in expected) {
            expect(() => getCanonicalJson(input)).toThrow();
        } else {
            expect(getCanonicalJson(input)).toBe(expected.canonical);
        }
    });
});

describe("step-signatures.json", () => {
    it.each(readVectors<StepSignatureCase>("step-signatures.json").cases)("$name", async (vector) => {
        switch (vector.kind) {
            case "sign": {
                const signingKey = await getSigningKey(vector.signer);
                const sig = await signAgentTalkStep(vector.step, signingKey);
                const [header = "", , signature = ""] = sig.split(".");

                expect(getCanonicalJson(vector.step)).toBe(vector.expected.canonicalPayload);
                expect(decodeSegment(header)).toEqual(vector.expected.protectedHeader);
                expect(`${header}.${encodeJwsSegment(vector.step)}`).toBe(vector.expected.signingInput);
                expect(sig).toBe(vector.expected.sig);
                expect(sig).toBe(`${header}..${signature}`);
                await expect(
                    verifyAgentTalkStep(
                        { ...vector.step, sig },
                        vector.signer,
                        createResolver([{ iss: vector.signer, kid: signingKey.kid }]),
                    ),
                ).resolves.toBe(true);
                return;
            }
            case "verify":
                await expect(verifyAgentTalkStep(vector.step, vector.issuer, createResolver(vector.receiverKeys))).resolves.toBe(
                    vector.expected.isValid,
                );
                return;
            default: {
                const unknownKind: never = vector;
                throw new Error(`unknown case ${JSON.stringify(unknownKind)}`);
            }
        }
    });
});

describe("presence-tokens.json", () => {
    it.each(readVectors<TokenCase>("presence-tokens.json").cases)("$name", async (vector) => {
        if (vector.from === null) throw new Error("a presence token is always checked against a From");

        const result = await checkAgentTalkPresenceToken({
            token: vector.token,
            from: vector.from,
            now: new Date(vector.now),
            getPublicKey: createResolver(vector.receiverKeys),
        });

        expect(result).toEqual(vector.expected);
        await expectReproducible(vector.token, vector.signer);
    });
});

describe("talk-tokens.json", () => {
    it.each(readVectors<TokenCase>("talk-tokens.json").cases)("$name", async (vector) => {
        const now = new Date(vector.now);
        const getPublicKey = createResolver(vector.receiverKeys);
        const result =
            vector.from === null
                ? await checkAgentTalkLinkToken({ token: vector.token, now, getPublicKey })
                : await checkAgentTalkToken({ token: vector.token, from: vector.from, now, getPublicKey });

        expect(result).toEqual(vector.expected);
        await expectReproducible(vector.token, vector.signer);
    });
});

describe("service-tokens.json", () => {
    it.each(readVectors<ServiceTokenCase>("service-tokens.json").cases)("$name", async (vector) => {
        const result = await checkAgentTalkServiceToken({
            token: vector.token,
            audience: vector.audience,
            now: new Date(vector.now),
            getPublicKey: createResolver(vector.receiverKeys),
        });

        expect(result).toEqual(vector.expected);
        await expectReproducible(vector.token, vector.signer);
    });
});

describe("headers.json", () => {
    it.each(readVectors<HeaderCase>("headers.json").cases)("$name", (vector) => {
        switch (vector.kind) {
            case "format": {
                const value = formatAgentTalkHeader(vector.input);
                expect(value).toBe(vector.expected.value);
                expect(value.length).toBe(vector.expected.length);
                return;
            }
            case "parse":
                expect(parseAgentTalkHeader(vector.input)).toEqual(vector.expected);
                return;
            case "formatLink":
                expect(formatAgentTalkLinkHeader(vector.input)).toBe(vector.expected);
                return;
            case "parseLink":
                expect(parseAgentTalkLinkHeader(vector.input)).toBe(vector.expected);
                return;
            default: {
                const unknownKind: never = vector;
                throw new Error(`unknown case ${JSON.stringify(unknownKind)}`);
            }
        }
    });
});

describe("blocks.json", () => {
    it.each(readVectors<BlockCase>("blocks.json").cases)("$name", async (vector) => {
        switch (vector.kind) {
            case "format":
                expect(formatAgentTalkStepBlock(vector.input)).toBe(vector.expected);
                return;
            case "read": {
                const { email } = vector;
                const result = await readAgentTalkStepBlock({
                    html: email.html,
                    from: email.from,
                    messageId: email.messageId,
                    ...(email.headerClaims ? { headerClaims: email.headerClaims } : {}),
                    now: new Date(vector.now),
                    getPublicKey: createResolver(vector.receiverKeys),
                });
                expect(result).toEqual(vector.expected);
                return;
            }
            default: {
                const unknownKind: never = vector;
                throw new Error(`unknown case ${JSON.stringify(unknownKind)}`);
            }
        }
    });
});

describe("service-documents.json", () => {
    it.each(readVectors<ServiceDocumentCase>("service-documents.json").cases)("$name", async (vector) => {
        switch (vector.kind) {
            case "sign": {
                const signed = await signAgentTalkServiceDocument(vector.document, await getSigningKey(vector.signer));
                const [signature] = signed.signatures;

                expect(getCanonicalJson(vector.document)).toBe(vector.expected.canonicalPayload);
                expect(decodeSegment(signature?.protected ?? "")).toEqual(vector.expected.protectedHeader);
                expect(signed).toEqual(vector.expected.signedDocument);
                return;
            }
            case "verify":
                await expect(
                    verifyAgentTalkServiceDocument(vector.document, vector.issuer, createResolver(vector.receiverKeys)),
                ).resolves.toBe(vector.expected.isValid);
                return;
            case "read":
                expect(readAgentTalkServiceDocument(vector.document)).toEqual(vector.expected);
                return;
            default: {
                const unknownKind: never = vector;
                throw new Error(`unknown case ${JSON.stringify(unknownKind)}`);
            }
        }
    });
});

describe("direct-bodies.json", () => {
    it.each(readVectors<DirectBodyCase>("direct-bodies.json").cases)("$name", (vector) => {
        switch (vector.kind) {
            case "create":
                expect(JSON.parse(JSON.stringify(createAgentTalkDirectBody(vector.input.step, vector.input.door)))).toEqual(
                    vector.expected,
                );
                return;
            case "read":
                expect(readAgentTalkDirectBody(vector.body)).toEqual(vector.expected);
                return;
            case "outcome":
                expect(getAgentTalkDirectOutcome(vector.status, vector.body)).toBe(vector.expected);
                return;
            default: {
                const unknownKind: never = vector;
                throw new Error(`unknown case ${JSON.stringify(unknownKind)}`);
            }
        }
    });
});
