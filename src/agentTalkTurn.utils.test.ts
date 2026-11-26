import { describe, expect, it } from "vitest";
import { getIsAgentTalkTurnLimitReached } from "./agentTalkTurn.utils.js";

const MAYA = "maya@example.com";
const MEMBER_ADDRESS = "krijn@example.com";

const createStep = (type: string, address = MAYA, actor: "agent" | "person" = "agent") => ({ type, by: { address, actor } });

describe("getIsAgentTalkTurnLimitReached", () => {
    it("stops an agent at 10 says, asks and answers since its person last acted", () => {
        const nine = Array.from({ length: 9 }, (_, index) => createStep(index % 2 === 0 ? "say" : "answer"));
        const ten = [...nine, createStep("ask")];

        expect(getIsAgentTalkTurnLimitReached(createStep("say"), nine)).toBe(false);
        expect(getIsAgentTalkTurnLimitReached(createStep("say"), ten)).toBe(true);
    });

    it("counts from its own person's last step, and never the other side's steps or waits, holds and closes", () => {
        const ten = Array.from({ length: 10 }, () => createStep("say"));

        expect(getIsAgentTalkTurnLimitReached(createStep("say"), [...ten, createStep("answer", MAYA, "person")])).toBe(false);
        expect(getIsAgentTalkTurnLimitReached(createStep("say"), [...ten, createStep("answer", MEMBER_ADDRESS, "person")])).toBe(true);
        const quiet = [...ten.slice(1), createStep("wait"), createStep("hold"), createStep("close"), createStep("say", MEMBER_ADDRESS)];
        expect(getIsAgentTalkTurnLimitReached(createStep("say"), quiet)).toBe(false);
    });

    it("never stops a person, or an agent's wait, hold, resume or close", () => {
        const ten = Array.from({ length: 10 }, () => createStep("say"));

        expect(getIsAgentTalkTurnLimitReached(createStep("say", MAYA, "person"), ten)).toBe(false);
        expect(getIsAgentTalkTurnLimitReached(createStep("wait"), ten)).toBe(false);
        expect(getIsAgentTalkTurnLimitReached(createStep("close"), ten)).toBe(false);
    });
});
