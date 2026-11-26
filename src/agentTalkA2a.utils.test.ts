import { describe, expect, it } from "vitest";
import { AGENT_TALK_A2A_EXTENSION_URI } from "./agentTalk.constants.js";
import type { AgentTalkPublicKeyResolver } from "./agentTalk.types.js";
import { createAsk } from "./agentTalk.fixtures.js";
import type { AgentTalkSignedStep } from "./agentTalk.types.js";
import {
    A2A_ERROR_CODE,
    A2A_TASK_STATE,
    AGENT_TALK_A2A_REFUSAL,
    getAgentTalkA2aTask,
    readAgentTalkA2aMessage,
} from "./agentTalkA2a.utils.js";
import { verifyAgentTalkAgentCard } from "./agentTalkAgentCard.utils.js";
import { importAgentTalkPublicKeyJwk } from "./agentTalkJws.utils.js";
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

describe("agent talk over a2a", () => {
    it("carries an ask and its answer directly, both ways, as a task the receiver keeps", async () => {
        const { north, south } = await createPair();
        const asked = await north.sendAsk({ to: MAYA, question: "Which evening works?", options: OPTIONS });

        const askResponse = await south.receiveA2a(await north.createA2aRequest(asked.step, { a2aUrl: "https://south.test/a2a" }));
        expect(askResponse).toMatchObject({
            result: { task: { id: asked.step.id, contextId: asked.step.talk, status: { state: A2A_TASK_STATE.SUBMITTED } } },
        });
        expect(south.getTalk(asked.step.talk)).toEqual([asked.step]);

        const answered = await south.sendAnswer({ ask: asked.step, pick: "thu" });
        const answerResponse = await north.receiveA2a(
            await south.createA2aRequest(answered.step, { a2aUrl: "https://north.test/a2a", referenceTaskIds: [asked.step.id] }),
        );
        expect(answerResponse).toMatchObject({ result: { message: { contextId: asked.step.talk } } });
        expect(north.getTalk(asked.step.talk).map((step) => step.type)).toEqual(["ask", "answer"]);
    });

    it("refuses an unknown service, a replayed token, a stale step, a token for another endpoint and someone else's ask, all alike", async () => {
        const { north, south } = await createPair();
        const stranger = await createAgentTalkReferenceParticipant({ issuer: "stranger.test", address: "eve@stranger.test" });
        const now = new Date();
        const refusal = (response: unknown) => JSON.stringify({ ...(response as object), id: null });

        const fromStranger = await stranger.sendAsk({ to: MAYA, question: "Deposit?", options: OPTIONS });
        const unknown = await south.receiveA2a(await stranger.createA2aRequest(fromStranger.step, { a2aUrl: "https://south.test/a2a" }));

        const asked = await north.sendAsk({ to: MAYA, question: "Lunch?", options: OPTIONS });
        const request = await north.createA2aRequest(asked.step, { a2aUrl: "https://south.test/a2a" });
        await south.receiveA2a(request);
        const replayed = await south.receiveA2a(request);

        const stale = await north.sendAsk({ to: MAYA, question: "Old?", options: OPTIONS, now: new Date(now.getTime() - 10 * 60 * 1000) });
        const staleResponse = await south.receiveA2a(await north.createA2aRequest(stale.step, { a2aUrl: "https://south.test/a2a" }));

        const elsewhere = await north.sendAsk({ to: MAYA, question: "Elsewhere?", options: OPTIONS });
        const wrongAudience = await south.receiveA2a(await north.createA2aRequest(elsewhere.step, { a2aUrl: "https://other.test/a2a" }));

        const forSam = await north.sendAsk({ to: "sam@south.test", question: "Sam?", options: OPTIONS });
        const notHers = await south.receiveA2a(await north.createA2aRequest(forSam.step, { a2aUrl: "https://south.test/a2a" }));

        const expected = JSON.stringify({ jsonrpc: "2.0", id: null, error: AGENT_TALK_A2A_REFUSAL });
        expect([unknown, replayed, staleResponse, wrongAudience, notHers].map(refusal)).toEqual(Array(5).fill(expected));
    });

    it("asks for the version and the extension before reading anything else", async () => {
        const { north, south } = await createPair();
        const asked = await north.sendAsk({ to: MAYA, question: "Lunch?", options: OPTIONS });
        const request = await north.createA2aRequest(asked.step, { a2aUrl: "https://south.test/a2a" });

        const noExtension = await south.receiveA2a({ ...request, headers: { ...request.headers, "a2a-extensions": "" } });
        const oldVersion = await south.receiveA2a({ ...request, headers: { ...request.headers, "a2a-version": "0.3" } });

        expect(noExtension).toMatchObject({ error: { code: A2A_ERROR_CODE.EXTENSION_SUPPORT_REQUIRED } });
        expect(oldVersion).toMatchObject({ error: { code: A2A_ERROR_CODE.VERSION_NOT_SUPPORTED } });
    });

    it("signs its service card, which names the endpoint and the extension as required", async () => {
        const { north } = await createPair();
        const card = await north.getCard();
        const getPublicKey: AgentTalkPublicKeyResolver = async (issuer, kid) =>
            issuer === north.issuer && kid === north.publicKey.kid ? await importAgentTalkPublicKeyJwk(north.publicKey) : null;

        await expect(verifyAgentTalkAgentCard(card, north.issuer, getPublicKey)).resolves.toBe(true);
        expect(card.supportedInterfaces).toEqual([{ url: "https://north.test/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }]);
        expect(card.capabilities.extensions[0]).toMatchObject({ uri: AGENT_TALK_A2A_EXTENSION_URI, required: true });
    });

    it("reads a step only from exactly one data part that names the message", () => {
        const step = { id: "st_1", talk: "tk_1" };
        const part = { data: { v: 1, step }, mediaType: "application/agent-talk+json" };

        expect(readAgentTalkA2aMessage({ messageId: "st_1", contextId: "tk_1", parts: [part] })).toEqual({ step });
        expect(readAgentTalkA2aMessage({ messageId: "st_2", contextId: "tk_1", parts: [part] })).toBeNull();
        expect(readAgentTalkA2aMessage({ messageId: "st_1", contextId: "tk_1", parts: [part, part] })).toBeNull();
    });

    it("reads an ask's task from the steps held after it: submitted, working on a wait, completed with the answer as artifact", () => {
        const ask = { ...createAsk(), sig: "sig" } as AgentTalkSignedStep;
        const step = (overrides: Record<string, unknown>) =>
            ({ talk: ask.talk, by: { address: MAYA, actor: "agent" }, sig: "sig", text: "", ...overrides }) as AgentTalkSignedStep;
        const wait = step({ id: "st_2", type: "wait", re: ask.id, at: "2026-11-20T10:05:00.000Z" });
        const answer = step({
            id: "st_3",
            type: "answer",
            re: ask.id,
            result: "answered",
            picks: ["thu"],
            at: "2026-11-20T10:09:00.000Z",
            seq: 3,
        });
        const declined = step({ id: "st_4", type: "answer", re: ask.id, result: "declined", at: "2026-11-20T10:09:00.000Z" });
        const close = step({ id: "st_5", type: "close", at: "2026-11-20T11:00:00.000Z" });

        expect(getAgentTalkA2aTask(ask, [ask]).status.state).toBe(A2A_TASK_STATE.SUBMITTED);
        expect(getAgentTalkA2aTask(ask, [ask, wait]).status).toEqual({ state: A2A_TASK_STATE.WORKING, timestamp: wait.at });
        expect(getAgentTalkA2aTask(ask, [ask, declined]).status.state).toBe(A2A_TASK_STATE.REJECTED);
        expect(getAgentTalkA2aTask(ask, [ask, close]).status.state).toBe(A2A_TASK_STATE.CANCELED);

        const completed = getAgentTalkA2aTask(ask, [ask, wait, answer, close]);
        expect(completed.status.state).toBe(A2A_TASK_STATE.COMPLETED);
        expect(completed.artifacts?.[0]?.artifactId).toBe(answer.id);
        // the artifact carries the step as a message does: unnumbered, so its signature still checks out
        expect(completed.artifacts?.[0]?.parts[1]?.data).toEqual({ v: 1, step: { ...answer, seq: undefined } });
    });
});
