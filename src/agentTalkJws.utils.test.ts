import { describe, expect, it } from "vitest";
import { ISSUER, KID } from "./agentTalk.fixtures.js";
import {
    exportAgentTalkPublicKeyJwk,
    generateAgentTalkSigningKeyPair,
    importAgentTalkPublicKeyJwk,
    importAgentTalkSigningKeyJwk,
} from "./agentTalkJws.utils.js";
import { checkAgentTalkPresenceToken, createAgentTalkPresenceToken } from "./agentTalkToken.utils.js";

const NOW = new Date("2026-11-20T10:00:00.000Z");

describe("importAgentTalkSigningKeyJwk", () => {
    it("signs with a key loaded from its jwk and checks out against the published one", async () => {
        const pair = await generateAgentTalkSigningKeyPair();
        const privateJwk = { ...(await crypto.subtle.exportKey("jwk", pair.privateKey)), kid: KID };
        const publicKey = await importAgentTalkPublicKeyJwk(await exportAgentTalkPublicKeyJwk(pair.publicKey, KID));

        const key = await importAgentTalkSigningKeyJwk(privateJwk);
        const token = await createAgentTalkPresenceToken({
            issuer: ISSUER,
            address: "maya@example.com",
            accepts: [],
            types: ["text"],
            now: NOW,
            key,
        });
        const result = await checkAgentTalkPresenceToken({
            token,
            from: "maya@example.com",
            now: NOW,
            getPublicKey: () => Promise.resolve(publicKey),
        });

        expect(key.kid).toBe(KID);
        expect(result.isValid).toBe(true);
    });

    it("refuses a key with no id", async () => {
        const pair = await generateAgentTalkSigningKeyPair();

        await expect(importAgentTalkSigningKeyJwk(await crypto.subtle.exportKey("jwk", pair.privateKey))).rejects.toThrow("kid");
    });
});
