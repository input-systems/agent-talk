import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import {
    ASKED_AT,
    createAsk,
    createKeys,
    EXPIRES_AT,
    ISSUER,
    KID,
    MAYA,
    MEMBER_ADDRESS,
    minutesAfterAsk,
} from "../../src/agentTalk.fixtures.js";
import {
    AGENT_TALK_MEDIA_TYPE,
    checkAgentTalkPresenceToken,
    checkAgentTalkServiceToken,
    checkAgentTalkToken,
    createAgentTalkDirectBody,
    createAgentTalkPresenceToken,
    createAgentTalkServiceToken,
    createAgentTalkToken,
    formatAgentTalkStepBlock,
    parseAgentTalkDelegationFile,
    readAgentTalkDirectBody,
    readAgentTalkServiceDocument,
    readAgentTalkStepBlock,
    signAgentTalkServiceDocument,
    signAgentTalkStep,
    validateAgentTalkSignedStep,
    validateAgentTalkStep,
    verifyAgentTalkServiceDocument,
} from "../../src/index.js";
import type {
    AgentTalkPublicKeyResolver,
    AgentTalkServiceDocument,
    AgentTalkSignedStep,
    AgentTalkSigningKey,
    AgentTalkUnsignedStep,
} from "../../src/index.js";

type JsonObject = Record<string, unknown>;

const SCHEMA_BASE = "https://talk.input.so/v1/schemas/";
const SCHEMA_FILES = [
    "common.schema.json",
    "value.schema.json",
    "step.schema.json",
    "step-block.schema.json",
    "presence-token-claims.schema.json",
    "talk-token-claims.schema.json",
    "service-token-claims.schema.json",
    "delegation-file.schema.json",
    "service-document.schema.json",
    "direct-body.schema.json",
];

const NOW = minutesAfterAsk(1);
const MESSAGE_ID = "<dinner-1@example.com>";
const AUDIENCE = "https://example.com/agent-talk/steps";
const OPENING_TAG = `<script type="${AGENT_TALK_MEDIA_TYPE}">`;
const CLOSING_TAG = "</script>";
const textEncoder = new TextEncoder();

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
addFormats(ajv);
for (const file of SCHEMA_FILES) {
    ajv.addSchema(JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")) as JsonObject);
}

// the schemas hold no $async, so a validator answers with a boolean
const getValidator = (schema: string): ValidateFunction => {
    const validate = ajv.getSchema(`${SCHEMA_BASE}${schema}`);
    if (!validate) throw new Error(`no schema ${schema}`);
    return validate as ValidateFunction;
};

const getIsSchemaValid = (schema: string, value: unknown): boolean => getValidator(schema)(value);

const getSchemaErrors = (schema: string, value: unknown) => {
    const validate = getValidator(schema);
    validate(value);
    return validate.errors ?? [];
};

const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const decodeSegment = (segment: string): JsonObject => JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as JsonObject;

const decodeToken = (token: string): { header: JsonObject; claims: JsonObject } => {
    const [header = "", claims = ""] = token.split(".");
    return { header: decodeSegment(header), claims: decodeSegment(claims) };
};

// a token with whatever claims a test needs, signed the way the reference implementation signs
const signToken = async (header: JsonObject, claims: JsonObject, key: AgentTalkSigningKey): Promise<string> => {
    const signingInput = `${toBase64Url(textEncoder.encode(JSON.stringify(header)))}.${toBase64Url(textEncoder.encode(JSON.stringify(claims)))}`;
    const signature = await crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, textEncoder.encode(signingInput));
    return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
};

const without = (record: JsonObject, key: string): JsonObject =>
    Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

const ENVELOPE = {
    talk: "tk_1",
    at: ASKED_AT,
    by: { address: MEMBER_ADDRESS, actor: "agent" },
} as const;

const TIME_VALUE = {
    type: "time",
    text: "Tue 24 Nov, 19:30–21:30",
    start: "2026-11-24T19:30:00+01:00",
    end: "2026-11-24T21:30:00+01:00",
    timeZone: "Europe/Amsterdam",
    place: "De Kas",
    isCall: false,
} as const;

const CONTACT_VALUE = { type: "contact", text: "Sam de Vries", address: "sam@example.com", name: "Sam de Vries" } as const;

// one of every value type, and two this version does not know
const EVERY_VALUE = [
    { type: "text", text: "See you there" },
    TIME_VALUE,
    {
        type: "busy",
        text: "Busy Tuesday morning",
        from: "2026-11-24T00:00:00Z",
        to: "2026-11-25T00:00:00Z",
        blocks: [{ start: "2026-11-24T09:00:00Z", end: "2026-11-24T11:00:00Z" }],
    },
    { type: "date", text: "24 November", date: "2026-11-24" },
    { type: "place", text: "De Kas, Amsterdam", name: "De Kas", address: "Kamerlingh Onneslaan 3, Amsterdam" },
    CONTACT_VALUE,
    { type: "amount", text: "€42.50", currency: "EUR", amount: "42.50" },
    { type: "link", text: "The menu", url: "https://example.com/menu" },
    {
        type: "file",
        text: "Menu (PDF)",
        name: "menu.pdf",
        mediaType: "application/pdf",
        size: 1024,
        sha256: "a".repeat(64),
        url: "https://example.com/files/menu.pdf",
    },
    { type: "x-poll", text: "A private poll" },
    { type: "poll", text: "A value type a later version added" },
];

// valid steps of every type, as their authors wrote them; each is signed before the checks
const VALID_STEPS: Record<string, AgentTalkUnsignedStep | JsonObject> = {
    ask: createAsk(),
    "ask with every optional field": createAsk({
        about: { "@type": "FoodEstablishmentReservation", name: "Dinner" },
        title: "Dinner next week",
        select: "many",
        fields: [{ id: "diet", label: "Dietary needs", type: "text", isRequired: false }],
        needs: ["calendar.book", "tool.linear.read", "x-internal"],
        effect: "event",
        due: "2026-11-23T10:00:00.000Z",
        autoUntil: "2026-11-20T11:00:00.000Z",
        via: "app",
        email: MESSAGE_ID,
    }),
    // a receiver accepts a field type and a scope a later version added
    "ask with names a later version added": {
        ...createAsk(),
        fields: [{ id: "poll", label: "A field of a type a later version added", type: "poll" }],
        needs: ["calendar.later"],
    },
    "ask that introduces": createAsk({
        effect: "introduction",
        answerBy: "person",
        options: [{ id: "sam", label: "Meet Sam", value: CONTACT_VALUE }],
        needs: [],
    }),
    "ask that requests scopes": createAsk({ answerBy: "person", requestedScopes: ["calendar.freeBusy"], requestedUntil: EXPIRES_AT }),
    "counter ask": createAsk({ id: "st_3", re: "st_1", counters: true, by: { address: MAYA, actor: "agent" }, to: [MEMBER_ADDRESS] }),
    "open ask": createAsk({ options: undefined, context: undefined, needs: undefined }),
    say: {
        ...ENVELOPE,
        id: "st_say",
        type: "say",
        text: "Krijn's agent shares what it found.",
        values: EVERY_VALUE.slice(0, 8),
        receipt: { shared: "Two free evenings", held: "What the other evenings hold" },
        about: { "@type": "Order", orderNumber: "A-1", "@context": "https://schema.org" },
    },
    "say with private and unknown values": {
        ...ENVELOPE,
        id: "st_say2",
        type: "say",
        text: "Private values.",
        values: EVERY_VALUE.slice(8),
    },
    answer: {
        ...ENVELOPE,
        id: "st_2",
        by: { address: MAYA, actor: "person" },
        via: "link",
        re: "st_1",
        type: "answer",
        text: "Maya picked Tuesday.",
        result: "answered",
        picks: ["tue"],
        values: { diet: { type: "text", text: "Vegetarian" } },
        receipt: { shared: "Tuesday works" },
        isInterpreted: true,
        granted: { scopes: ["calendar.freeBusy"], isStanding: true, until: EXPIRES_AT },
    },
    "declined answer": {
        ...ENVELOPE,
        id: "st_2",
        by: { address: MAYA, actor: "person" },
        re: "st_1",
        type: "answer",
        text: "Maya declined.",
        result: "declined",
        picks: [],
    },
    wait: { ...ENVELOPE, id: "st_4", re: "st_1", type: "wait", text: "Waiting on Maya." },
    hold: { ...ENVELOPE, id: "st_5", type: "hold", text: "Krijn takes over.", reason: "audience", addresses: ["new@example.com"] },
    resume: { ...ENVELOPE, id: "st_6", type: "resume", text: "The agents carry on." },
    close: { ...ENVELOPE, id: "st_7", type: "close", text: "Dinner is booked.", reason: "done", outcome: [TIME_VALUE] },
    "private step type": { ...ENVELOPE, id: "st_8", type: "x-poll", text: "A private step.", question: { anything: true } },
    "step type a later version added": { ...ENVELOPE, id: "st_9", type: "poll", text: "A step a later version added." },
};

// each changes a valid step in one way that breaks it, on both sides
const INVALID_STEPS: Record<string, (step: JsonObject) => JsonObject> = {
    "over-long question": (step) => ({ ...step, question: "q".repeat(201) }),
    "bad id characters": (step) => ({ ...step, id: "st 1<b>" }),
    "over-long id": (step) => ({ ...step, id: "s".repeat(129) }),
    "nine options": (step) => ({
        ...step,
        options: Array.from({ length: 9 }, (_, index) => ({ id: `o${index}`, label: `Option ${index}` })),
    }),
    "two recommended options": (step) => ({
        ...step,
        options: [
            { id: "a", label: "A", isRecommended: true },
            { id: "b", label: "B", isRecommended: true },
        ],
    }),
    "over-long option label": (step) => ({ ...step, options: [{ id: "a", label: "l".repeat(81) }] }),
    "over-long option id": (step) => ({ ...step, options: [{ id: "o".repeat(65), label: "A" }] }),
    "uppercase address": (step) => ({ ...step, by: { address: "Krijn@example.com", actor: "agent" } }),
    "address with a space": (step) => ({ ...step, to: ["maya @example.com"] }),
    "missing text": (step) => without(step, "text"),
    "empty text": (step) => ({ ...step, text: "" }),
    "over-long text": (step) => ({ ...step, text: "t".repeat(2001) }),
    "missing sig": (step) => without(step, "sig"),
    "over-long sig": (step) => ({ ...step, sig: "s".repeat(1025) }),
    "negative seq": (step) => ({ ...step, seq: -1 }),
    "fractional seq": (step) => ({ ...step, seq: 1.5 }),
    "unknown actor": (step) => ({ ...step, by: { address: MEMBER_ADDRESS, actor: "robot" } }),
    "unknown via": (step) => ({ ...step, via: "fax" }),
    "email without angle brackets": (step) => ({ ...step, email: "dinner-1@example.com" }),
    "invalid step type name": (step) => ({ ...step, type: "Ask" }),
    "over-long step type": (step) => ({ ...step, type: `x-${"a".repeat(63)}` }),
    "invalid field type": (step) => ({ ...step, fields: [{ id: "f", label: "F", type: "Date" }] }),
    "six fields": (step) => ({ ...step, fields: Array.from({ length: 6 }, (_, index) => ({ id: `f${index}`, label: "F", type: "text" })) }),
    "four context lines": (step) => ({ ...step, context: ["a", "b", "c", "d"] }),
    "empty to": (step) => ({ ...step, to: [] }),
    "three in to": (step) => ({ ...step, to: [MAYA, "a@example.com", "b@example.com"] }),
    "missing can": (step) => without(step, "can"),
    "can without text": (step) => ({ ...step, can: { counter: true, decline: true } }),
    "unknown answerBy": (step) => ({ ...step, answerBy: "anyone" }),
    "invalid scope": (step) => ({ ...step, needs: ["Calendar.book"] }),
    "nine needs": (step) => ({ ...step, needs: Array.from({ length: 9 }, (_, index) => `x-scope${index}`) }),
    "missing expires": (step) => without(step, "expires"),
    "impossible time": (step) => ({ ...step, at: "2026-99-99T99:99:99Z" }),
    "time with a space": (step) => ({ ...step, at: "2026-11-20 10:00:00Z" }),
    "time without offset": (step) => ({ ...step, at: "2026-11-20T10:00:00" }),
    "introduction answered by an agent": (step) => ({
        ...step,
        effect: "introduction",
        options: [{ id: "sam", label: "Meet Sam", value: CONTACT_VALUE }],
    }),
    "introduction with no contact": (step) => ({ ...step, effect: "introduction", answerBy: "person" }),
    "requested scopes answered by an agent": (step) => ({ ...step, requestedScopes: ["calendar.book"] }),
    "requested scope that cannot be requested": (step) => ({ ...step, answerBy: "person", requestedScopes: ["calendar.details"] }),
    "counter without re": (step) => ({ ...step, counters: true }),
    "about without @type": (step) => ({ ...step, about: { name: "Dinner" } }),
    "over-long @type": (step) => ({ ...step, about: { "@type": "T".repeat(65) } }),
    "time value without timeZone": (step) => ({ ...step, options: [{ id: "a", label: "A", value: without(TIME_VALUE, "timeZone") }] }),
    "value without text": (step) => ({ ...step, options: [{ id: "a", label: "A", value: { type: "x-poll" } }] }),
    "over-long value text": (step) => ({ ...step, options: [{ id: "a", label: "A", value: { type: "text", text: "v".repeat(501) } }] }),
    "lowercase currency": (step) => ({
        ...step,
        options: [{ id: "a", label: "A", value: { type: "amount", text: "€1", currency: "eur", amount: "1" } }],
    }),
    "amount as a number": (step) => ({
        ...step,
        options: [{ id: "a", label: "A", value: { type: "amount", text: "€1", currency: "EUR", amount: 1 } }],
    }),
    "http link": (step) => ({
        ...step,
        options: [{ id: "a", label: "A", value: { type: "link", text: "Menu", url: "http://example.com" } }],
    }),
    "file with uppercase sha256": (step) => ({
        ...step,
        options: [{ id: "a", label: "A", value: { ...EVERY_VALUE[8], sha256: "A".repeat(64) } }],
    }),
    "file with negative size": (step) => ({ ...step, options: [{ id: "a", label: "A", value: { ...EVERY_VALUE[8], size: -1 } }] }),
    "busy block without end": (step) => ({
        ...step,
        options: [{ id: "a", label: "A", value: { ...EVERY_VALUE[2], blocks: [{ start: "2026-11-24T09:00:00Z" }] } }],
    }),
    "date value in another shape": (step) => ({
        ...step,
        options: [{ id: "a", label: "A", value: { type: "date", text: "24 Nov", date: "24-11-2026" } }],
    }),
};

const INVALID_ANSWERS: Record<string, (step: JsonObject) => JsonObject> = {
    "answer without re": (step) => without(step, "re"),
    "unknown result": (step) => ({ ...step, result: "maybe" }),
    "decline with picks": (step) => ({ ...step, result: "declined", values: undefined, granted: undefined }),
    "decline with granted scopes": (step) => ({ ...step, result: "declined", picks: undefined, values: undefined }),
    "pick that is not an option id": (step) => ({ ...step, picks: ["tue day"] }),
    "six values": (step) => ({
        ...step,
        values: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`f${index}`, { type: "text", text: "v" }])),
    }),
    "value keyed by a bad field id": (step) => ({ ...step, values: { "bad id": { type: "text", text: "v" } } }),
    "granted without isStanding": (step) => ({ ...step, granted: { scopes: ["calendar.book"] } }),
    "granted scope that cannot be requested": (step) => ({ ...step, granted: { scopes: ["mail.own"], isStanding: false } }),
};

const INVALID_OTHER_STEPS: Record<string, { step: string; change: (step: JsonObject) => JsonObject }> = {
    "wait without re": { step: "wait", change: (step) => without(step, "re") },
    "hold without reason": { step: "hold", change: (step) => without(step, "reason") },
    "hold for an uppercase address": { step: "hold", change: (step) => ({ ...step, addresses: ["New@example.com"] }) },
    "unknown close reason": { step: "close", change: (step) => ({ ...step, reason: "finished" }) },
    "nine outcome values": { step: "close", change: (step) => ({ ...step, outcome: Array.from({ length: 9 }, () => TIME_VALUE) }) },
    "nine say values": { step: "say", change: (step) => ({ ...step, values: [...EVERY_VALUE].slice(0, 9) }) },
    "receipt without shared": { step: "say", change: (step) => ({ ...step, receipt: { held: "Nothing" } }) },
    "over-long receipt line": { step: "say", change: (step) => ({ ...step, receipt: { shared: "r".repeat(121) } }) },
    "unknown step with a bad id": { step: "private step type", change: (step) => ({ ...step, talk: "tk/1" }) },
};

describe("agent talk json schemas", () => {
    let key: AgentTalkSigningKey;
    let getPublicKey: AgentTalkPublicKeyResolver;
    const signedSteps: Record<string, JsonObject> = {};

    const sign = async (step: AgentTalkUnsignedStep | JsonObject): Promise<JsonObject> => ({
        ...step,
        sig: await signAgentTalkStep(step as AgentTalkUnsignedStep, key),
    });

    const getSigned = (name: string): JsonObject => {
        const step = signedSteps[name];
        if (!step) throw new Error(`no step ${name}`);
        return step;
    };

    const expectBothReject = (step: JsonObject) => {
        expect(validateAgentTalkSignedStep(step).isValid).toBe(false);
        expect(getIsSchemaValid("step.schema.json", step)).toBe(false);
    };

    beforeAll(async () => {
        ({ key, getPublicKey } = await createKeys());
        for (const [name, step] of Object.entries(VALID_STEPS)) {
            signedSteps[name] = await sign(step);
        }
    });

    describe("valid steps", () => {
        it.each(Object.keys(VALID_STEPS))("%s passes the code and the schema", (name) => {
            const step = getSigned(name);
            const validation = validateAgentTalkSignedStep(step);

            expect(validation.isValid ? [] : validation.issues).toEqual([]);
            expect(getSchemaErrors("step.schema.json", step)).toEqual([]);
        });

        it.each(Object.keys(VALID_STEPS))("%s with the host's order passes as an ordered step", (name) => {
            const step = { ...getSigned(name), seq: 3 };

            expect(validateAgentTalkStep(step).isValid).toBe(true);
            expect(getIsSchemaValid("step.schema.json#/$defs/orderedStep", step)).toBe(true);
            expect(getIsSchemaValid("step.schema.json#/$defs/orderedStep", getSigned(name))).toBe(false);
            expect(validateAgentTalkStep(getSigned(name)).isValid).toBe(false);
        });
    });

    describe("invalid steps", () => {
        it.each(Object.keys(INVALID_STEPS))("%s is rejected by the code and the schema", (name) => {
            const change = INVALID_STEPS[name];
            if (!change) throw new Error(`no case ${name}`);

            expectBothReject(change(getSigned("ask")));
        });

        it.each(Object.keys(INVALID_ANSWERS))("%s is rejected by the code and the schema", (name) => {
            const change = INVALID_ANSWERS[name];
            if (!change) throw new Error(`no case ${name}`);

            expectBothReject(JSON.parse(JSON.stringify(change(getSigned("answer")))) as JsonObject);
        });

        it.each(Object.keys(INVALID_OTHER_STEPS))("%s is rejected by the code and the schema", (name) => {
            const testCase = INVALID_OTHER_STEPS[name];
            if (!testCase) throw new Error(`no case ${name}`);

            expectBothReject(testCase.change(getSigned(testCase.step)));
        });

        it("rejects a step that is not an object", () => {
            for (const value of [null, [], "step", 1]) {
                expect(validateAgentTalkSignedStep(value).isValid).toBe(false);
                expect(getIsSchemaValid("step.schema.json", value)).toBe(false);
            }
        });
    });

    // what only code can check, and where the code and the schema part ways: each is listed in README.md
    describe("checks only code can do", () => {
        const expectOnlyCodeRejects = (step: JsonObject) => {
            expect(validateAgentTalkSignedStep(step).isValid).toBe(false);
            expect(getIsSchemaValid("step.schema.json", step)).toBe(true);
        };

        it("rejects an ask that expires more than 30 days after at, or before it", () => {
            expectOnlyCodeRejects({ ...getSigned("ask"), expires: "2026-12-21T10:00:00.000Z" });
            expectOnlyCodeRejects({ ...getSigned("ask"), expires: "2026-11-19T10:00:00.000Z" });
        });

        it("rejects an autoUntil past 24 hours or past expires", () => {
            expectOnlyCodeRejects({ ...getSigned("ask"), autoUntil: "2026-11-21T11:00:00.000Z" });
            expectOnlyCodeRejects({ ...getSigned("ask"), expires: "2026-11-20T10:30:00.000Z", autoUntil: "2026-11-20T11:00:00.000Z" });
        });

        it("rejects a time value that ends before it starts", () => {
            expectOnlyCodeRejects({
                ...getSigned("ask"),
                options: [{ id: "a", label: "A", value: { ...TIME_VALUE, end: TIME_VALUE.start } }],
            });
        });

        it("rejects two options with one id", () => {
            expectOnlyCodeRejects({
                ...getSigned("ask"),
                options: [
                    { id: "a", label: "A" },
                    { id: "a", label: "B" },
                ],
            });
        });

        it("rejects an about over 8000 characters and a step over 256000 characters as json", () => {
            expectOnlyCodeRejects({ ...getSigned("say"), about: { "@type": "Order", description: "d".repeat(8_000) } });
            expectOnlyCodeRejects({ ...getSigned("private step type"), padding: "p".repeat(256_000) });
        });

        it("rejects a step nested deeper than 64 levels", () => {
            let nested: JsonObject = {};
            for (let depth = 0; depth < 70; depth++) nested = { nested };
            expectOnlyCodeRejects({ ...getSigned("private step type"), nested });
        });

        it("counts lengths in utf-16 code units, where the schema counts characters", () => {
            expectOnlyCodeRejects({ ...getSigned("ask"), question: "🍝".repeat(101) });
        });

        it("rejects a non-ascii capital in an address, where the schema only rules out A-Z", () => {
            expectOnlyCodeRejects({ ...getSigned("ask"), by: { address: "Émile@example.com", actor: "agent" } });
        });

        it("rejects a leap second, which date-time allows", () => {
            expectOnlyCodeRejects({ ...getSigned("ask"), at: "2026-11-20T23:59:60Z", expires: "2026-11-27T10:00:00Z" });
        });

        it("refuses a date value that is not a real date, on both sides", () => {
            for (const date of ["2026-99-99", "2026-02-30"]) {
                const step = { ...getSigned("ask"), options: [{ id: "a", label: "A", value: { type: "date", text: "?", date } }] };

                expect(validateAgentTalkSignedStep(step).isValid).toBe(false);
                expect(getIsSchemaValid("step.schema.json", step)).toBe(false);
            }
        });

        it("refuses a time on a day that does not exist, or an hour out of range, on both sides", () => {
            for (const at of ["2026-02-30T10:00:00Z", "2026-11-20T24:00:00Z"]) {
                const step = { ...getSigned("resume"), at };

                expect(validateAgentTalkSignedStep(step).isValid).toBe(false);
                expect(getIsSchemaValid("step.schema.json", step)).toBe(false);
            }
        });
    });

    describe("step block", () => {
        const getHtml = (block: unknown): string => `<p>Which evening works?</p>${OPENING_TAG}${JSON.stringify(block)}${CLOSING_TAG}`;

        const createToken = async () =>
            await createAgentTalkToken({
                issuer: ISSUER,
                talkId: "tk_1",
                stepId: "st_1",
                address: MEMBER_ADDRESS,
                expiresAt: new Date(EXPIRES_AT),
                now: NOW,
                key,
            });

        const read = async (html: string) =>
            await readAgentTalkStepBlock({ html, from: MEMBER_ADDRESS, now: NOW, messageId: MESSAGE_ID, getPublicKey });

        it("matches the block the code writes and reads", async () => {
            const formatted = formatAgentTalkStepBlock({ token: await createToken(), step: getSigned("ask") as AgentTalkSignedStep }) ?? "";
            const block: unknown = JSON.parse(formatted.slice(OPENING_TAG.length, -CLOSING_TAG.length));

            expect((await read(formatted)).isValid).toBe(true);
            expect(getSchemaErrors("step-block.schema.json", block)).toEqual([]);
        });

        it("rejects a block of another version, a token that is not a jws, or an invalid step", async () => {
            const token = await createToken();
            const blocks = [
                { v: 2, token, step: getSigned("ask") },
                { v: 1, token: "not-a-token", step: getSigned("ask") },
                { v: 1, token, step: without(getSigned("ask"), "sig") },
            ];

            for (const block of blocks) {
                expect((await read(getHtml(block))).isValid).toBe(false);
                expect(getIsSchemaValid("step-block.schema.json", block)).toBe(false);
            }
        });
    });

    describe("token claims", () => {
        it("matches the presence token the code writes", async () => {
            const token = await createAgentTalkPresenceToken({
                issuer: ISSUER,
                address: MAYA,
                accepts: ["ask", "say"],
                types: ["time", "busy", "text"],
                isOpen: true,
                now: NOW,
                key,
            });
            const { header, claims } = decodeToken(token);

            expect((await checkAgentTalkPresenceToken({ token, from: MAYA, now: NOW, getPublicKey })).isValid).toBe(true);
            expect(getSchemaErrors("presence-token-claims.schema.json", claims)).toEqual([]);
            expect(getSchemaErrors("presence-token-claims.schema.json#/$defs/protectedHeader", header)).toEqual([]);
        });

        it("matches the talk token the code writes", async () => {
            const token = await createAgentTalkToken({
                issuer: ISSUER,
                talkId: "tk_1",
                stepId: "st_1",
                address: MEMBER_ADDRESS,
                expiresAt: new Date(EXPIRES_AT),
                now: NOW,
                key,
            });
            const { header, claims } = decodeToken(token);

            expect((await checkAgentTalkToken({ token, from: MEMBER_ADDRESS, now: NOW, getPublicKey })).isValid).toBe(true);
            expect(getSchemaErrors("talk-token-claims.schema.json", claims)).toEqual([]);
            expect(getSchemaErrors("talk-token-claims.schema.json#/$defs/protectedHeader", header)).toEqual([]);
        });

        it("matches the service token the code writes", async () => {
            const token = await createAgentTalkServiceToken({ issuer: ISSUER, audience: AUDIENCE, now: NOW, key });
            const { header, claims } = decodeToken(token);

            expect((await checkAgentTalkServiceToken({ token, audience: AUDIENCE, now: NOW, getPublicKey })).isValid).toBe(true);
            expect(getSchemaErrors("service-token-claims.schema.json", claims)).toEqual([]);
            expect(getSchemaErrors("service-token-claims.schema.json#/$defs/protectedHeader", header)).toEqual([]);
        });

        it("rejects malformed presence claims on both sides", async () => {
            const iat = Math.floor(NOW.getTime() / 1000);
            const claims = { v: 1, iss: ISSUER, sub: MAYA, acc: ["ask"], types: ["text"], iat, exp: iat + 3600 };
            const header = { alg: "EdDSA", kid: KID, typ: "agent-talk-presence" };
            const invalid = [
                without(claims, "acc"),
                { ...claims, acc: "ask" },
                { ...claims, v: 2 },
                { ...claims, isOpen: "yes" },
                without(claims, "exp"),
            ];

            for (const value of invalid) {
                const token = await signToken(header, value, key);
                expect((await checkAgentTalkPresenceToken({ token, from: MAYA, now: NOW, getPublicKey })).isValid).toBe(false);
                expect(getIsSchemaValid("presence-token-claims.schema.json", value)).toBe(false);
            }
            const wrongType = await signToken({ ...header, typ: "agent-talk-talk" }, claims, key);
            expect((await checkAgentTalkPresenceToken({ token: wrongType, from: MAYA, now: NOW, getPublicKey })).isValid).toBe(false);
            expect(getIsSchemaValid("presence-token-claims.schema.json#/$defs/protectedHeader", decodeToken(wrongType).header)).toBe(false);
        });

        it("rejects malformed talk claims on both sides", async () => {
            const iat = Math.floor(NOW.getTime() / 1000);
            const claims = { v: 1, iss: ISSUER, talk: "tk_1", step: "st_1", sub: MEMBER_ADDRESS, iat, exp: iat + 3600 };
            const header = { alg: "EdDSA", kid: KID, typ: "agent-talk-talk" };
            const invalid = [without(claims, "step"), { ...claims, talk: 1 }, { ...claims, v: 2 }, { ...claims, iat: "now" }];

            for (const value of invalid) {
                const token = await signToken(header, value, key);
                expect((await checkAgentTalkToken({ token, from: MEMBER_ADDRESS, now: NOW, getPublicKey })).isValid).toBe(false);
                expect(getIsSchemaValid("talk-token-claims.schema.json", value)).toBe(false);
            }
        });

        it("rejects malformed service claims on both sides", async () => {
            const iat = Math.floor(NOW.getTime() / 1000);
            const claims = { iss: ISSUER, aud: AUDIENCE, iat, exp: iat + 60, jti: "j1" };
            const header = { alg: "EdDSA", kid: KID, typ: "JWT" };
            const invalid = [without(claims, "jti"), { ...claims, jti: "" }, { ...claims, jti: "j".repeat(129) }, without(claims, "aud")];

            for (const value of invalid) {
                const token = await signToken(header, value, key);
                expect((await checkAgentTalkServiceToken({ token, audience: AUDIENCE, now: NOW, getPublicKey })).isValid).toBe(false);
                expect(getIsSchemaValid("service-token-claims.schema.json", value)).toBe(false);
            }
        });

        // the code's claim checks read types only: the schema's grammar for ids and addresses is stricter
        it("lets claims with a talk id outside the id grammar through in code, which the schema rejects", async () => {
            const iat = Math.floor(NOW.getTime() / 1000);
            const claims = { v: 1, iss: ISSUER, talk: "tk 1", step: "st_1", sub: MEMBER_ADDRESS, iat, exp: iat + 3600 };
            const token = await signToken({ alg: "EdDSA", kid: KID, typ: "agent-talk-talk" }, claims, key);

            expect((await checkAgentTalkToken({ token, from: MEMBER_ADDRESS, now: NOW, getPublicKey })).isValid).toBe(true);
            expect(getIsSchemaValid("talk-token-claims.schema.json", claims)).toBe(false);
        });
    });

    describe("delegation file", () => {
        it.each([
            ["one service", { v: 1, services: [{ svc: "input.so" }] }],
            [
                "a hosted account and local parts",
                { v: 1, services: [{ svc: "intercom.com", acct: "acme_1", local: ["support", "billing"] }] },
            ],
            ["no services", { v: 1, services: [] }],
        ])("%s passes the code and the schema", (_, file) => {
            expect(parseAgentTalkDelegationFile(file)).not.toBeNull();
            expect(getSchemaErrors("delegation-file.schema.json", file)).toEqual([]);
        });

        it.each([
            ["another version", { v: 2, services: [{ svc: "input.so" }] }],
            ["no services list", { v: 1 }],
            ["a service that is not a domain", { v: 1, services: [{ svc: "input" }] }],
            ["an empty local list", { v: 1, services: [{ svc: "input.so", local: [] }] }],
            ["an account with a space", { v: 1, services: [{ svc: "input.so", acct: "acme 1" }] }],
            ["a local part with an @", { v: 1, services: [{ svc: "input.so", local: ["a@b"] }] }],
            ["17 services", { v: 1, services: Array.from({ length: 17 }, () => ({ svc: "input.so" })) }],
        ])("%s is rejected by the code and the schema", (_, file) => {
            expect(parseAgentTalkDelegationFile(file)).toBeNull();
            expect(getIsSchemaValid("delegation-file.schema.json", file)).toBe(false);
        });

        it("normalizes a service and local parts in code, where the schema wants them canonical", () => {
            const file = { v: 1, services: [{ svc: " Input.so ", local: ["Support"] }] };

            expect(parseAgentTalkDelegationFile(file)).toEqual([{ svc: "input.so", local: ["support"] }]);
            expect(getIsSchemaValid("delegation-file.schema.json", file)).toBe(false);
        });
    });

    describe("service document", () => {
        const document: AgentTalkServiceDocument = {
            v: 1,
            issuer: ISSUER,
            name: "Input",
            description: "Input's agent talk service.",
            provider: { organization: "Input", url: "https://input.so" },
            keys: "https://input.so/.well-known/agent-talk-keys.json",
            carriers: [{ type: "https", url: AUDIENCE }],
            doors: "https://example.com/agent-talk/doors/{address}",
        };
        const door = {
            id: "door_1",
            address: MAYA,
            handles: [{ id: "question", name: "Question", description: "Anything its person may answer" }],
        };

        it.each<[string, AgentTalkServiceDocument]>([
            ["a service document", document],
            ["a door document", { ...document, door }],
            ["a service that speaks by email alone", { ...(without(document, "doors") as AgentTalkServiceDocument), carriers: [] }],
            ["an unknown carrier type", { ...document, carriers: [{ type: "a2a", url: "https://example.com/a2a" }, ...document.carriers] }],
        ])("%s passes the code and the schema", async (_, unsigned) => {
            const signed = JSON.parse(JSON.stringify(await signAgentTalkServiceDocument(unsigned, key))) as JsonObject;

            expect(await verifyAgentTalkServiceDocument(signed, ISSUER, getPublicKey)).toBe(true);
            expect(readAgentTalkServiceDocument(signed)).not.toBeNull();
            expect(getSchemaErrors("service-document.schema.json", signed)).toEqual([]);
        });

        it.each([
            ["another version", { ...document, v: 2 }],
            ["keys over http", { ...document, keys: "http://input.so/keys.json" }],
            ["nine carriers", { ...document, carriers: Array.from({ length: 9 }, () => document.carriers[0]) }],
            ["a carrier without a url", { ...document, carriers: [{ type: "https" }] }],
            ["doors without the address variable", { ...document, doors: "https://example.com/agent-talk/doors" }],
            ["a handle without a description", { ...document, door: { ...door, handles: [{ id: "question", name: "Question" }] } }],
            ["eleven handles", { ...document, door: { ...door, handles: Array.from({ length: 11 }, () => door.handles[0]) } }],
            ["no provider", without(document, "provider")],
        ])("%s is rejected by the code and the schema", async (_, unsigned: JsonObject) => {
            const signed = { ...unsigned, signatures: (await signAgentTalkServiceDocument(document, key)).signatures };

            expect(readAgentTalkServiceDocument(signed)).toBeNull();
            expect(getIsSchemaValid("service-document.schema.json", signed)).toBe(false);
        });

        it("wants a signature, which only code can check", async () => {
            const signed = await signAgentTalkServiceDocument(document, key);
            const tampered = { ...signed, name: "Not Input" };

            expect(getIsSchemaValid("service-document.schema.json", without(signed, "signatures"))).toBe(false);
            expect(await verifyAgentTalkServiceDocument(tampered, ISSUER, getPublicKey)).toBe(false);
            expect(getIsSchemaValid("service-document.schema.json", tampered)).toBe(true);
        });
    });

    describe("direct body", () => {
        it.each([
            ["a step", undefined],
            ["a step for a door", "door_1"],
        ])("%s matches the body the code writes and reads", (_, door) => {
            const body = JSON.parse(
                JSON.stringify(createAgentTalkDirectBody({ ...getSigned("ask"), seq: 3 } as AgentTalkSignedStep, door)),
            ) as JsonObject;

            expect(readAgentTalkDirectBody(body).isValid).toBe(true);
            expect(getSchemaErrors("direct-body.schema.json", body)).toEqual([]);
        });

        it.each([
            ["another version", { v: 2, step: {} }],
            ["no step", { v: 1 }],
            ["a step that is not an object", { v: 1, step: "st_1" }],
            ["a door that is not a string", { v: 1, step: {}, door: 7 }],
            ["an empty door", { v: 1, step: {}, door: "" }],
            ["a door of 129 characters", { v: 1, step: {}, door: "d".repeat(129) }],
        ])("%s is rejected by the code and the schema", (_, body) => {
            expect(readAgentTalkDirectBody(body).isValid).toBe(false);
            expect(getIsSchemaValid("direct-body.schema.json", body)).toBe(false);
        });

        it("leaves the step to admission in code, where the schema checks it and wants it without seq", () => {
            const numbered = { v: 1, step: { ...getSigned("ask"), seq: 3 } };
            const unsigned = { v: 1, step: without(getSigned("ask"), "sig") };

            for (const body of [numbered, unsigned]) {
                expect(readAgentTalkDirectBody(body).isValid).toBe(true);
                expect(getIsSchemaValid("direct-body.schema.json", body)).toBe(false);
            }
        });
    });
});
