import { describe, expect, it } from "vitest";
import type { AgentTalkPublicKeyResolver } from "./agentTalk.types.js";
import { importAgentTalkPublicKeyJwk } from "./agentTalkJws.utils.js";
import { createAgentTalkReferenceParticipant } from "./agentTalkReferenceParticipant.js";
import {
    getAgentTalkDirectUrl,
    getAgentTalkDoorDocumentUrl,
    readAgentTalkServiceDocument,
    verifyAgentTalkServiceDocument,
} from "./agentTalkServiceDocument.utils.js";

const createNorth = async () => {
    const north = await createAgentTalkReferenceParticipant({ issuer: "north.test", address: "krijn@north.test" });
    const getPublicKey: AgentTalkPublicKeyResolver = async (issuer, kid) =>
        issuer === north.issuer && kid === north.publicKey.kid ? await importAgentTalkPublicKeyJwk(north.publicKey) : null;

    return { north, getPublicKey };
};

describe("agent talk service document", () => {
    it("verifies over the document in jcs without its signatures, only for its own issuer, and fails once it changes", async () => {
        const { north, getPublicKey } = await createNorth();
        const document = await north.getDocument();

        await expect(verifyAgentTalkServiceDocument(document, north.issuer, getPublicKey)).resolves.toBe(true);
        // key order does not matter: the payload is canonical
        const reordered = Object.fromEntries(Object.entries(document).toReversed());
        await expect(verifyAgentTalkServiceDocument(reordered, north.issuer, getPublicKey)).resolves.toBe(true);
        await expect(verifyAgentTalkServiceDocument({ ...document, name: "Other" }, north.issuer, getPublicKey)).resolves.toBe(false);
        await expect(verifyAgentTalkServiceDocument(document, "other.test", getPublicKey)).resolves.toBe(false);
        await expect(verifyAgentTalkServiceDocument({ ...document, signatures: [] }, north.issuer, getPublicKey)).resolves.toBe(false);
    });

    it("reads where direct steps go and where an address's door document is", async () => {
        const { north } = await createNorth();
        const document = readAgentTalkServiceDocument(await north.getDocument());
        if (!document) throw new Error("the document does not read");

        expect(getAgentTalkDirectUrl(document)).toBe("https://north.test/agent-talk/steps");
        expect(getAgentTalkDoorDocumentUrl(document, " Desk@North.test ")).toBe("https://north.test/agent-talk/doors/desk%40north.test");
        expect(getAgentTalkDirectUrl({ ...document, carriers: [] })).toBeNull();
    });

    it("ignores carriers it does not know and fields it does not define, and refuses a malformed document", async () => {
        const { north } = await createNorth();
        const document = await north.getDoorDocument("door_1");
        const withA2a = { ...document, carriers: [{ type: "a2a", url: "https://north.test/a2a" }, ...document.carriers], extra: true };

        expect(readAgentTalkServiceDocument(withA2a)).toMatchObject({ carriers: withA2a.carriers, door: { id: "door_1" } });
        expect(readAgentTalkServiceDocument(withA2a)).not.toHaveProperty("extra");
        const withQueue = { ...document, carriers: [{ type: "queue", url: "sqs://eu-west-1/north" }, { type: "x" }, ...document.carriers] };
        expect(readAgentTalkServiceDocument(withQueue)?.carriers).toEqual([
            { type: "queue", url: "sqs://eu-west-1/north" },
            ...document.carriers,
        ]);
        expect(readAgentTalkServiceDocument({ ...document, carriers: [{ type: "https", url: "http://north.test/steps" }] })).toBeNull();
        expect(readAgentTalkServiceDocument({ ...document, v: 2 })).toBeNull();
        expect(readAgentTalkServiceDocument({ ...document, keys: "http://north.test/keys.json" })).toBeNull();
        expect(readAgentTalkServiceDocument({ ...document, doors: "https://north.test/doors" })).toBeNull();
        expect(readAgentTalkServiceDocument({ ...document, door: { id: "door_1", address: "a@north.test", handles: [{}] } })).toBeNull();
    });
});
