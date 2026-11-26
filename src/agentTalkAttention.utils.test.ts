import { describe, expect, it } from "vitest";
import type { AgentTalkStep, AgentTalkStepBody } from "./agentTalk.types.js";
import { getAgentTalkAttention } from "./agentTalkAttention.utils.js";

const MEMBER_ADDRESS = "krijn@example.com";
const MAYA = "maya@example.com";
const PARTIES = [MEMBER_ADDRESS, MAYA];

const AT = "2026-11-20T10:00:00.000Z";
const EXPIRES = "2026-11-27T10:00:00.000Z";
const SOON = new Date("2026-11-20T10:01:00.000Z");
const HOURS_LATER = new Date("2026-11-20T13:00:00.000Z");

let nextSeq = 0;

const createStep = (id: string, address: string, actor: "person" | "agent", body: AgentTalkStepBody, re?: string): AgentTalkStep => ({
    id,
    talk: "tk_1",
    seq: nextSeq++,
    at: AT,
    by: { address, actor },
    text: id,
    sig: "sig",
    ...(re ? { re } : {}),
    ...body,
});

const createAsk = (
    id: string,
    from: string,
    to: string,
    overrides: Partial<Extract<AgentTalkStepBody, { type: "ask" }>> = {},
    re?: string,
): AgentTalkStep =>
    createStep(
        id,
        from,
        "agent",
        {
            type: "ask",
            to: [to],
            question: "Which evening works?",
            options: [{ id: "tue", label: "Tuesday · 7:30 PM" }],
            can: { counter: true, decline: true, text: false },
            answerBy: "personOrAgent",
            expires: EXPIRES,
            ...overrides,
        },
        re,
    );

const attention = (steps: AgentTalkStep[], address: string, now: Date = SOON) =>
    getAgentTalkAttention({ steps, parties: PARTIES, address, now });

describe("getAgentTalkAttention", () => {
    it("says the agents are working while a fresh ask may still be answered by an agent", () => {
        const steps = [createAsk("ask", MEMBER_ADDRESS, MAYA)];

        expect(attention(steps, MEMBER_ADDRESS)).toEqual({ state: "agentsWorking", due: EXPIRES });
        expect(attention(steps, MAYA)).toEqual({ state: "agentsWorking", due: EXPIRES });
    });

    it("turns to the person once their agent says it waits on them", () => {
        const steps = [
            createAsk("ask", MEMBER_ADDRESS, MAYA, { due: "2026-11-22T10:00:00.000Z" }),
            createStep("wait", MAYA, "agent", { type: "wait" }, "ask"),
        ];

        expect(attention(steps, MAYA)).toEqual({ state: "needsYou", due: "2026-11-22T10:00:00.000Z" });
        expect(attention(steps, MEMBER_ADDRESS)).toEqual({ state: "waitingOnThem", due: "2026-11-22T10:00:00.000Z" });
    });

    it("turns to the person when the ask is theirs alone, or the agents' window has passed", () => {
        expect(attention([createAsk("ask", MEMBER_ADDRESS, MAYA, { answerBy: "person" })], MAYA).state).toBe("needsYou");
        expect(attention([createAsk("ask", MEMBER_ADDRESS, MAYA)], MAYA, HOURS_LATER).state).toBe("needsYou");
        expect(attention([createAsk("ask", MEMBER_ADDRESS, MAYA)], MEMBER_ADDRESS, HOURS_LATER).state).toBe("waitingOnThem");
    });

    it("is done when everything was answered, the ask ran out, or the talk closed", () => {
        const ask = createAsk("ask", MEMBER_ADDRESS, MAYA);
        const answer = createStep("answer", MAYA, "person", { type: "answer", re: "ask", result: "answered", picks: ["tue"] }, "ask");
        const close = createStep("close", MEMBER_ADDRESS, "agent", { type: "close", reason: "done" });

        expect(attention([ask, answer], MEMBER_ADDRESS)).toEqual({ state: "done" });
        expect(attention([ask], MEMBER_ADDRESS, new Date(EXPIRES))).toEqual({ state: "done" });
        expect(attention([ask, close], MAYA)).toEqual({ state: "done" });
    });

    it("waits for the asker's yes on an answer from a link or read from a reply, until their side responds", () => {
        const ask = createAsk("ask", MEMBER_ADDRESS, MAYA, { answerBy: "person" });
        const fromLink = {
            ...createStep("answer", MAYA, "person", { type: "answer", re: "ask", result: "answered", picks: ["tue"] }, "ask"),
            via: "link" as const,
        };
        const fromReply = { ...fromLink, via: "email" as const, isInterpreted: true };
        const confirmed = createStep("say", MEMBER_ADDRESS, "agent", { type: "say" }, "answer");

        expect(attention([ask, fromLink], MEMBER_ADDRESS)).toEqual({ state: "needsYou" });
        expect(attention([ask, fromLink], MAYA)).toEqual({ state: "waitingOnThem" });
        expect(attention([ask, fromReply], MEMBER_ADDRESS)).toEqual({ state: "needsYou" });
        expect(attention([ask, fromLink, confirmed], MEMBER_ADDRESS)).toEqual({ state: "done" });
    });

    it("follows a counter to whoever has to answer it", () => {
        const steps = [
            createAsk("ask", MEMBER_ADDRESS, MAYA),
            createAsk("counter", MAYA, MEMBER_ADDRESS, { counters: true, answerBy: "person" }, "ask"),
            createStep("stale-wait", MAYA, "agent", { type: "wait" }, "ask"),
        ];

        expect(attention(steps, MEMBER_ADDRESS).state).toBe("needsYou");
        expect(attention(steps, MAYA).state).toBe("waitingOnThem");
    });

    it("needs the asker when their own agent waits on them to pick, until they go on", () => {
        const ask = createAsk("ask", MEMBER_ADDRESS, MAYA);
        const answer = createStep("answer", MAYA, "agent", { type: "answer", re: "ask", result: "answered", picks: ["tue"] }, "ask");
        const wait = createStep("wait", MEMBER_ADDRESS, "agent", { type: "wait" }, "answer");
        const next = createAsk("final", MEMBER_ADDRESS, MAYA, { answerBy: "person" });

        expect(attention([ask, answer, wait], MEMBER_ADDRESS)).toEqual({ state: "needsYou" });
        expect(attention([ask, answer, wait], MAYA)).toEqual({ state: "waitingOnThem" });
        expect(attention([ask, answer, wait, next], MEMBER_ADDRESS).state).toBe("waitingOnThem");
    });

    it("belongs to the person who took over, until they hand it back", () => {
        const ask = createAsk("ask", MEMBER_ADDRESS, MAYA);
        const hold = createStep("hold", MAYA, "person", { type: "hold", reason: "person" });
        const resume = createStep("resume", MAYA, "person", { type: "resume" });

        expect(attention([ask, hold], MAYA).state).toBe("needsYou");
        expect(attention([ask, hold, resume], MAYA).state).toBe("agentsWorking");
    });

    it("waits for every party to say yes again after a new address joined", () => {
        const hold = createStep("hold", MEMBER_ADDRESS, "agent", { type: "hold", reason: "audience", addresses: ["sam@example.com"] });
        const krijnResumes = createStep("resume-krijn", MEMBER_ADDRESS, "person", { type: "resume" });
        const mayaResumes = createStep("resume-maya", MAYA, "person", { type: "resume" });

        expect(attention([hold], MEMBER_ADDRESS)).toEqual({ state: "needsYou" });
        expect(attention([hold, krijnResumes], MEMBER_ADDRESS)).toEqual({ state: "waitingOnThem" });
        expect(attention([hold, krijnResumes, mayaResumes], MEMBER_ADDRESS)).toEqual({ state: "done" });
    });

    it("ignores a step of a type it does not know", () => {
        const ask = createAsk("st_1", MEMBER_ADDRESS, MAYA);
        const vote = createStep("st_2", MAYA, "agent", { type: "x-vote" });

        expect(attention([ask, vote], MAYA)).toEqual(attention([ask], MAYA));
        expect(attention([vote], MAYA)).toEqual({ state: "done" });
    });
});
