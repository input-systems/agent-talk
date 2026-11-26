import { describe, expect, it } from "vitest";
import { createAsk, createKeys, ISSUER } from "./agentTalk.fixtures.js";
import type { AgentTalkUnsignedStep } from "./agentTalk.types.js";
import { getIsKnownAgentTalkStep, getIsKnownAgentTalkValue, signAgentTalkStep, verifyAgentTalkStep } from "./agentTalkStep.utils.js";

describe("step signing", () => {
    it("verifies a signed step regardless of the host's order", async () => {
        const { key, getPublicKey } = await createKeys();
        const unsigned = createAsk();
        const step = { ...unsigned, seq: 7, sig: await signAgentTalkStep(unsigned, key) };

        expect(await verifyAgentTalkStep(step, ISSUER, getPublicKey)).toBe(true);
        expect(await verifyAgentTalkStep({ ...step, seq: 8 }, ISSUER, getPublicKey)).toBe(true);
    });

    it("fails when any signed field changes", async () => {
        const { key, getPublicKey } = await createKeys();
        const unsigned = createAsk();
        const step = { ...unsigned, seq: 1, sig: await signAgentTalkStep(unsigned, key) };

        expect(await verifyAgentTalkStep({ ...step, by: { address: "krijn@example.com", actor: "person" } }, ISSUER, getPublicKey)).toBe(
            false,
        );
        expect(await verifyAgentTalkStep({ ...step, text: "Something else" }, ISSUER, getPublicKey)).toBe(false);
    });

    it("covers what the step says the message is", async () => {
        const { key, getPublicKey } = await createKeys();
        const unsigned = {
            id: "st_4",
            talk: "tk_2",
            at: "2026-11-21T10:00:00.000Z",
            by: { address: "orders@acme.com", actor: "agent" },
            text: "Order A-1042: €84.00, arriving Friday 27 November.",
            type: "say",
            about: { "@type": "Order", orderNumber: "A-1042" },
        } satisfies AgentTalkUnsignedStep;
        const step = { ...unsigned, sig: await signAgentTalkStep(unsigned, key) };

        expect(await verifyAgentTalkStep(step, ISSUER, getPublicKey)).toBe(true);
        expect(await verifyAgentTalkStep({ ...step, about: { "@type": "Order", orderNumber: "A-1043" } }, ISSUER, getPublicKey)).toBe(
            false,
        );
    });

    it("fails, without throwing, for a step nested too deep to have been signed", async () => {
        const { key, getPublicKey } = await createKeys();
        const unsigned = createAsk();
        const nested: unknown = JSON.parse(`${"[".repeat(15_000)}${"]".repeat(15_000)}`);
        const step = { ...unsigned, seq: 1, sig: await signAgentTalkStep(unsigned, key), extra: nested };

        expect(await verifyAgentTalkStep(step, ISSUER, getPublicKey)).toBe(false);
    });

    it("fails, without throwing, for a signature that is not one", async () => {
        const { key, getPublicKey } = await createKeys();
        const unsigned = createAsk();
        const [header = ""] = (await signAgentTalkStep(unsigned, key)).split(".");

        expect(await verifyAgentTalkStep({ ...unsigned, sig: `${header}..AA` }, ISSUER, getPublicKey)).toBe(false);
        expect(await verifyAgentTalkStep({ ...unsigned, sig: "not a signature" }, ISSUER, getPublicKey)).toBe(false);
    });
});

describe("getIsKnownAgentTalkStep and getIsKnownAgentTalkValue", () => {
    it("tell the types this version knows from the ones it only shows as text", () => {
        expect(getIsKnownAgentTalkStep({ type: "ask" })).toBe(true);
        expect(getIsKnownAgentTalkStep({ type: "x-vote" })).toBe(false);
        expect(getIsKnownAgentTalkStep({ type: "vote" })).toBe(false);
        expect(getIsKnownAgentTalkValue({ type: "time" })).toBe(true);
        expect(getIsKnownAgentTalkValue({ type: "x-boarding-pass" })).toBe(false);
        expect(getIsKnownAgentTalkValue({ type: "phone" })).toBe(false);
    });
});
