import { describe, expect, it } from "vitest";
import { createAsk } from "./agentTalk.fixtures.js";
import type { AgentTalkSignedStep } from "./agentTalk.types.js";
import {
    AGENT_TALK_DIRECT_OUTCOME,
    AGENT_TALK_DIRECT_REFUSAL,
    AGENT_TALK_DIRECT_TAKEN,
    createAgentTalkDirectBody,
    getAgentTalkDirectOutcome,
    readAgentTalkDirectBody,
} from "./agentTalkDirect.utils.js";
import { createAgentTalkReferenceParticipant } from "./agentTalkReferenceParticipant.js";

const MEMBER_ADDRESS = "krijn@north.test";
const MAYA = "maya@south.test";
const OPTIONS = [
    { id: "tue", label: "Tuesday 19:30" },
    { id: "thu", label: "Thursday 19:30" },
];

const createPair = async () => {
    const north = await createAgentTalkReferenceParticipant({ issuer: "north.test", address: MEMBER_ADDRESS });
    const south = await createAgentTalkReferenceParticipant({ issuer: "south.test", address: MAYA });
    await north.recognise(south.issuer, [south.publicKey]);
    await south.recognise(north.issuer, [north.publicKey]);

    return { north, south };
};

describe("agent talk direct carrier", () => {
    it("carries an ask and its answer directly, both ways", async () => {
        const { north, south } = await createPair();
        const asked = await north.sendAsk({ to: MAYA, question: "Which evening works?", options: OPTIONS });

        await expect(south.receiveDirect(await north.createDirectRequest(asked.step, { url: south.directUrl }))).resolves.toEqual(
            AGENT_TALK_DIRECT_TAKEN,
        );
        expect(south.getTalk(asked.step.talk)).toEqual([asked.step]);

        const answered = await south.sendAnswer({ ask: asked.step, pick: "thu" });
        await expect(north.receiveDirect(await south.createDirectRequest(answered.step, { url: north.directUrl }))).resolves.toEqual(
            AGENT_TALK_DIRECT_TAKEN,
        );
        expect(north.getTalk(asked.step.talk).map((step) => step.type)).toEqual(["ask", "answer"]);
    });

    it("refuses an unknown service, a replayed token, a stale step, a token for another url and someone else's ask, all alike", async () => {
        const { north, south } = await createPair();
        const stranger = await createAgentTalkReferenceParticipant({ issuer: "stranger.test", address: "eve@stranger.test" });
        const now = new Date();

        const fromStranger = await stranger.sendAsk({ to: MAYA, question: "Deposit?", options: OPTIONS });
        const unknown = await south.receiveDirect(await stranger.createDirectRequest(fromStranger.step, { url: south.directUrl }));

        const asked = await north.sendAsk({ to: MAYA, question: "Lunch?", options: OPTIONS });
        const request = await north.createDirectRequest(asked.step, { url: south.directUrl });
        await south.receiveDirect(request);
        const replayed = await south.receiveDirect(request);

        const stale = await north.sendAsk({ to: MAYA, question: "Old?", options: OPTIONS, now: new Date(now.getTime() - 10 * 60 * 1000) });
        const staleResponse = await south.receiveDirect(await north.createDirectRequest(stale.step, { url: south.directUrl }));

        const elsewhere = await north.sendAsk({ to: MAYA, question: "Elsewhere?", options: OPTIONS });
        const wrongAudience = await south.receiveDirect(
            await north.createDirectRequest(elsewhere.step, { url: "https://other.test/agent-talk/steps" }),
        );

        const forSam = await north.sendAsk({ to: "sam@south.test", question: "Sam?", options: OPTIONS });
        const notHers = await south.receiveDirect(await north.createDirectRequest(forSam.step, { url: south.directUrl }));

        expect([unknown, replayed, staleResponse, wrongAudience, notHers]).toEqual(Array(5).fill(AGENT_TALK_DIRECT_REFUSAL));
    });

    it("says only that a body is not one, or which version it speaks, before reading anything else", () => {
        expect(readAgentTalkDirectBody("text")).toMatchObject({
            isValid: false,
            response: { status: 400, body: { error: "bad_request" } },
        });
        expect(readAgentTalkDirectBody({ v: 1 })).toMatchObject({ isValid: false, response: { body: { error: "bad_request" } } });
        expect(readAgentTalkDirectBody({ v: 1, step: {}, door: 7 })).toMatchObject({ isValid: false });
        expect(readAgentTalkDirectBody({ v: 2, step: {} })).toEqual({
            isValid: false,
            response: { status: 400, body: { error: "unsupported_version", versions: [1] } },
        });
        expect(readAgentTalkDirectBody({ v: 1, step: { id: "st_1" }, door: "door_1" })).toEqual({
            isValid: true,
            step: { id: "st_1" },
            door: "door_1",
        });
    });

    it("sends the step whole without its host's number, so its signature still checks out", () => {
        const step = { ...createAsk(), sig: "sig", seq: 3 } as AgentTalkSignedStep;

        expect(createAgentTalkDirectBody(step)).toEqual({ v: 1, step: { ...step, seq: undefined } });
        expect(createAgentTalkDirectBody(step, "door_1")).toMatchObject({ door: "door_1" });
    });

    it("reads a call as taken, refused only on the uniform refusal, and failed on anything else", () => {
        expect(getAgentTalkDirectOutcome(202, {})).toBe(AGENT_TALK_DIRECT_OUTCOME.TAKEN);
        expect(getAgentTalkDirectOutcome(403, { error: "not_accepted" })).toBe(AGENT_TALK_DIRECT_OUTCOME.REFUSED);
        expect(getAgentTalkDirectOutcome(403, { error: "forbidden" })).toBe(AGENT_TALK_DIRECT_OUTCOME.FAILED);
        expect(getAgentTalkDirectOutcome(400, { error: "unsupported_version" })).toBe(AGENT_TALK_DIRECT_OUTCOME.FAILED);
        expect(getAgentTalkDirectOutcome(503, null)).toBe(AGENT_TALK_DIRECT_OUTCOME.FAILED);
    });
});
