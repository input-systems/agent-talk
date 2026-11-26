import { describe, expect, it } from "vitest";
import type { AgentTalkPublicKeyResolver } from "./agentTalk.types.js";
import { signAgentTalkAgentCard, verifyAgentTalkAgentCard } from "./agentTalkAgentCard.utils.js";
import { generateAgentTalkSigningKeyPair } from "./agentTalkJws.utils.js";

describe("agent card signature", () => {
    it("verifies over the card in jcs without its signatures, and fails once the card changes", async () => {
        const pair = await generateAgentTalkSigningKeyPair();
        const getPublicKey: AgentTalkPublicKeyResolver = async (issuer, kid) =>
            await Promise.resolve(issuer === "peer.test" && kid === "k1" ? pair.publicKey : null);
        const card = await signAgentTalkAgentCard({ name: "Peer", version: "1", skills: [] }, { kid: "k1", privateKey: pair.privateKey });

        expect(card.signatures).toHaveLength(1);
        await expect(verifyAgentTalkAgentCard(card, "peer.test", getPublicKey)).resolves.toBe(true);
        // key order does not matter: the payload is canonical
        await expect(
            verifyAgentTalkAgentCard({ skills: [], signatures: card.signatures, version: "1", name: "Peer" }, "peer.test", getPublicKey),
        ).resolves.toBe(true);
        await expect(verifyAgentTalkAgentCard({ ...card, name: "Other" }, "peer.test", getPublicKey)).resolves.toBe(false);
        await expect(verifyAgentTalkAgentCard(card, "other.test", getPublicKey)).resolves.toBe(false);
        await expect(verifyAgentTalkAgentCard({ name: "Peer" }, "peer.test", getPublicKey)).resolves.toBe(false);
    });
});
