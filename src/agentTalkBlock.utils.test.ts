import { describe, expect, it } from "vitest";
import { AGENT_TALK_LIMIT, AGENT_TALK_MEDIA_TYPE } from "./agentTalk.constants.js";
import { createKeys, ISSUER } from "./agentTalk.fixtures.js";
import type { AgentTalkPublicKeyResolver, AgentTalkSignedStep, AgentTalkSigningKey, AgentTalkUnsignedStep } from "./agentTalk.types.js";
import { formatAgentTalkStepBlock, readAgentTalkStepBlock } from "./agentTalkBlock.utils.js";
import { signAgentTalkStep } from "./agentTalkStep.utils.js";
import { createAgentTalkToken } from "./agentTalkToken.utils.js";

const NOW = new Date("2026-11-21T10:00:00.000Z");
const EXPIRES_AT = new Date("2026-12-01T17:00:00.000Z");
const FROM = "events@acme.com";
const MESSAGE_ID = "<launch-1@acme.com>";
const OPENING_TAG = `<script type="${AGENT_TALK_MEDIA_TYPE}">`;
const CLOSING_TAG = "</script>";

const createInvite = (): AgentTalkUnsignedStep => ({
    id: "st_1",
    talk: "tk_1",
    at: "2026-11-21T10:00:00.000Z",
    by: { address: FROM, actor: "agent" },
    text: "Acme asks: will you join the launch on 3 December?",
    type: "ask",
    about: { "@type": "Event", name: "Launch night", startDate: "2026-12-03T18:00:00+01:00" },
    to: ["maya@example.com"],
    question: "Will you join us on 3 December?",
    options: [
        { id: "yes", label: "I'll be there" },
        { id: "no", label: "Can't make it" },
    ],
    can: { counter: false, decline: true, text: false },
    answerBy: "personOrAgent",
    expires: EXPIRES_AT.toISOString(),
});

// a step as an email carries it: signed, with the talk token that names it, in one block
const createCarried = async (
    key: AgentTalkSigningKey,
    step: AgentTalkUnsignedStep = createInvite(),
    token: { stepId?: string; address?: string } = {},
) => {
    const signed: AgentTalkSignedStep = { ...step, sig: await signAgentTalkStep(step, key) };
    const talkToken = await createAgentTalkToken({
        issuer: ISSUER,
        talkId: step.talk,
        stepId: token.stepId ?? step.id,
        address: token.address ?? step.by.address,
        expiresAt: EXPIRES_AT,
        now: NOW,
        key,
    });

    return { signed, talkToken, block: formatAgentTalkStepBlock({ token: talkToken, step: signed }) ?? "" };
};

const getBlockJson = (block: string): string => block.slice(OPENING_TAG.length, -CLOSING_TAG.length);

const getEmailHtml = (...blocks: string[]): string => `<html><body><p>Will you join us on 3 December?</p>${blocks.join("")}</body></html>`;

const read = async (
    getPublicKey: AgentTalkPublicKeyResolver,
    html: string,
    overrides: Partial<Parameters<typeof readAgentTalkStepBlock>[0]> = {},
) => await readAgentTalkStepBlock({ html, from: FROM, now: NOW, messageId: MESSAGE_ID, getPublicKey, ...overrides });

describe("formatAgentTalkStepBlock", () => {
    it("keeps a step's text from closing the element or opening a comment", async () => {
        const { key, getPublicKey } = await createKeys();
        const text = "</script><script>alert(1)</script><!-- R&D \u2028 -->";
        const { signed, block } = await createCarried(key, { ...createInvite(), text });

        expect(block.startsWith(OPENING_TAG)).toBe(true);
        expect(block.indexOf("</script")).toBe(block.length - CLOSING_TAG.length);
        expect(getBlockJson(block)).not.toMatch(/[<>&\u2028]/);
        expect(await read(getPublicKey, getEmailHtml(block))).toMatchObject({ isValid: true, step: { text, sig: signed.sig } });
    });

    it("carries no step that is too large for an email", async () => {
        const { key } = await createKeys();
        const blocks = Array.from({ length: 500 }, () => ({ start: "2026-11-24T19:30:00+01:00", end: "2026-11-24T21:30:00+01:00" }));
        const busy = { type: "busy" as const, text: "Busy", from: "2026-11-24T00:00:00+01:00", to: "2026-11-30T00:00:00+01:00", blocks };
        const step: AgentTalkUnsignedStep = {
            id: "st_1",
            talk: "tk_1",
            at: "2026-11-21T10:00:00.000Z",
            by: { address: FROM, actor: "agent" },
            text: "Busy times for next week.",
            type: "say",
            values: [busy],
        };

        expect((await createCarried(key, step)).block).toBe("");
    });
});

describe("readAgentTalkStepBlock", () => {
    it("reads the signed step an email carries, with no fetch", async () => {
        const { key, getPublicKey } = await createKeys();
        const { signed, block } = await createCarried(key);

        expect(await read(getPublicKey, getEmailHtml(block), { from: "Events@Acme.com" })).toEqual({
            isValid: true,
            claims: expect.objectContaining({ iss: ISSUER, talk: "tk_1", step: "st_1", sub: FROM }) as unknown,
            step: signed,
        });
    });

    it("reads a step of a type it does not know, to show its text", async () => {
        const { key, getPublicKey } = await createKeys();
        const base = { id: "st_1", talk: "tk_1", at: "2026-11-21T10:00:00.000Z", by: { address: FROM, actor: "agent" as const } };
        const privateStep: AgentTalkUnsignedStep = { ...base, text: "Acme opened a vote.", type: "x-vote" };
        const laterStep = { ...base, text: "Acme opened a poll.", type: "poll" } as unknown as AgentTalkUnsignedStep;

        expect(await read(getPublicKey, getEmailHtml((await createCarried(key, privateStep)).block))).toMatchObject({
            isValid: true,
            step: { type: "x-vote", text: "Acme opened a vote." },
        });
        expect(await read(getPublicKey, getEmailHtml((await createCarried(key, laterStep)).block))).toMatchObject({
            isValid: true,
            step: { type: "poll", text: "Acme opened a poll." },
        });
    });

    it("reads a block whose json a mail server wrapped across lines", async () => {
        const { key, getPublicKey } = await createKeys();
        const { block } = await createCarried(key);
        const wrapped = `${OPENING_TAG}${getBlockJson(block).replace(/(.{76})/g, "$1\r\n")}${CLOSING_TAG}`;

        expect(wrapped.split("\r\n").length).toBeGreaterThan(10);
        expect(await read(getPublicKey, getEmailHtml(wrapped))).toMatchObject({ isValid: true });
    });

    it("reads a pretty-printed block in any letter case, beside other scripts", async () => {
        const { key, getPublicKey } = await createKeys();
        const { signed, talkToken } = await createCarried(key);
        const markup = '<script type="application/ld+json">{"@context":"http://schema.org","@type":"EmailMessage"}</script>';
        const block = `<SCRIPT nonce="x" TYPE='APPLICATION/AGENT-TALK+JSON'>\n${JSON.stringify({ v: 1, token: talkToken, step: signed }, null, 2)}\n</SCRIPT >`;

        expect(await read(getPublicKey, getEmailHtml(markup, block))).toMatchObject({ isValid: true, step: { id: "st_1" } });
    });

    it("reads a block whose type attribute lost its quotes to an html minifier", async () => {
        const { key, getPublicKey } = await createKeys();
        const { block } = await createCarried(key);
        const minified = block.replace(OPENING_TAG, `<script type=${AGENT_TALK_MEDIA_TYPE}>`);

        expect(await read(getPublicKey, getEmailHtml(minified))).toMatchObject({ isValid: true });
    });

    it("finds no block in plain html, behind another type or in an attribute of another name", async () => {
        const { key, getPublicKey } = await createKeys();
        const json = getBlockJson((await createCarried(key)).block);

        expect(await read(getPublicKey, getEmailHtml())).toEqual({ isValid: false, reason: "noBlock" });
        expect(await read(getPublicKey, getEmailHtml(`<script type="application/ld+json">${json}</script>`))).toEqual({
            isValid: false,
            reason: "noBlock",
        });
        expect(await read(getPublicKey, getEmailHtml(`<script data-type="${AGENT_TALK_MEDIA_TYPE}">${json}</script>`))).toEqual({
            isValid: false,
            reason: "noBlock",
        });
        expect(await read(getPublicKey, getEmailHtml(`${OPENING_TAG}not json${CLOSING_TAG}`))).toEqual({
            isValid: false,
            reason: "noBlock",
        });
    });

    it("is refused on mail from another address, such as a forward", async () => {
        const { key, getPublicKey } = await createKeys();
        const { block } = await createCarried(key);

        expect(await read(getPublicKey, getEmailHtml(block), { from: "eve@example.com" })).toEqual({
            isValid: false,
            reason: "fromMismatch",
        });
    });

    it("is refused once its ask ran out", async () => {
        const { key, getPublicKey } = await createKeys();
        const { block } = await createCarried(key);

        expect(await read(getPublicKey, getEmailHtml(block), { now: EXPIRES_AT })).toEqual({ isValid: false, reason: "expired" });
    });

    it("is not read when the service's keys are not already known", async () => {
        const { key } = await createKeys();
        const { block } = await createCarried(key);

        expect(await read(() => Promise.resolve(null), getEmailHtml(block))).toEqual({ isValid: false, reason: "unknownKey" });
    });

    it("is refused when its token is not one, or names another step", async () => {
        const { key, getPublicKey } = await createKeys();
        const { block, talkToken } = await createCarried(key);
        const otherStep = await createCarried(key, createInvite(), { stepId: "st_9" });

        expect(await read(getPublicKey, getEmailHtml(block.replace(talkToken, "not-a-token")))).toEqual({
            isValid: false,
            reason: "malformed",
        });
        expect(await read(getPublicKey, getEmailHtml(otherStep.block))).toEqual({ isValid: false, reason: "tokenMismatch" });
    });

    it("is refused when someone other than the sender wrote the step", async () => {
        const { key, getPublicKey } = await createKeys();
        const step: AgentTalkUnsignedStep = { ...createInvite(), by: { address: "krijn@example.com", actor: "person" } };
        const { block } = await createCarried(key, step, { address: FROM });

        expect(await read(getPublicKey, getEmailHtml(block))).toEqual({ isValid: false, reason: "authorMismatch" });
    });

    it("is refused when the step changed after it was signed", async () => {
        const { key, getPublicKey } = await createKeys();
        const { block } = await createCarried(key);
        const changed = block.replace("Can't make it", "Pay the deposit");

        expect(changed).not.toBe(block);
        expect(await read(getPublicKey, getEmailHtml(changed))).toEqual({ isValid: false, reason: "badStepSignature" });
    });

    it("is refused when the step breaks a limit, is nested too deep to check, or comes in a later version", async () => {
        const { key, getPublicKey } = await createKeys();
        const { block } = await createCarried(key);
        const tooLong = await createCarried(key, { ...createInvite(), text: "x".repeat(AGENT_TALK_LIMIT.STEP_TEXT + 1) });
        const nested = block.replace('"talk":"tk_1"', `"talk":"tk_1","extra":${"[".repeat(15_000)}${"]".repeat(15_000)}`);
        const later = block.replace('"v":1}', '"v":2}');

        expect(nested).not.toBe(block);
        expect(await read(getPublicKey, getEmailHtml(tooLong.block))).toEqual({ isValid: false, reason: "invalidStep" });
        expect(await read(getPublicKey, getEmailHtml(nested))).toEqual({ isValid: false, reason: "invalidStep" });
        expect(await read(getPublicKey, getEmailHtml(later))).toEqual({ isValid: false, reason: "wrongVersion" });
    });

    it("counts only the block of the step the message's own header names", async () => {
        const { key, getPublicKey } = await createKeys();
        const quoted = await createCarried(key);
        const own = await createCarried(key, { ...createInvite(), id: "st_2", text: "Acme asks again: are you coming?" });
        const headerClaims = { talk: "tk_1", step: "st_2" };

        expect(await read(getPublicKey, getEmailHtml(quoted.block), { headerClaims })).toEqual({ isValid: false, reason: "tokenMismatch" });
        expect(await read(getPublicKey, getEmailHtml(quoted.block, own.block), { headerClaims })).toMatchObject({
            isValid: true,
            step: { id: "st_2" },
        });
    });

    it("skips a block whose step names another email", async () => {
        const { key, getPublicKey } = await createKeys();
        const { block } = await createCarried(key, { ...createInvite(), email: MESSAGE_ID });

        expect(await read(getPublicKey, getEmailHtml(block), { messageId: "launch-1@acme.com" })).toMatchObject({ isValid: true });
        expect(await read(getPublicKey, getEmailHtml(block), { messageId: "<launch-2@acme.com>" })).toEqual({
            isValid: false,
            reason: "emailMismatch",
        });
    });

    it("uses the first block that checks out", async () => {
        const { key, getPublicKey } = await createKeys();
        const { block } = await createCarried(key);
        const changed = block.replace("Can't make it", "Pay the deposit");

        expect(await read(getPublicKey, getEmailHtml(changed, block))).toMatchObject({
            isValid: true,
            step: { options: [{ id: "yes" }, { id: "no", label: "Can't make it" }] },
        });
    });

    it("opens only a handful of blocks", async () => {
        const { key, getPublicKey } = await createKeys();
        const { block } = await createCarried(key);
        const empty = `${OPENING_TAG}{}${CLOSING_TAG}`;

        expect(await read(getPublicKey, getEmailHtml(empty.repeat(7), block))).toMatchObject({ isValid: true });
        expect(await read(getPublicKey, getEmailHtml(empty.repeat(8), block))).toEqual({ isValid: false, reason: "noBlock" });
    });

    it("ignores a block that is too large, whatever it holds", async () => {
        const { key, getPublicKey } = await createKeys();
        const json = getBlockJson((await createCarried(key)).block);
        const padded = `${OPENING_TAG}{${" ".repeat(AGENT_TALK_LIMIT.STEP_BLOCK)}${json.slice(1)}${CLOSING_TAG}`;

        expect(JSON.parse(getBlockJson(padded))).toEqual(JSON.parse(json));
        expect(await read(getPublicKey, getEmailHtml(padded))).toEqual({ isValid: false, reason: "noBlock" });
    });

    // without the bounds on a tag's length and on the number of blocks, these take many seconds
    it("stays quick on html made to be slow", { timeout: 1_500 }, async () => {
        const { getPublicKey } = await createKeys();

        expect(await read(getPublicKey, "<script ".repeat(600_000))).toEqual({ isValid: false, reason: "noBlock" });
        expect(await read(getPublicKey, OPENING_TAG.repeat(50_000))).toEqual({ isValid: false, reason: "noBlock" });
        expect(await read(getPublicKey, `${OPENING_TAG}</script${" ".repeat(20)}`.repeat(50_000))).toEqual({
            isValid: false,
            reason: "noBlock",
        });
    });
});
