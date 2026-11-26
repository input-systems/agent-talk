import { describe, expect, it } from "vitest";
import { getAgentTalkIntroducedBy, type AgentTalkIntroductionStep } from "./agentTalkIntroduction.utils.js";

const MEMBER_ADDRESS = "krijn@example.com";
const MAYA = "maya@example.com";
const SAM = "sam@example.com";
const STRANGER = "x@evil.test";

const samOption = { id: "o1", value: { type: "contact", address: SAM } };
const noOption = { id: "o2" };
const offer: AgentTalkIntroductionStep = {
    type: "ask",
    id: "ask-1",
    by: { address: MAYA },
    effect: "introduction",
    options: [samOption, noOption],
};
const request: AgentTalkIntroductionStep = { ...offer, by: { address: MEMBER_ADDRESS }, about: { "@type": "IntroductionRequest" } };
const getAnswer = (picks: string[], result = "answered"): AgentTalkIntroductionStep => ({
    type: "answer",
    id: "answer-1",
    re: "ask-1",
    by: { address: MEMBER_ADDRESS },
    result,
    picks,
});
const getClose = (people: string[], by = MAYA): AgentTalkIntroductionStep => ({
    type: "close",
    id: "close-1",
    by: { address: by },
    outcome: people.map((address) => ({ type: "contact", address })),
});

describe("getAgentTalkIntroducedBy", () => {
    it("counts the other side's close for the person this side said yes to meeting", () => {
        expect(getAgentTalkIntroducedBy([offer, getAnswer(["o1"]), getClose([MEMBER_ADDRESS, SAM])], MAYA, SAM)).toBe(MAYA);
    });

    it("counts the other side's close for the person this side asked to meet", () => {
        expect(getAgentTalkIntroducedBy([request, getClose([MEMBER_ADDRESS, SAM])], MAYA, SAM)).toBe(MAYA);
    });

    it("counts no one the other side named on its own: not on a talk with no introduction, nor beside the agreed person", () => {
        expect(getAgentTalkIntroducedBy([getClose([STRANGER])], MAYA, STRANGER)).toBeNull();
        expect(getAgentTalkIntroducedBy([offer, getAnswer(["o1"]), getClose([SAM, STRANGER])], MAYA, STRANGER)).toBeNull();
    });

    it("counts no introduction this side said no to or never answered", () => {
        expect(getAgentTalkIntroducedBy([offer, getClose([MEMBER_ADDRESS, SAM])], MAYA, SAM)).toBeNull();
        expect(getAgentTalkIntroducedBy([offer, getAnswer(["o2"]), getClose([MEMBER_ADDRESS, SAM])], MAYA, SAM)).toBeNull();
        expect(getAgentTalkIntroducedBy([offer, getAnswer([], "declined"), getClose([MEMBER_ADDRESS, SAM])], MAYA, SAM)).toBeNull();
    });

    it("counts a close this side wrote itself, and never a booking's close or the introduced side as its own introducer", () => {
        expect(getAgentTalkIntroducedBy([getClose([MAYA, SAM], MEMBER_ADDRESS)], MAYA, SAM)).toBe(MEMBER_ADDRESS);
        expect(getAgentTalkIntroducedBy([offer, getAnswer(["o1"]), getClose([MEMBER_ADDRESS, SAM], SAM)], SAM, SAM)).toBeNull();
        const booked = { ...getClose([SAM]), outcome: [{ type: "time" }, { type: "contact", address: SAM }] };
        expect(getAgentTalkIntroducedBy([offer, getAnswer(["o1"]), booked], MAYA, SAM)).toBeNull();
    });
});
