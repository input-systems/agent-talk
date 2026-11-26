import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_TALK_MEDIA_TYPE, AGENT_TALK_SIGNING_ALGORITHM, AGENT_TALK_VERSION } from "../src/agentTalk.constants.js";
import type {
    AgentTalkPublicKeyResolver,
    AgentTalkSignedStep,
    AgentTalkSigningKey,
    AgentTalkUnsignedStep,
} from "../src/agentTalk.types.js";
import { formatAgentTalkStepBlock, readAgentTalkStepBlock } from "../src/agentTalkBlock.utils.js";
import { createAgentTalkDirectBody, getAgentTalkDirectOutcome, readAgentTalkDirectBody } from "../src/agentTalkDirect.utils.js";
import {
    formatAgentTalkHeader,
    formatAgentTalkLinkHeader,
    parseAgentTalkHeader,
    parseAgentTalkLinkHeader,
} from "../src/agentTalkHeader.utils.js";
import { getCanonicalJson } from "../src/agentTalkJson.utils.js";
import {
    encodeJwsSegment,
    importAgentTalkPublicKeyJwk,
    importAgentTalkSigningKeyJwk,
    signJws,
    toBase64Url,
} from "../src/agentTalkJws.utils.js";
import {
    readAgentTalkServiceDocument,
    signAgentTalkServiceDocument,
    verifyAgentTalkServiceDocument,
} from "../src/agentTalkServiceDocument.utils.js";
import type { AgentTalkServiceDocument } from "../src/agentTalkServiceDocument.utils.js";
import { checkAgentTalkServiceToken, createAgentTalkServiceToken } from "../src/agentTalkServiceToken.utils.js";
import { signAgentTalkStep, verifyAgentTalkStep } from "../src/agentTalkStep.utils.js";
import { validateAgentTalkUnsignedStep } from "../src/agentTalkStepValidation.utils.js";
import {
    checkAgentTalkLinkToken,
    checkAgentTalkPresenceToken,
    checkAgentTalkToken,
    createAgentTalkPresenceToken,
    createAgentTalkToken,
} from "../src/agentTalkToken.utils.js";

// writes the language-neutral test vectors in spec/vectors from fixed keys and a fixed clock. ed25519 signatures are
// deterministic, so a run over unchanged code writes the same bytes. spec/vectors/vectors.test.ts keeps them honest

const VECTORS_VERSION = 1;
const OUTPUT_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..", "spec", "vectors");

// test-only keys, generated once. never use them for anything but these vectors
const SERVICE_KEYS = {
    north: {
        issuer: "north.example",
        kid: "north-2026-11",
        x: "A9SDUPIbdQ9d_dzSDEgUzvdg1hj_k-W95kYvz5FKcQw",
        d: "PMIr3VsVD7vmyo0U2Odk5wCv9khh5nHviXHnOosl0y4",
    },
    south: {
        issuer: "south.example",
        kid: "south-2026-11",
        x: "LZnbF0eBLPRpXmbKkcVBjpojn72eagPWZA4ImakADog",
        d: "GZOV_SGrwUFf-C19V71LJSBtwxRzlSZ96dfJyTTlgvM",
    },
    rogue: {
        issuer: "rogue.example",
        kid: "rogue-2026-11",
        x: "6AJEemK5cjZCEFJk0sH2G00Yr2XVoz2spf464Y1w-5M",
        d: "hrhoxSYCV9US6GIz5vBeLYGznTTwSehPKw5EElceLcM",
    },
} as const;

type ServiceName = keyof typeof SERVICE_KEYS;
type KeyReference = { iss: string; kid: string };

const NOW = new Date("2026-11-21T10:00:00.000Z");
const NOW_SECONDS = NOW.getTime() / 1000;
const DAY_SECONDS = 24 * 60 * 60;
const ASK_EXPIRES = new Date("2026-11-28T10:00:00.000Z");

const ADA = "ada@example.com";
const BEN = "ben@example.org";
const CAROL = "carol@example.com";
const EVE = "eve@example.net";
const TALK_ID = "tk_dinner";
const ASK_MESSAGE_ID = "<ask-1@north.example>";
const REPLY_MESSAGE_ID = "<reply-1@south.example>";
const SOUTH_DIRECT_URL = "https://south.example/agent-talk/steps";

const textEncoder = new TextEncoder();

const getPublicJwk = (name: ServiceName) => {
    const { kid, x } = SERVICE_KEYS[name];
    return { kty: "OKP", crv: "Ed25519", alg: AGENT_TALK_SIGNING_ALGORITHM, use: "sig", kid, x };
};

const getPrivateJwk = (name: ServiceName) => {
    const { kid, x, d } = SERVICE_KEYS[name];
    return { kty: "OKP", crv: "Ed25519", kid, x, d };
};

const getKeyReference = (name: ServiceName): KeyReference => ({ iss: SERVICE_KEYS[name].issuer, kid: SERVICE_KEYS[name].kid });

// what a receiver that recognises north and south holds. rogue is never recognised
const RECEIVER_KEYS: KeyReference[] = [getKeyReference("north"), getKeyReference("south")];

const signingKeys = {
    north: await importAgentTalkSigningKeyJwk(getPrivateJwk("north")),
    south: await importAgentTalkSigningKeyJwk(getPrivateJwk("south")),
    rogue: await importAgentTalkSigningKeyJwk(getPrivateJwk("rogue")),
} satisfies Record<ServiceName, AgentTalkSigningKey>;

const publicKeys = {
    north: await importAgentTalkPublicKeyJwk(getPublicJwk("north")),
    south: await importAgentTalkPublicKeyJwk(getPublicJwk("south")),
    rogue: await importAgentTalkPublicKeyJwk(getPublicJwk("rogue")),
} satisfies Record<ServiceName, CryptoKey>;

const createResolver =
    (held: KeyReference[]): AgentTalkPublicKeyResolver =>
    async (issuer, kid) => {
        const name = (Object.keys(SERVICE_KEYS) as ServiceName[]).find(
            (candidate) => SERVICE_KEYS[candidate].issuer === issuer && SERVICE_KEYS[candidate].kid === kid,
        );
        const isHeld = held.some((reference) => reference.iss === issuer && reference.kid === kid);
        return await Promise.resolve(name && isHeld ? publicKeys[name] : null);
    };

const receiverResolver = createResolver(RECEIVER_KEYS);

// a key that signs as `as` names it (its kid in the header) with the private key of `with`: a wrong key
const getMislabelledKey = (as: ServiceName, withKey: ServiceName): AgentTalkSigningKey => ({
    kid: SERVICE_KEYS[as].kid,
    privateKey: signingKeys[withKey].privateKey,
});

const fromBase64UrlJson = (segment: string): unknown => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));

// the token with its payload swapped for another and the old signature kept
const tamperPayload = (token: string, change: (payload: Record<string, unknown>) => Record<string, unknown>): string => {
    const [header = "", payload = "", signature = ""] = token.split(".");
    return `${header}.${encodeJwsSegment(change(fromBase64UrlJson(payload) as Record<string, unknown>))}.${signature}`;
};

const writeVectors = (fileName: string, description: string, cases: unknown[]) => {
    const content = { description, version: VECTORS_VERSION, cases };
    writeFileSync(join(OUTPUT_DIRECTORY, fileName), `${JSON.stringify(content, null, 2)}\n`);
    console.log(`${fileName}: ${cases.length} cases`);
};

// keys

const keyCases = (Object.keys(SERVICE_KEYS) as ServiceName[]).map((name) => ({
    name: SERVICE_KEYS[name].issuer,
    description:
        name === "rogue"
            ? "A service no receiver in these vectors recognises. Its keys are here so the signatures it makes can be reproduced; receivers never hold them."
            : "A service the receiver in these vectors recognises and already holds the keys of.",
    issuer: SERVICE_KEYS[name].issuer,
    isRecognised: name !== "rogue",
    publicJwks: { keys: [getPublicJwk(name)] },
    testOnlyPrivateJwk: getPrivateJwk(name),
}));

// canonical json

const nested = (depth: number): string => `${"[".repeat(depth)}${"]".repeat(depth)}`;

const canonicalInputs: { name: string; description: string; inputJson: string }[] = [
    {
        name: "key order",
        description: "Object keys sorted, whitespace removed.",
        inputJson: '{ "b": 2, "a": 1, "c": { "z": true, "y": null } }',
    },
    {
        name: "keys sort by utf-16 code units",
        description:
            "Sorting is by UTF-16 code units, not code points: U+1F600 (surrogates D83D DE00) sorts before U+FB01, and capitals before lowercase.",
        inputJson: '{ "\\ufb01": 1, "\\ud83d\\ude00": 2, "a": 3, "B": 4, "\\u00e9": 5, "": 6 }',
    },
    {
        name: "arrays keep their order",
        description: "Only object keys are sorted.",
        inputJson: '[3, 1, 2, { "b": [ "y", "x" ], "a": [] }]',
    },
    {
        name: "numbers",
        description:
            "Numbers print in their shortest ECMAScript form. 9007199254740993 is past double precision and parses as 9007199254740992 (I-JSON keeps integers within 2^53).",
        inputJson:
            "[1.0, -0, 1e3, 1E-7, 0.000001, 1e21, 100000000000000000000, 123456789012345680000, 0.1, 3.14159, -1.5e-10, 9007199254740993]",
    },
    {
        name: "string escapes",
        description:
            "Only the quote, the backslash and control characters are escaped; \\b \\f \\n \\r \\t use their short forms, other controls below U+0020 \\u00xx in lowercase. The slash and U+007F stay literal.",
        inputJson: '"quote \\" backslash \\\\ slash \\/ controls \\b\\f\\n\\r\\t\\u0000\\u001f\\u007f"',
    },
    {
        name: "unicode stays literal",
        description: "Non-ASCII characters, U+2028 and U+2029 are written as themselves, not escaped.",
        inputJson: '{ "text": "Caf\\u00e9 \\u20ac \\ud83c\\udf77 \\u2028 \\u2029" }',
    },
    {
        name: "markup stays literal",
        description: "JCS leaves < > & alone. Only a step block escapes them (see blocks.json), after canonicalisation.",
        inputJson: '{ "text": "</script><!-- R&D -->" }',
    },
    {
        name: "nested",
        description: "Every level is sorted.",
        inputJson:
            '{ "step": { "by": { "address": "ada@example.com", "actor": "agent" }, "at": "2026-11-21T10:00:00.000Z", "id": "st_1" }, "v": 1 }',
    },
    { name: "literals", description: "true, false and null.", inputJson: '{ "t": true, "f": false, "n": null }' },
    {
        name: "nesting at the limit",
        description:
            "65 nested arrays, 64 levels below the top: the deepest this implementation canonicalises (protocol 4.2 caps a step at 64 levels).",
        inputJson: nested(65),
    },
    { name: "nesting past the limit", description: "66 nested arrays: refused.", inputJson: nested(66) },
    { name: "non-finite number", description: "1e400 parses to infinity, which JSON cannot hold: refused.", inputJson: "[1e400]" },
];

const canonicalCases = canonicalInputs.map((input) => {
    let expected: { canonical: string } | { error: true };
    try {
        expected = { canonical: getCanonicalJson(JSON.parse(input.inputJson)) };
    } catch {
        expected = { error: true };
    }
    return { ...input, expected };
});

// steps

const adaBy = { address: ADA, actor: "agent" } as const;
const benBy = { address: BEN, actor: "person" } as const;

const TUESDAY_OPTION = {
    id: "tue",
    label: "Tuesday · 7:30 PM",
    isRecommended: true,
    value: {
        type: "time",
        text: "Tue 24 Nov, 19:30–21:30",
        start: "2026-11-24T19:30:00+01:00",
        end: "2026-11-24T21:30:00+01:00",
        timeZone: "Europe/Amsterdam",
    },
} as const;

const askStep: AgentTalkUnsignedStep = {
    id: "st_ask",
    talk: TALK_ID,
    at: NOW.toISOString(),
    by: adaBy,
    email: ASK_MESSAGE_ID,
    text: "Ada's agent asks which evening works for dinner.",
    type: "ask",
    to: [BEN],
    question: "Which evening works for dinner?",
    context: ["Both free after 7"],
    options: [TUESDAY_OPTION, { id: "thu", label: "Thursday · 8:00 PM" }],
    can: { counter: true, decline: true, text: false },
    answerBy: "personOrAgent",
    needs: ["calendar.book"],
    effect: "event",
    autoUntil: "2026-11-21T11:00:00.000Z",
    expires: ASK_EXPIRES.toISOString(),
};

const answerStep: AgentTalkUnsignedStep = {
    id: "st_answer",
    talk: TALK_ID,
    at: "2026-11-21T10:30:00.000Z",
    by: benBy,
    re: "st_ask",
    email: REPLY_MESSAGE_ID,
    text: "Ben picked Tuesday at 7:30 PM.",
    type: "answer",
    result: "answered",
    picks: ["tue"],
    receipt: { shared: "Ben's choice of evening" },
};

const saySteps: { name: string; step: AgentTalkUnsignedStep }[] = [
    {
        name: "say with values and about",
        step: {
            id: "st_say",
            talk: TALK_ID,
            at: "2026-11-21T10:05:00.000Z",
            by: adaBy,
            text: "Ada's agent shares the restaurant and the deposit.",
            type: "say",
            values: [
                { type: "place", text: "Café Riche, Amsterdam", name: "Café Riche", address: "Damrak 1, Amsterdam" },
                { type: "amount", text: "€20.00 deposit", currency: "EUR", amount: "20.00" },
                { type: "contact", text: "Ada", address: ADA, name: "Ada" },
            ],
            about: { "@type": "FoodEstablishmentReservation", reservationStatus: "ReservationPending" },
        },
    },
    {
        name: "say with unicode and markup in text",
        step: {
            id: "st_unicode",
            talk: TALK_ID,
            at: "2026-11-21T10:06:00.000Z",
            by: adaBy,
            text: 'Café 🍷 at 7 — <b>R&D</b>   "quoted"',
            type: "say",
        },
    },
];

const otherSteps: { name: string; step: AgentTalkUnsignedStep }[] = [
    { name: "ask", step: askStep },
    { name: "answer", step: answerStep },
    ...saySteps,
    {
        name: "wait",
        step: {
            id: "st_wait",
            talk: TALK_ID,
            at: "2026-11-21T10:10:00.000Z",
            by: adaBy,
            re: "st_ask",
            text: "Ada will decide.",
            type: "wait",
        },
    },
    {
        name: "hold",
        step: {
            id: "st_hold",
            talk: TALK_ID,
            at: "2026-11-21T10:11:00.000Z",
            by: adaBy,
            text: "Paused: someone new joined the thread.",
            type: "hold",
            reason: "audience",
            addresses: [CAROL],
        },
    },
    {
        name: "resume",
        step: { id: "st_resume", talk: TALK_ID, at: "2026-11-21T10:12:00.000Z", by: benBy, text: "Ben resumed the talk.", type: "resume" },
    },
    {
        name: "close",
        step: {
            id: "st_close",
            talk: TALK_ID,
            at: "2026-11-21T10:40:00.000Z",
            by: adaBy,
            text: "Dinner is booked for Tuesday at 7:30 PM.",
            type: "close",
            reason: "done",
            outcome: [
                {
                    type: "time",
                    text: "Tue 24 Nov, 19:30–21:30",
                    start: "2026-11-24T19:30:00+01:00",
                    end: "2026-11-24T21:30:00+01:00",
                    timeZone: "Europe/Amsterdam",
                },
            ],
        },
    },
    {
        name: "private type",
        step: {
            id: "st_vote",
            talk: TALK_ID,
            at: "2026-11-21T10:13:00.000Z",
            by: adaBy,
            text: "Ada's agent opened a vote.",
            type: "x-vote",
        },
    },
];

const getSigner = (step: AgentTalkUnsignedStep): ServiceName => (step.by.address === BEN ? "south" : "north");

for (const { name, step } of otherSteps) {
    const validation = validateAgentTalkUnsignedStep(step);
    if (!validation.isValid) throw new Error(`the ${name} step is not valid: ${JSON.stringify(validation.issues)}`);
}

const signCases = await Promise.all(
    otherSteps.map(async ({ name, step }) => {
        const signer = getSigner(step);
        const protectedHeader = { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: SERVICE_KEYS[signer].kid };
        const canonicalPayload = getCanonicalJson(step);
        const signingInput = `${encodeJwsSegment(protectedHeader)}.${toBase64Url(textEncoder.encode(canonicalPayload))}`;
        return {
            kind: "sign",
            name: `sign ${name}`,
            description: `The ${name} step, signed by ${SERVICE_KEYS[signer].issuer}: a detached compact JWS over the step in JCS, without seq and sig.`,
            signer: SERVICE_KEYS[signer].issuer,
            step,
            expected: {
                protectedHeader,
                canonicalPayload,
                signingInput,
                sig: await signAgentTalkStep(step, signingKeys[signer]),
            },
        };
    }),
);

const signStep = async (
    step: AgentTalkUnsignedStep,
    key: AgentTalkSigningKey = signingKeys[getSigner(step)],
): Promise<AgentTalkSignedStep> => ({
    ...step,
    sig: await signAgentTalkStep(step, key),
});

const signedAsk = await signStep(askStep);
const signedAnswer = await signStep(answerStep);
const [askSigHeader = "", , askSigSignature = ""] = signedAsk.sig.split(".");

const verifyInputs: { name: string; description: string; step: unknown; issuer: string; receiverKeys?: KeyReference[] }[] = [
    { name: "valid", description: "The ask as north.example signed it.", step: signedAsk, issuer: "north.example" },
    {
        name: "valid with seq",
        description: "seq is the host's order and is not signed: adding it keeps the signature.",
        step: { ...signedAsk, seq: 7 },
        issuer: "north.example",
    },
    {
        name: "valid with keys in another order",
        description: "The payload is the step in JCS, so the order the keys arrive in does not matter.",
        step: Object.fromEntries(Object.entries(signedAsk).reverse()),
        issuer: "north.example",
    },
    {
        name: "tampered text",
        description: "text changed after signing.",
        step: { ...signedAsk, text: "Ada's agent asks which evening works." },
        issuer: "north.example",
    },
    {
        name: "tampered nested field",
        description: "One option's label changed after signing.",
        step: { ...signedAsk, options: [TUESDAY_OPTION, { id: "thu", label: "Friday · 8:00 PM" }] },
        issuer: "north.example",
    },
    {
        name: "added field",
        description: "A field added after signing is part of the payload, so the signature fails.",
        step: { ...signedAsk, via: "app" },
        issuer: "north.example",
    },
    {
        name: "wrong key",
        description: "Signed with south.example's private key under north.example's kid.",
        step: await signStep(askStep, getMislabelledKey("north", "south")),
        issuer: "north.example",
    },
    {
        name: "other issuer",
        description:
            "A step north.example signed, checked as south.example's: the receiver holds no key for south.example under north.example's kid.",
        step: signedAsk,
        issuer: "south.example",
    },
    {
        name: "unknown issuer",
        description: "Signed by rogue.example, whose keys the receiver does not hold.",
        step: await signStep(askStep, signingKeys.rogue),
        issuer: "rogue.example",
    },
    {
        name: "unknown issuer even with its key",
        description:
            "The same rogue step, for a receiver that does hold rogue.example's key: it verifies. Recognition is the receiver's list, not the signature.",
        step: await signStep(askStep, signingKeys.rogue),
        issuer: "rogue.example",
        receiverKeys: [...RECEIVER_KEYS, getKeyReference("rogue")],
    },
    {
        name: "attached payload",
        description: "A sig whose middle segment is not empty is not a detached JWS.",
        step: { ...signedAsk, sig: `${askSigHeader}.${encodeJwsSegment({ id: "st_ask" })}.${askSigSignature}` },
        issuer: "north.example",
    },
    {
        name: "alg none",
        description: "A protected header that does not say EdDSA.",
        step: { ...signedAsk, sig: `${encodeJwsSegment({ alg: "none", kid: SERVICE_KEYS.north.kid })}..${askSigSignature}` },
        issuer: "north.example",
    },
];

const verifyCases = await Promise.all(
    verifyInputs.map(async (input) => {
        const receiverKeys = input.receiverKeys ?? RECEIVER_KEYS;
        const isValid = await verifyAgentTalkStep(input.step as AgentTalkSignedStep, input.issuer, createResolver(receiverKeys));
        return {
            kind: "verify",
            name: `verify ${input.name}`,
            description: input.description,
            step: input.step,
            issuer: input.issuer,
            receiverKeys,
            expected: { isValid },
        };
    }),
);

// presence tokens

const presenceToken = await createAgentTalkPresenceToken({
    issuer: SERVICE_KEYS.north.issuer,
    address: ADA,
    accepts: ["ask", "say"],
    types: ["time", "busy", "text"],
    now: NOW,
    key: signingKeys.north,
});

// a null typ leaves it out of the header
const signPresence = async (
    claims: Record<string, unknown>,
    key: AgentTalkSigningKey = signingKeys.north,
    typ: string | null = "agent-talk-presence",
) => await signJws(claims, { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: key.kid, ...(typ === null ? {} : { typ }) }, key.privateKey);

const presenceClaims = {
    v: AGENT_TALK_VERSION,
    iss: SERVICE_KEYS.north.issuer,
    sub: ADA,
    acc: ["ask", "say"],
    types: ["time", "busy", "text"],
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 90 * DAY_SECONDS,
};

const talkToken = await createAgentTalkToken({
    issuer: SERVICE_KEYS.north.issuer,
    talkId: TALK_ID,
    stepId: "st_ask",
    address: ADA,
    expiresAt: ASK_EXPIRES,
    now: NOW,
    key: signingKeys.north,
});

type TokenInput = {
    name: string;
    description: string;
    token: string;
    from: string | null;
    now?: Date;
    receiverKeys?: KeyReference[];
    // the service whose key really made the token's signature over its own segments; absent when it was tampered with
    signer?: ServiceName;
};

const presenceInputs: TokenInput[] = [
    {
        name: "valid",
        description: "Ada's presence, signed by north.example, on mail from Ada.",
        token: presenceToken,
        from: ADA,
        signer: "north",
    },
    {
        name: "valid with From in another case",
        description: "The From address is compared trimmed and lowercased.",
        token: presenceToken,
        from: " Ada@Example.COM ",
        signer: "north",
    },
    {
        name: "valid with isOpen",
        description: "An open address sets isOpen: true.",
        token: await createAgentTalkPresenceToken({
            issuer: SERVICE_KEYS.north.issuer,
            address: "Support@Example.com",
            accepts: ["ask"],
            types: ["text"],
            isOpen: true,
            now: NOW,
            key: signingKeys.north,
        }),
        from: "support@example.com",
        signer: "north",
    },
    { name: "From mismatch", description: "Ada's token on mail from Ben.", token: presenceToken, from: BEN, signer: "north" },
    {
        name: "quoted token",
        description:
            "Ben's reply quotes Ada's mail, and the token is lifted from the quote: it names Ada, not Ben. (Reading tokens only from the message itself is the caller's job, protocol 3.2 item 4.)",
        token: presenceToken,
        from: BEN,
        signer: "north",
    },
    {
        name: "at the clock skew limit",
        description: "iat 5 minutes ahead of the receiver's clock still counts.",
        token: await signPresence({ ...presenceClaims, iat: NOW_SECONDS + 300, exp: NOW_SECONDS + 300 + 90 * DAY_SECONDS }),
        from: ADA,
        signer: "north",
    },
    {
        name: "post-dated",
        description: "iat 5 minutes and 1 second ahead of the receiver's clock.",
        token: await signPresence({ ...presenceClaims, iat: NOW_SECONDS + 301, exp: NOW_SECONDS + 301 + 90 * DAY_SECONDS }),
        from: ADA,
        signer: "north",
    },
    {
        name: "valid one second before exp",
        description: "Checked at exp - 1.",
        token: presenceToken,
        from: ADA,
        now: new Date((presenceClaims.exp - 1) * 1000),
        signer: "north",
    },
    {
        name: "expired at exp",
        description: "Checked at exactly exp: a token counts only while now < exp.",
        token: presenceToken,
        from: ADA,
        now: new Date(presenceClaims.exp * 1000),
        signer: "north",
    },
    {
        name: "lifetime of exactly 90 days",
        description: "exp - iat = 90 days is allowed.",
        token: await signPresence(presenceClaims),
        from: ADA,
        signer: "north",
    },
    {
        name: "too long",
        description: "exp - iat = 90 days and 1 second.",
        token: await signPresence({ ...presenceClaims, exp: presenceClaims.exp + 1 }),
        from: ADA,
        signer: "north",
    },
    {
        name: "wrong version",
        description: "v: 2, correctly signed.",
        token: await signPresence({ ...presenceClaims, v: 2 }),
        from: ADA,
        signer: "north",
    },
    {
        name: "tampered sub",
        description: "sub changed to Ben after signing, on mail from Ben: the signature fails before From is compared.",
        token: tamperPayload(presenceToken, (payload) => ({ ...payload, sub: BEN })),
        from: BEN,
    },
    {
        name: "wrong key",
        description: "Signed with south.example's private key under north.example's kid.",
        token: await signPresence(presenceClaims, getMislabelledKey("north", "south")),
        from: ADA,
        signer: "south",
    },
    {
        name: "unknown issuer",
        description: "Eve's presence, signed by rogue.example, which the receiver does not recognise.",
        token: await signPresence({ ...presenceClaims, iss: SERVICE_KEYS.rogue.issuer, sub: EVE }, signingKeys.rogue),
        from: EVE,
        signer: "rogue",
    },
    {
        name: "unknown kid",
        description: "north.example as issuer, under a kid the receiver does not hold.",
        token: await signPresence(presenceClaims, { kid: "north-2025-01", privateKey: signingKeys.north.privateKey }),
        from: ADA,
        signer: "north",
    },
    {
        name: "issuer and kid of different services",
        description:
            "iss north.example with south.example's kid, signed by south: keys are looked up by the pair, which the receiver does not hold.",
        token: await signPresence(presenceClaims, signingKeys.south),
        from: ADA,
        signer: "south",
    },
    {
        name: "talk token as presence",
        description: "A talk token: its typ is not agent-talk-presence.",
        token: talkToken,
        from: ADA,
        signer: "north",
    },
    {
        name: "no typ",
        description: "Presence claims under a header with no typ.",
        token: await signPresence(presenceClaims, signingKeys.north, null),
        from: ADA,
        signer: "north",
    },
    {
        name: "missing claim",
        description: "No acc.",
        token: await signPresence({ ...presenceClaims, acc: undefined }),
        from: ADA,
        signer: "north",
    },
    { name: "not a jws", description: "Two segments.", token: "eyJhbGciOiJFZERTQSJ9.eyJ2IjoxfQ", from: ADA },
    {
        name: "alg none",
        description: "A header that says none, with no signature.",
        token: `${encodeJwsSegment({ alg: "none", kid: SERVICE_KEYS.north.kid, typ: "agent-talk-presence" })}.${encodeJwsSegment(presenceClaims)}.`,
        from: ADA,
    },
    {
        name: "not base64url",
        description: "Padding and + in a segment.",
        token: `${presenceToken.split(".")[0]}.ab+c=.${presenceToken.split(".")[2]}`,
        from: ADA,
    },
];

const talkInputs: TokenInput[] = [
    { name: "valid", description: "The talk token for Ada's ask, on mail from Ada.", token: talkToken, from: ADA, signer: "north" },
    {
        name: "valid from a link",
        description: "The same token read from an answer link: there is no From to match (from is null).",
        token: talkToken,
        from: null,
        signer: "north",
    },
    { name: "From mismatch", description: "Ada's talk token on mail from Ben.", token: talkToken, from: BEN, signer: "north" },
    {
        name: "quoted token",
        description:
            "Ben's reply quotes Ada's mail, and the token is lifted from the quote. (Reading tokens only from the message itself is the caller's job, protocol 8.3.)",
        token: talkToken,
        from: BEN,
        signer: "north",
    },
    { name: "expired at exp", description: "Checked at the ask's expiry.", token: talkToken, from: ADA, now: ASK_EXPIRES, signer: "north" },
    {
        name: "expired from a link",
        description: "A link token dies with its ask too.",
        token: talkToken,
        from: null,
        now: ASK_EXPIRES,
        signer: "north",
    },
    {
        name: "lifetime of exactly 30 days",
        description: "exp - iat = 30 days is allowed.",
        token: await createAgentTalkToken({
            issuer: SERVICE_KEYS.north.issuer,
            talkId: TALK_ID,
            stepId: "st_ask",
            address: ADA,
            expiresAt: new Date((NOW_SECONDS + 30 * DAY_SECONDS) * 1000),
            now: NOW,
            key: signingKeys.north,
        }),
        from: ADA,
        signer: "north",
    },
    {
        name: "too long",
        description: "exp - iat = 30 days and 1 second.",
        token: await createAgentTalkToken({
            issuer: SERVICE_KEYS.north.issuer,
            talkId: TALK_ID,
            stepId: "st_ask",
            address: ADA,
            expiresAt: new Date((NOW_SECONDS + 30 * DAY_SECONDS + 1) * 1000),
            now: NOW,
            key: signingKeys.north,
        }),
        from: ADA,
        signer: "north",
    },
    {
        name: "post-dated",
        description: "iat 5 minutes and 1 second ahead of the receiver's clock.",
        token: await createAgentTalkToken({
            issuer: SERVICE_KEYS.north.issuer,
            talkId: TALK_ID,
            stepId: "st_ask",
            address: ADA,
            expiresAt: ASK_EXPIRES,
            now: new Date((NOW_SECONDS + 301) * 1000),
            key: signingKeys.north,
        }),
        from: ADA,
        signer: "north",
    },
    {
        name: "wrong version",
        description: "v: 2, correctly signed.",
        token: await signJws(
            { ...(fromBase64UrlJson(talkToken.split(".")[1] ?? "") as Record<string, unknown>), v: 2 },
            { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: SERVICE_KEYS.north.kid, typ: "agent-talk-talk" },
            signingKeys.north.privateKey,
        ),
        from: ADA,
        signer: "north",
    },
    {
        name: "tampered step",
        description: "step changed after signing.",
        token: tamperPayload(talkToken, (payload) => ({ ...payload, step: "st_other" })),
        from: ADA,
    },
    {
        name: "unknown issuer",
        description: "Signed by rogue.example.",
        token: await createAgentTalkToken({
            issuer: SERVICE_KEYS.rogue.issuer,
            talkId: TALK_ID,
            stepId: "st_ask",
            address: EVE,
            expiresAt: ASK_EXPIRES,
            now: NOW,
            key: signingKeys.rogue,
        }),
        from: EVE,
        signer: "rogue",
    },
    {
        name: "presence token as talk token",
        description: "A presence token: its typ is not agent-talk-talk.",
        token: presenceToken,
        from: ADA,
        signer: "north",
    },
];

const createTokenCases = async (
    inputs: TokenInput[],
    check: (input: { token: string; from: string | null; now: Date; getPublicKey: AgentTalkPublicKeyResolver }) => Promise<unknown>,
) =>
    await Promise.all(
        inputs.map(async (input) => {
            const now = input.now ?? NOW;
            const receiverKeys = input.receiverKeys ?? RECEIVER_KEYS;
            return {
                name: input.name,
                description: input.description,
                token: input.token,
                from: input.from,
                now: now.toISOString(),
                receiverKeys,
                ...(input.signer ? { signer: SERVICE_KEYS[input.signer].issuer } : {}),
                expected: await check({ token: input.token, from: input.from, now, getPublicKey: createResolver(receiverKeys) }),
            };
        }),
    );

const presenceCases = await createTokenCases(presenceInputs, async ({ token, from, now, getPublicKey }) => {
    if (from === null) throw new Error("a presence token is always checked against a From");
    return await checkAgentTalkPresenceToken({ token, from, now, getPublicKey });
});

const talkCases = await createTokenCases(talkInputs, async ({ token, from, now, getPublicKey }) =>
    from === null
        ? await checkAgentTalkLinkToken({ token, now, getPublicKey })
        : await checkAgentTalkToken({ token, from, now, getPublicKey }),
);

// service tokens

const createServiceToken = async (overrides: { now?: Date; audience?: string; key?: AgentTalkSigningKey; issuer?: string } = {}) =>
    await createAgentTalkServiceToken({
        issuer: overrides.issuer ?? SERVICE_KEYS.north.issuer,
        audience: overrides.audience ?? SOUTH_DIRECT_URL,
        now: overrides.now ?? NOW,
        key: overrides.key ?? signingKeys.north,
        jti: "0b6f2c1e-6a51-4d3e-9a43-3f1b7c2a9d10",
    });

const serviceToken = await createServiceToken();
const serviceClaims = fromBase64UrlJson(serviceToken.split(".")[1] ?? "") as Record<string, unknown>;

const signServiceClaims = async (claims: Record<string, unknown>, typ = "JWT") =>
    await signJws(claims, { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: SERVICE_KEYS.north.kid, typ }, signingKeys.north.privateKey);

type ServiceTokenInput = Omit<TokenInput, "from"> & { audience?: string };

const serviceInputs: ServiceTokenInput[] = [
    { name: "valid", description: "north.example calls south.example's direct url.", token: serviceToken, signer: "north" },
    {
        name: "wrong audience",
        description: "A token for another url.",
        token: serviceToken,
        audience: "https://south.example/other",
        signer: "north",
    },
    {
        name: "valid one second before exp",
        description: "Checked at exp - 1.",
        token: serviceToken,
        now: new Date((NOW_SECONDS + 299) * 1000),
        signer: "north",
    },
    {
        name: "expired at exp",
        description: "Checked at exactly exp.",
        token: serviceToken,
        now: new Date((NOW_SECONDS + 300) * 1000),
        signer: "north",
    },
    {
        name: "at the clock skew limit",
        description: "iat 5 minutes ahead of the receiver's clock.",
        token: await createServiceToken({ now: new Date((NOW_SECONDS + 300) * 1000) }),
        signer: "north",
    },
    {
        name: "post-dated",
        description: "iat 5 minutes and 1 second ahead of the receiver's clock.",
        token: await createServiceToken({ now: new Date((NOW_SECONDS + 301) * 1000) }),
        signer: "north",
    },
    {
        name: "too long",
        description: "exp - iat = 5 minutes and 1 second.",
        token: await signServiceClaims({ ...serviceClaims, exp: NOW_SECONDS + 301 }),
        signer: "north",
    },
    {
        name: "tampered audience",
        description: "aud changed after signing.",
        token: tamperPayload(serviceToken, (payload) => ({ ...payload, aud: "https://south.example/agent-talk/steps/" })),
    },
    {
        name: "wrong key",
        description: "Signed with south.example's private key under north.example's kid.",
        token: await createServiceToken({ key: getMislabelledKey("north", "south") }),
        signer: "south",
    },
    {
        name: "unknown issuer",
        description: "rogue.example calls: the receiver does not hold its key.",
        token: await createServiceToken({ issuer: SERVICE_KEYS.rogue.issuer, key: signingKeys.rogue }),
        signer: "rogue",
    },
    { name: "presence token as service token", description: "Its typ is not JWT.", token: presenceToken, signer: "north" },
    {
        name: "empty jti",
        description: "jti must be 1 to 128 characters.",
        token: await signServiceClaims({ ...serviceClaims, jti: "" }),
        signer: "north",
    },
    {
        name: "jti too long",
        description: "A jti of 129 characters.",
        token: await signServiceClaims({ ...serviceClaims, jti: "j".repeat(129) }),
        signer: "north",
    },
    {
        name: "missing aud",
        description: "No aud claim.",
        token: await signServiceClaims({ ...serviceClaims, aud: undefined }),
        signer: "north",
    },
];

const serviceCases = await Promise.all(
    serviceInputs.map(async (input) => {
        const now = input.now ?? NOW;
        const receiverKeys = input.receiverKeys ?? RECEIVER_KEYS;
        const audience = input.audience ?? SOUTH_DIRECT_URL;
        return {
            name: input.name,
            description: input.description,
            token: input.token,
            audience,
            now: now.toISOString(),
            receiverKeys,
            ...(input.signer ? { signer: SERVICE_KEYS[input.signer].issuer } : {}),
            expected: await checkAgentTalkServiceToken({ token: input.token, audience, now, getPublicKey: createResolver(receiverKeys) }),
        };
    }),
);

// headers

const longAddressPresence = await createAgentTalkPresenceToken({
    issuer: SERVICE_KEYS.north.issuer,
    address: `${"a".repeat(68)}@example.com`,
    accepts: ["ask", "say"],
    types: ["time", "busy", "text"],
    now: NOW,
    key: signingKeys.north,
});

const headerFormatInputs: { name: string; description: string; input: { presence?: string; talk?: string } }[] = [
    { name: "format presence only", description: "Plain mail carries only the presence token.", input: { presence: presenceToken } },
    {
        name: "format presence and talk",
        description: "A message that voices a step adds t.",
        input: { presence: presenceToken, talk: talkToken },
    },
    {
        name: "format drops t past 870 characters",
        description:
            "With an 80-character address the value would pass 870 characters, so t is left out; the block and the link still carry it.",
        input: { presence: longAddressPresence, talk: talkToken },
    },
    { name: "format talk only", description: "No presence token (the person turned it off).", input: { talk: talkToken } },
];

const headerParseInputs: { name: string; description: string; input: string }[] = [
    { name: "parse presence and talk", description: "The usual header.", input: `v=1; p=${presenceToken}; t=${talkToken}` },
    {
        name: "parse folded",
        description: "Folding whitespace (CRLF and spaces) anywhere is removed before parsing.",
        input: `v=1;\r\n p=${presenceToken.slice(0, 40)}\r\n ${presenceToken.slice(40)};\r\n\tt=${talkToken}`,
    },
    {
        name: "parse unknown parameters and case",
        description: "Unknown parameters are ignored and names are case-insensitive.",
        input: `V=1; X=abc; P=${presenceToken}`,
    },
    {
        name: "parse later version",
        description: "A higher integer v parses; whether to act on it is the caller's.",
        input: `v=2; p=${presenceToken}`,
    },
    {
        name: "parse drops a token that is not a compact jws",
        description: "t with two segments is dropped.",
        input: `v=1; p=${presenceToken}; t=abc.def`,
    },
    { name: "parse empty token", description: "An empty p is dropped.", input: "v=1; p=" },
    { name: "parse missing v", description: "No v: not an agent talk header.", input: `p=${presenceToken}` },
    { name: "parse v zero", description: "v must be an integer of at least 1.", input: "v=0" },
    { name: "parse v not a number", description: "v must be an integer.", input: "v=one" },
    { name: "parse v fraction", description: "v must be an integer.", input: "v=1.5" },
];

const linkInputs: { name: string; description: string; input: string }[] = [
    { name: "parse link", description: "An https URL in angle brackets.", input: `<https://north.example/t/${talkToken}>` },
    {
        name: "parse link with spaces",
        description: "Surrounding whitespace is allowed.",
        input: `  <https://north.example/t/${talkToken}>  `,
    },
    { name: "parse link not https", description: "Only https counts.", input: `<http://north.example/t/${talkToken}>` },
    { name: "parse link without brackets", description: "The brackets are required.", input: `https://north.example/t/${talkToken}` },
];

const headerCases = [
    ...headerFormatInputs.map((input) => {
        const expected = formatAgentTalkHeader(input.input);
        return { kind: "format", ...input, expected: { value: expected, length: expected.length } };
    }),
    ...headerParseInputs.map((input) => ({ kind: "parse", ...input, expected: parseAgentTalkHeader(input.input) })),
    {
        kind: "formatLink",
        name: "format link",
        description: "The X-Agent-Talk-Link value.",
        input: `https://north.example/t/${talkToken}`,
        expected: formatAgentTalkLinkHeader(`https://north.example/t/${talkToken}`),
    },
    ...linkInputs.map((input) => ({ kind: "parseLink", ...input, expected: parseAgentTalkLinkHeader(input.input) })),
];

// blocks

const createTalkToken = async (input: {
    service: ServiceName;
    stepId: string;
    address: string;
    talkId?: string;
    key?: AgentTalkSigningKey;
}) =>
    await createAgentTalkToken({
        issuer: SERVICE_KEYS[input.service].issuer,
        talkId: input.talkId ?? TALK_ID,
        stepId: input.stepId,
        address: input.address,
        expiresAt: ASK_EXPIRES,
        now: NOW,
        key: input.key ?? signingKeys[input.service],
    });

const formatBlock = (token: string, step: unknown): string => {
    const block = formatAgentTalkStepBlock({ token, step: step as AgentTalkSignedStep });
    if (block === null) throw new Error("the block does not fit");
    return block;
};

const askBlock = formatBlock(talkToken, signedAsk);
const answerTalkToken = await createTalkToken({ service: "south", stepId: "st_answer", address: BEN });
const answerBlock = formatBlock(answerTalkToken, signedAnswer);

const askHtml = (block: string) =>
    `<html><body><p>Which evening works for dinner? Tuesday at 7:30 or Thursday at 8?</p>${block}</body></html>`;
const quoteHtml = (inner: string) =>
    `<div class="gmail_quote"><div class="gmail_attr">On Sat, 21 Nov 2026 at 11:00, Ada &lt;${ADA}&gt; wrote:</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${inner}</blockquote></div>`;

const scriptText = "</script><script>alert(1)</script><!-- R&D   -->";
const scriptStep: AgentTalkUnsignedStep = { ...askStep, text: `Ada's agent asks which evening works. ${scriptText}` };
const signedScriptStep = await signStep(scriptStep);
const askWithoutEmail: AgentTalkUnsignedStep = { ...askStep };
delete askWithoutEmail.email;
const signedAskWithoutEmail = await signStep(askWithoutEmail);

// a block written without the escaping a sender must apply: its text closes the element early
const unescapedScriptBlock = `<script type="${AGENT_TALK_MEDIA_TYPE}">${JSON.stringify({ v: 1, token: talkToken, step: signedScriptStep })}</script>`;

const oversizedStep: AgentTalkUnsignedStep = {
    id: "st_busy",
    talk: TALK_ID,
    at: NOW.toISOString(),
    by: adaBy,
    text: "Ada's busy times for next week.",
    type: "say",
    values: [
        {
            type: "busy",
            text: "Busy",
            from: "2026-11-23T00:00:00+01:00",
            to: "2026-11-30T00:00:00+01:00",
            blocks: Array.from({ length: 500 }, () => ({ start: "2026-11-24T19:30:00+01:00", end: "2026-11-24T21:30:00+01:00" })),
        },
    ],
};

type BlockReadInput = {
    name: string;
    description: string;
    from: string;
    messageId: string;
    html: string;
    headerClaims?: { talk: string; step: string };
    now?: Date;
    receiverKeys?: KeyReference[];
};

const blockFormatCases = [
    { name: "format ask", description: "The ask as Ada's mail carries it.", input: { token: talkToken, step: signedAsk } },
    {
        name: "format text that tries to end the element",
        description:
            "< > & U+2028 and U+2029 inside the JSON are written as \\u003c \\u003e \\u0026 \\u2028 \\u2029 after canonicalisation, so no text closes the element or opens a comment.",
        input: { token: talkToken, step: signedScriptStep },
    },
    {
        name: "format a step too large for a block",
        description: "Over 32,000 characters of JSON: no block (null); the step travels behind the link only.",
        input: { token: await createTalkToken({ service: "north", stepId: "st_busy", address: ADA }), step: await signStep(oversizedStep) },
    },
].map((input) => ({ kind: "format", ...input, expected: formatAgentTalkStepBlock(input.input) }));

const blockReadInputs: BlockReadInput[] = [
    { name: "valid", description: "Ada's mail with its own block.", from: ADA, messageId: ASK_MESSAGE_ID, html: askHtml(askBlock) },
    {
        name: "valid with From in another case and a bare Message-ID",
        description: "From is compared lowercased; Message-IDs are compared without their angle brackets.",
        from: "Ada@Example.com",
        messageId: "ask-1@north.example",
        html: askHtml(askBlock),
    },
    {
        name: "valid with matching header claims",
        description: "The X-Agent-Talk t names the same talk and step.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(askBlock),
        headerClaims: { talk: TALK_ID, step: "st_ask" },
    },
    {
        name: "From mismatch",
        description: "Ada's block in a message from Carol (a copied block).",
        from: CAROL,
        messageId: "<copy-1@example.com>",
        html: askHtml(askBlock),
    },
    {
        name: "reply with its own block before the quote",
        description: "Ben's reply carries his answer block, then quotes Ada's mail with her block. The first block that counts is his own.",
        from: BEN,
        messageId: REPLY_MESSAGE_ID,
        html: `<html><body><p>Tuesday works.</p>${answerBlock}${quoteHtml(askHtml(askBlock))}</body></html>`,
    },
    {
        name: "quoted block from someone else",
        description:
            "Ben replies without a block of his own; the only block is Ada's, inside the gmail_quote blockquote. Its token names Ada, not the sender. The reader does not look at quoting itself: passing only the message's own HTML is the caller's job.",
        from: BEN,
        messageId: REPLY_MESSAGE_ID,
        html: `<html><body><p>Tuesday works.</p>${quoteHtml(askHtml(askBlock))}</body></html>`,
    },
    {
        name: "quoted block from the same sender, step with email",
        description: "Ada follows up and quotes her own earlier mail with its block. The quoted step names the earlier Message-ID.",
        from: ADA,
        messageId: "<followup-1@north.example>",
        html: `<html><body><p>Any thoughts?</p>${quoteHtml(askHtml(askBlock))}</body></html>`,
    },
    {
        name: "quoted block from the same sender, step without email",
        description:
            "As above, but the quoted step has no email field: the block counts. The receiver already holds this step id and ignores it (protocol 8.6); telling quoted content apart is the caller's job.",
        from: ADA,
        messageId: "<followup-1@north.example>",
        html: `<html><body><p>Any thoughts?</p>${quoteHtml(askHtml(formatBlock(talkToken, signedAskWithoutEmail)))}</body></html>`,
    },
    {
        name: "forwarded mail",
        description: "Ben forwards Ada's mail to Carol; the forwarded part carries Ada's block. Its token names Ada, not the sender.",
        from: BEN,
        messageId: "<fwd-1@south.example>",
        html: `<html><body><p>See below.</p><div>---------- Forwarded message ---------<br>From: Ada &lt;${ADA}&gt;<br>Subject: Dinner<br><br>${askHtml(askBlock)}</div></body></html>`,
    },
    {
        name: "text that tries to end the element",
        description: "A step whose text holds </script> and <!--, escaped by the sender: read back intact.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(formatBlock(talkToken, signedScriptStep)),
    },
    {
        name: "unescaped text that ends the element",
        description:
            "The same step written without the required escaping: the element ends at the first </script>, the JSON is cut short and nothing is read.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(unescapedScriptBlock),
    },
    {
        name: "line breaks inserted in transit",
        description: "The JSON wrapped with CRLF every 76 characters. Line breaks are removed before parsing.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(
            askBlock.replace(
                /^(<script[^>]*>)(.*)(<\/script>)$/s,
                (_match, open: string, json: string, close: string) => `${open}${json.replace(/(.{76})/g, "$1\r\n")}${close}`,
            ),
        ),
    },
    {
        name: "unquoted type, other letter case, pretty-printed",
        description:
            "<SCRIPT TYPE=application/agent-talk+json> as an HTML minifier and an editor might leave it, beside an ld+json script.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(
            `<script type="application/ld+json">{"@context":"http://schema.org","@type":"EmailMessage"}</script><SCRIPT TYPE=${AGENT_TALK_MEDIA_TYPE.toUpperCase()}>\n${JSON.stringify({ v: 1, token: talkToken, step: signedAsk }, null, 2)}\n</SCRIPT >`,
        ),
    },
    {
        name: "two blocks, the first does not count",
        description: "A rogue block before Ada's own: the first block that counts is used.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(
            `${formatBlock(await createTalkToken({ service: "rogue", stepId: "st_ask", address: ADA }), await signStep(askStep, signingKeys.rogue))}${askBlock}`,
        ),
    },
    {
        name: "two valid blocks",
        description: "Two blocks that both count: the first one is used.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(
            `${askBlock}${formatBlock(await createTalkToken({ service: "north", stepId: "st_say", address: ADA }), await signStep(saySteps[0]?.step ?? askStep))}`,
        ),
    },
    {
        name: "two blocks that do not count",
        description: "When no block counts, the reason is the first block's.",
        from: ADA,
        messageId: "<other@north.example>",
        html: askHtml(
            `${askBlock}${formatBlock(await createTalkToken({ service: "rogue", stepId: "st_ask", address: ADA }), await signStep(askStep, signingKeys.rogue))}`,
        ),
    },
    {
        name: "stops after eight blocks",
        description:
            "Eight elements of the block type whose JSON does not parse, then a valid block: only eight are opened, so nothing is read.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(`${`<script type="${AGENT_TALK_MEDIA_TYPE}">not json</script>`.repeat(8)}${askBlock}`),
    },
    {
        name: "header claims mismatch",
        description: "The X-Agent-Talk t names another step than the block's token.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(askBlock),
        headerClaims: { talk: TALK_ID, step: "st_other" },
    },
    {
        name: "token and step mismatch",
        description: "The token names st_other; the step is st_ask.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(formatBlock(await createTalkToken({ service: "north", stepId: "st_other", address: ADA }), signedAsk)),
    },
    {
        name: "author mismatch",
        description: "Token and From name Ada; the step says Carol wrote it.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(formatBlock(talkToken, await signStep({ ...askStep, by: { address: CAROL, actor: "agent" } }))),
    },
    {
        name: "email mismatch",
        description: "The step names a Message-ID other than this message's.",
        from: ADA,
        messageId: "<resent-1@north.example>",
        html: askHtml(askBlock),
    },
    {
        name: "unknown issuer",
        description: "Eve's block, token and step signed by rogue.example, which the receiver does not recognise.",
        from: EVE,
        messageId: "<ask-1@rogue.example>",
        html: askHtml(
            formatBlock(
                await createTalkToken({ service: "rogue", stepId: "st_ask", address: EVE }),
                await signStep({ ...askStep, by: { address: EVE, actor: "agent" }, email: "<ask-1@rogue.example>" }, signingKeys.rogue),
            ),
        ),
    },
    {
        name: "tampered step",
        description: "The step's question changed after signing.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(formatBlock(talkToken, { ...signedAsk, question: "Which evening works for drinks?" })),
    },
    {
        name: "step signed by another service",
        description: "The token is north.example's; the step is signed by south.example. The step must be signed by the token's issuer.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(formatBlock(talkToken, await signStep(askStep, signingKeys.south))),
    },
    {
        name: "invalid step",
        description: "A signed step that breaks a limit: a 201-character question.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(formatBlock(talkToken, await signStep({ ...askStep, question: "q".repeat(201) }))),
    },
    {
        name: "expired token",
        description: "Read at the ask's expiry.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(askBlock),
        now: ASK_EXPIRES,
    },
    {
        name: "wrong block version",
        description: "A block with v: 2.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: askHtml(askBlock.replace(/"v":1}<\/script>$/, '"v":2}</script>')),
    },
    { name: "no block", description: "Plain mail.", from: ADA, messageId: ASK_MESSAGE_ID, html: askHtml("") },
    {
        name: "unclosed block",
        description: "An opening tag with no closing tag.",
        from: ADA,
        messageId: ASK_MESSAGE_ID,
        html: `<html><body>${askBlock.replace(/<\/script>$/, "")}`,
    },
];

const blockReadCases = await Promise.all(
    blockReadInputs.map(async (input) => {
        const now = input.now ?? NOW;
        const receiverKeys = input.receiverKeys ?? RECEIVER_KEYS;
        return {
            kind: "read",
            name: input.name,
            description: input.description,
            email: {
                from: input.from,
                messageId: input.messageId,
                html: input.html,
                ...(input.headerClaims ? { headerClaims: input.headerClaims } : {}),
            },
            now: now.toISOString(),
            receiverKeys,
            expected: await readAgentTalkStepBlock({
                html: input.html,
                from: input.from,
                now,
                messageId: input.messageId,
                ...(input.headerClaims ? { headerClaims: input.headerClaims } : {}),
                getPublicKey: createResolver(receiverKeys),
            }),
        };
    }),
);

// service documents

const northDocument: AgentTalkServiceDocument = {
    v: 1,
    issuer: SERVICE_KEYS.north.issuer,
    name: "North",
    description: "North's agent talk service.",
    provider: { organization: "North Example", url: "https://north.example" },
    keys: "https://north.example/.well-known/agent-talk-keys.json",
    carriers: [{ type: "https", url: "https://north.example/agent-talk/steps" }],
    doors: "https://north.example/agent-talk/doors/{address}",
};

const northDoorDocument: AgentTalkServiceDocument = {
    ...northDocument,
    door: {
        id: "door_5Lr8",
        address: "support@north.example",
        handles: [{ id: "order-status", name: "Order status", description: "Where an order is and when it arrives" }],
    },
};

// a carrier type and a field this version does not define: both are signed, and a reader keeps the carrier and drops the field
const northFutureDocument = {
    ...northDocument,
    carriers: [{ type: "a2a", url: "https://north.example/a2a" }, ...northDocument.carriers],
    logo: "https://north.example/logo.png",
} as AgentTalkServiceDocument;

const signedNorthDocument = await signAgentTalkServiceDocument(northDocument, signingKeys.north);
const signedNorthDoorDocument = await signAgentTalkServiceDocument(northDoorDocument, signingKeys.north);
const signedNorthFutureDocument = await signAgentTalkServiceDocument(northFutureDocument, signingKeys.north);
const rogueSignedNorthDocument = await signAgentTalkServiceDocument(northDocument, getMislabelledKey("north", "rogue"));
const [documentSignature] = signedNorthDocument.signatures;
if (!documentSignature) throw new Error("the document has no signature");

// the same payload under a protected header whose typ is not agent-talk-service
const [joseProtected = "", , joseSignature = ""] = (
    await signJws(
        northDocument,
        { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: SERVICE_KEYS.north.kid, typ: "JOSE" },
        signingKeys.north.privateKey,
    )
).split(".");

const documentSignInputs: { name: string; description: string; document: AgentTalkServiceDocument }[] = [
    { name: "sign service document", description: "north.example's service document.", document: northDocument },
    {
        name: "sign door document",
        description: "The door document of support@north.example: the service document with door.",
        document: northDoorDocument,
    },
    {
        name: "sign with an unknown carrier",
        description: "A carrier type and a field this version does not define are signed like any other.",
        document: northFutureDocument,
    },
];

const documentVerifyInputs: { name: string; description: string; document: unknown; issuer: string }[] = [
    { name: "valid", description: "north.example's signed service document.", document: signedNorthDocument, issuer: "north.example" },
    {
        name: "valid with keys in another order",
        description: "The payload is the document in JCS without signatures.",
        document: Object.fromEntries(Object.entries(signedNorthDocument).reverse()),
        issuer: "north.example",
    },
    {
        name: "valid door document",
        description: "A door document verifies like the service document.",
        document: signedNorthDoorDocument,
        issuer: "north.example",
    },
    {
        name: "valid with an unknown carrier",
        description: "A document with a carrier type the reader does not know still verifies.",
        document: signedNorthFutureDocument,
        issuer: "north.example",
    },
    {
        name: "tampered name",
        description: "name changed after signing.",
        document: { ...signedNorthDocument, name: "Not North" },
        issuer: "north.example",
    },
    {
        name: "tampered carrier",
        description: "The https carrier's url changed after signing.",
        document: { ...signedNorthDocument, carriers: [{ type: "https", url: "https://rogue.example/agent-talk/steps" }] },
        issuer: "north.example",
    },
    {
        name: "wrong issuer",
        description: "north.example's document checked as south.example's: a document verifies only for the issuer it names.",
        document: signedNorthDocument,
        issuer: "south.example",
    },
    {
        name: "issuer rewritten",
        description: "issuer changed to south.example after signing, checked as south.example's.",
        document: { ...signedNorthDocument, issuer: "south.example" },
        issuer: "south.example",
    },
    { name: "no signatures", description: "The unsigned document.", document: northDocument, issuer: "north.example" },
    { name: "empty signatures", description: "signatures: [].", document: { ...northDocument, signatures: [] }, issuer: "north.example" },
    {
        name: "wrong key",
        description: "Signed with rogue.example's private key under north.example's kid.",
        document: rogueSignedNorthDocument,
        issuer: "north.example",
    },
    {
        name: "a valid signature after a bad one",
        description: "Any one signature by a key the reader holds for the issuer is enough.",
        document: { ...northDocument, signatures: [...rogueSignedNorthDocument.signatures, documentSignature] },
        issuer: "north.example",
    },
    {
        name: "another typ",
        description: "A genuine signature over the same payload whose protected header has typ JOSE.",
        document: { ...northDocument, signatures: [{ protected: joseProtected, signature: joseSignature }] },
        issuer: "north.example",
    },
];

const documentReadInputs: { name: string; description: string; document: unknown }[] = [
    { name: "read service document", description: "The document without its signatures.", document: signedNorthDocument },
    { name: "read door document", description: "The door document, door included.", document: signedNorthDoorDocument },
    {
        name: "unknown carrier kept",
        description: "A carrier type the reader does not know is kept; a field this version does not define is left out.",
        document: signedNorthFutureDocument,
    },
    {
        name: "unknown carrier with another kind of url",
        description: "A carrier type the reader does not know may use any url; it is kept, and one without a url is dropped.",
        document: {
            ...northDocument,
            carriers: [{ type: "queue", url: "sqs://eu-west-1/north" }, { type: "x-relay" }, ...northDocument.carriers],
        },
    },
    {
        name: "https carrier without an https url",
        description: "A carrier this version knows must be right, or the document does not read.",
        document: { ...northDocument, carriers: [{ type: "https", url: "http://north.example/agent-talk/steps" }] },
    },
    { name: "email alone", description: "No carriers: the service speaks by email alone.", document: { ...northDocument, carriers: [] } },
    { name: "another version", description: "v: 2.", document: { ...northDocument, v: 2 } },
    { name: "no carriers list", description: "carriers is missing.", document: { ...northDocument, carriers: undefined } },
    {
        name: "nine carriers",
        description: "At most 8 carriers.",
        document: {
            ...northDocument,
            carriers: Array.from({ length: 9 }, (_, index) => ({ type: `x-${index}`, url: "https://north.example/x" })),
        },
    },
    {
        name: "carrier over http",
        description: "Every url is https.",
        document: { ...northDocument, carriers: [{ type: "https", url: "http://north.example/agent-talk/steps" }] },
    },
    { name: "keys over http", description: "Every url is https.", document: { ...northDocument, keys: "http://north.example/keys.json" } },
    {
        name: "doors without the address variable",
        description: "The doors template names {address}.",
        document: { ...northDocument, doors: "https://north.example/agent-talk/doors" },
    },
    {
        name: "handle without a description",
        description: "Each handle has an id, a name and a description.",
        document: {
            ...northDoorDocument,
            door: { id: "door_5Lr8", address: "support@north.example", handles: [{ id: "order-status", name: "Order status" }] },
        },
    },
    { name: "no provider", description: "provider is missing.", document: { ...northDocument, provider: undefined } },
];

const serviceDocumentCases = [
    ...(await Promise.all(
        documentSignInputs.map(async (input) => {
            const signed = await signAgentTalkServiceDocument(input.document, signingKeys.north);
            return {
                kind: "sign",
                ...input,
                signer: "north.example",
                expected: {
                    protectedHeader: fromBase64UrlJson(signed.signatures[0]?.protected ?? ""),
                    canonicalPayload: getCanonicalJson(input.document),
                    signedDocument: signed,
                },
            };
        }),
    )),
    ...(await Promise.all(
        documentVerifyInputs.map(async (input) => ({
            kind: "verify",
            ...input,
            receiverKeys: RECEIVER_KEYS,
            expected: { isValid: await verifyAgentTalkServiceDocument(input.document, input.issuer, receiverResolver) },
        })),
    )),
    ...documentReadInputs.map((input) => ({
        kind: "read",
        ...input,
        document: JSON.parse(JSON.stringify(input.document)) as unknown,
        expected: readAgentTalkServiceDocument(JSON.parse(JSON.stringify(input.document))),
    })),
];

// direct bodies

const numberedAsk = { ...signedAsk, seq: 3 } as AgentTalkSignedStep;
const DOOR_ID = "door_5Lr8";

const directCreateInputs: { name: string; description: string; input: { step: AgentTalkSignedStep; door?: string } }[] = [
    { name: "create body", description: "The signed step whole.", input: { step: signedAsk } },
    {
        name: "create body without seq",
        description: "The host's seq is left out; the signature does not cover it.",
        input: { step: numberedAsk },
    },
    {
        name: "create body for a door",
        description: "A first ask to an open door names the door's id.",
        input: { step: signedAsk, door: DOOR_ID },
    },
];

const directReadInputs: { name: string; description: string; body: unknown }[] = [
    { name: "valid", description: "A step and no door.", body: { v: 1, step: signedAsk } },
    { name: "valid with a door", description: "A step and the door it is for.", body: { v: 1, step: signedAsk, door: DOOR_ID } },
    { name: "door of 128 characters", description: "The longest door id.", body: { v: 1, step: signedAsk, door: "d".repeat(128) } },
    {
        name: "step still to be checked",
        description:
            "The body reader checks only the body's shape; the step is validated and verified after it, and a bad step gets the uniform refusal.",
        body: { v: 1, step: { id: "st_1" } },
    },
    { name: "not an object", description: "A string.", body: "step" },
    { name: "array", description: "A JSON array.", body: [{ v: 1, step: signedAsk }] },
    { name: "null", description: "JSON null.", body: null },
    { name: "no v", description: "v is missing.", body: { step: signedAsk } },
    { name: "v as a string", description: 'v is "1".', body: { v: "1", step: signedAsk } },
    { name: "another version", description: "v: 2. The receiver says which versions it speaks.", body: { v: 2, step: signedAsk } },
    { name: "no step", description: "step is missing.", body: { v: 1 } },
    { name: "step not an object", description: "step is a string.", body: { v: 1, step: "st_1" } },
    { name: "door not a string", description: "door: 7.", body: { v: 1, step: signedAsk, door: 7 } },
    { name: "empty door", description: 'door: "".', body: { v: 1, step: signedAsk, door: "" } },
    { name: "door too long", description: "A door id of 129 characters.", body: { v: 1, step: signedAsk, door: "d".repeat(129) } },
];

const directOutcomeInputs: { name: string; description: string; status: number; body: unknown }[] = [
    { name: "taken", description: "202 with an empty object.", status: 202, body: {} },
    { name: "taken as any 2xx", description: "200.", status: 200, body: {} },
    { name: "refused", description: "The uniform refusal.", status: 403, body: { error: "not_accepted" } },
    {
        name: "403 with another error",
        description: "Not the uniform refusal: failed, and retried.",
        status: 403,
        body: { error: "forbidden" },
    },
    { name: "bad request", description: "The body was not one.", status: 400, body: { error: "bad_request" } },
    {
        name: "unsupported version",
        description: "The receiver speaks another version.",
        status: 400,
        body: { error: "unsupported_version", versions: [1] },
    },
    { name: "too large", description: "413 from a server's own body limit.", status: 413, body: null },
    { name: "server error", description: "503.", status: 503, body: null },
];

const directBodyCases = [
    ...directCreateInputs.map((input) => ({
        kind: "create",
        ...input,
        expected: JSON.parse(JSON.stringify(createAgentTalkDirectBody(input.input.step, input.input.door))) as unknown,
    })),
    ...directReadInputs.map((input) => ({ kind: "read", ...input, expected: readAgentTalkDirectBody(input.body) })),
    ...directOutcomeInputs.map((input) => ({ kind: "outcome", ...input, expected: getAgentTalkDirectOutcome(input.status, input.body) })),
];

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

writeVectors(
    "keys.json",
    "The Ed25519 keys behind every vector, as JWKs. TEST ONLY: the private keys are published so anyone can reproduce the signatures; never use them for anything else. A receiver in these vectors holds the keys listed in each case's receiverKeys, by iss and kid.",
    keyCases,
);
writeVectors(
    "canonical-json.json",
    "JSON canonicalisation (JCS, RFC 8785) as the signatures use it. Parse inputJson, canonicalise, compare with expected.canonical byte for byte; expected.error means canonicalisation must fail.",
    canonicalCases,
);
writeVectors(
    "step-signatures.json",
    "Step signatures. sign: sign step with signer's key and compare; the sig is the protected header segment, an empty payload segment and the signature (a detached compact JWS over the step in JCS without seq and sig). verify: check step.sig against the key the receiver holds for issuer and the header's kid.",
    [...signCases, ...verifyCases],
);
writeVectors(
    "presence-tokens.json",
    "Presence tokens (protocol 3). Check token against from at now, with only the keys in receiverKeys. Checks run in this order and the first that fails is the reason: malformed (not a compact JWS with alg EdDSA and a kid, typ not agent-talk-presence, or claims of the wrong shape), unknownKey, badSignature, wrongVersion, fromMismatch, postDated (iat more than 300 s after now), tooLong (exp - iat over 90 days), expired (now >= exp). signer names the service whose key made the signature, when it is genuine, so it can be reproduced.",
    presenceCases,
);
writeVectors(
    "talk-tokens.json",
    "Talk tokens (protocol 8.2). Check as for presence tokens, with typ agent-talk-talk and a lifetime cap of 30 days. A null from is a token read from an answer link: there is no sender, so fromMismatch is not checked.",
    talkCases,
);
writeVectors(
    "service-tokens.json",
    "Service tokens (protocol 9.4). Check token for audience at now. Order: malformed (typ not JWT, claims of the wrong shape, jti not 1 to 128 characters), unknownKey, badSignature, wrongAudience, postDated, tooLong (exp - iat over 300 s), expired. A valid result also names the kid; the caller still checks jti was not seen before.",
    serviceCases,
);
writeVectors(
    "headers.json",
    "The X-Agent-Talk header (protocol 8.1) and the X-Agent-Talk-Link header (8.5). format: input to header value; t is left out when the value would pass 870 characters. parse: header value to { v, presence?, talk? }, or null.",
    headerCases,
);
writeVectors(
    "blocks.json",
    "The step block in an email's HTML (protocol 8.6). format: { token, step } to the script element, or null when it does not fit. read: the email's HTML, From and Message-ID, and the X-Agent-Talk t claims when the header carried one, to the read result. The reader returns the first block that counts; when none does, the reason of the first block it read, or noBlock.",
    [...blockFormatCases, ...blockReadCases],
);
writeVectors(
    "service-documents.json",
    "Signed service documents (protocol 9.1). sign: sign document with signer's key and compare the signed document; the signature is a JWS with typ agent-talk-service over the document in JCS with signatures left out, protected is the base64url protected header, and the payload is not carried. verify: whether the document names issuer and any of its first eight signatures checks out against a key the receiver holds for issuer. read: the document as a reader takes it (signatures and fields this version does not define left out, unknown carrier types kept), or null.",
    serviceDocumentCases,
);
writeVectors(
    "direct-bodies.json",
    "The https carrier's request body (protocol 9.2) and responses (9.5). create: { step, door? } to the body. read: the parsed JSON body to { isValid: true, step, door } or { isValid: false, response: { status, body } }; a numeric v other than 1 is unsupported_version, anything else malformed is bad_request. A body over 64 KiB is refused before it is parsed, which these cases do not cover. outcome: a response's status and parsed body to taken (2xx), refused (403 not_accepted) or failed (anything else, retried).",
    directBodyCases,
);
