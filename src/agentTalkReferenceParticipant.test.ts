import { describe, expect, it } from "vitest";
import { createAgentTalkReferenceParticipant } from "./agentTalkReferenceParticipant.js";

const MEMBER_ADDRESS = "krijn@north.test";
const MAYA = "maya@south.test";

// two services that know nothing of each other's code: each signs its own steps and takes the other's only by the protocol
const createPair = async () => {
    const north = await createAgentTalkReferenceParticipant({ issuer: "north.test", address: MEMBER_ADDRESS });
    const south = await createAgentTalkReferenceParticipant({ issuer: "south.test", address: MAYA });
    await north.recognise(south.issuer, [south.publicKey]);
    await south.recognise(north.issuer, [north.publicKey]);

    return { north, south };
};

const OPTIONS = [
    { id: "tue", label: "Tuesday 19:30" },
    { id: "thu", label: "Thursday 19:30" },
];

describe("a reference participant", () => {
    it("asks another service by email and takes its signed answer back, once", async () => {
        const { north, south } = await createPair();

        const asked = await north.sendAsk({ to: MAYA, question: "Which evening works for dinner?", options: OPTIONS });
        const received = await south.accept({
            htmlContent: asked.email.htmlContent,
            from: MEMBER_ADDRESS,
            messageId: "<ask@north.test>",
            isFromAuthenticated: true,
        });
        expect(received).toEqual(asked.step);
        if (!received) return;

        const answered = await south.sendAnswer({ ask: received, pick: "thu" });
        const reply = { htmlContent: answered.email.htmlContent, from: MAYA, messageId: "<answer@south.test>", isFromAuthenticated: true };
        expect(await north.accept(reply)).toMatchObject({ type: "answer", re: asked.step.id, picks: ["thu"], by: { address: MAYA } });
        // the same email read again changes nothing
        expect(await north.accept(reply)).toBeNull();
        expect(north.getTalk(asked.step.talk).map((step) => step.type)).toEqual(["ask", "answer"]);
    });

    it("takes nothing from a service it does not recognise, from unauthenticated mail, or for someone else", async () => {
        const { north, south } = await createPair();
        const stranger = await createAgentTalkReferenceParticipant({ issuer: "stranger.test", address: "eve@stranger.test" });

        const fromStranger = await stranger.sendAsk({ to: MAYA, question: "Pay the deposit?", options: OPTIONS });
        const asked = await north.sendAsk({ to: "sam@south.test", question: "Lunch?", options: OPTIONS });
        const ask = { htmlContent: asked.email.htmlContent, from: MEMBER_ADDRESS, messageId: "<ask@north.test>" };

        expect(
            await south.accept({
                htmlContent: fromStranger.email.htmlContent,
                from: "eve@stranger.test",
                messageId: "<s@stranger.test>",
                isFromAuthenticated: true,
            }),
        ).toBeNull();
        expect(await south.accept({ ...ask, isFromAuthenticated: false })).toBeNull();
        // the ask names sam, not maya
        expect(await south.accept({ ...ask, isFromAuthenticated: true })).toBeNull();
        // a block forwarded by someone else: its token names krijn, not the sender
        expect(await south.accept({ ...ask, from: "mallory@south.test", isFromAuthenticated: true })).toBeNull();
    });

    it("takes only the first answer to its ask, from the person it asked", async () => {
        const { north, south } = await createPair();
        const asked = await north.sendAsk({ to: MAYA, question: "Which evening?", options: OPTIONS });
        const first = await south.sendAnswer({ ask: asked.step, pick: "tue" });
        const second = await south.sendAnswer({ ask: asked.step, pick: "thu" });

        expect(
            await north.accept({
                htmlContent: first.email.htmlContent,
                from: MAYA,
                messageId: "<1@south.test>",
                isFromAuthenticated: true,
            }),
        ).not.toBeNull();
        expect(
            await north.accept({
                htmlContent: second.email.htmlContent,
                from: MAYA,
                messageId: "<2@south.test>",
                isFromAuthenticated: true,
            }),
        ).toBeNull();
    });
});
