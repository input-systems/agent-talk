import { describe, expect, it } from "vitest";
import { ASKED_AT, createAsk, EXPIRES_AT, minutesAfterAsk } from "./agentTalk.fixtures.js";
import {
    getAgentTalkAnswerResolution,
    getAgentTalkAskAutoUntil,
    getIsAgentTalkAskOpenToAgents,
    getIsAgentTalkStepFresh,
} from "./agentTalkFreshness.utils.js";

describe("getIsAgentTalkAskOpenToAgents", () => {
    it("lets an agent answer for an hour by default, then leaves it to a person", () => {
        const ask = createAsk();

        expect(getAgentTalkAskAutoUntil(ask).toISOString()).toBe("2026-11-20T11:00:00.000Z");
        expect(getIsAgentTalkAskOpenToAgents(ask, minutesAfterAsk(59))).toBe(true);
        expect(getIsAgentTalkAskOpenToAgents(ask, minutesAfterAsk(60))).toBe(false);
    });

    it("follows the signed autoUntil and never an ask meant for a person", () => {
        expect(getIsAgentTalkAskOpenToAgents(createAsk({ autoUntil: "2026-11-20T10:10:00.000Z" }), minutesAfterAsk(11))).toBe(false);
        expect(getIsAgentTalkAskOpenToAgents(createAsk({ answerBy: "person" }), minutesAfterAsk(1))).toBe(false);
    });

    it("leaves it to a person when a time does not parse", () => {
        expect(getIsAgentTalkAskOpenToAgents(createAsk({ autoUntil: "2026-99-99T99:99:99Z" }), minutesAfterAsk(1))).toBe(false);
        expect(getIsAgentTalkAskOpenToAgents(createAsk({ expires: "2026-99-99T99:99:99Z" }), minutesAfterAsk(1))).toBe(false);
    });
});

describe("getAgentTalkAnswerResolution", () => {
    const ask = createAsk();

    it("lets a signed answer inside the window take effect on its own", () => {
        expect(getAgentTalkAnswerResolution(ask, { via: "app" }, minutesAfterAsk(30))).toBe("auto");
        expect(getAgentTalkAnswerResolution(ask, {}, minutesAfterAsk(30))).toBe("auto");
    });

    it("has the asker's agent re-check a signed answer that came late", () => {
        expect(getAgentTalkAnswerResolution(ask, { via: "app" }, minutesAfterAsk(61))).toBe("recheck");
    });

    it("leaves an unsigned answer to the asker, however fast it came", () => {
        expect(getAgentTalkAnswerResolution(ask, { via: "link" }, minutesAfterAsk(1))).toBe("confirm");
        expect(getAgentTalkAnswerResolution(ask, { via: "email" }, minutesAfterAsk(1))).toBe("confirm");
    });

    it("refuses any answer after the ask expired, or to an ask whose expiry does not parse", () => {
        const afterExpiry = new Date(EXPIRES_AT);

        expect(getAgentTalkAnswerResolution(ask, { via: "app" }, afterExpiry)).toBe("expired");
        expect(getAgentTalkAnswerResolution(ask, { via: "link" }, afterExpiry)).toBe("expired");
        expect(getAgentTalkAnswerResolution(createAsk({ expires: "2026-99-99T99:99:99Z" }), { via: "app" }, minutesAfterAsk(1))).toBe(
            "expired",
        );
    });
});

describe("getIsAgentTalkStepFresh", () => {
    it("accepts a step a few minutes old and refuses a replayed one", () => {
        expect(getIsAgentTalkStepFresh({ at: ASKED_AT }, minutesAfterAsk(4))).toBe(true);
        expect(getIsAgentTalkStepFresh({ at: ASKED_AT }, minutesAfterAsk(6))).toBe(false);
        expect(getIsAgentTalkStepFresh({ at: ASKED_AT }, minutesAfterAsk(-6))).toBe(false);
        expect(getIsAgentTalkStepFresh({ at: "yesterday" }, minutesAfterAsk(0))).toBe(false);
    });
});
