import {
    AGENT_TALK_ANSWER_RESULT,
    AGENT_TALK_ASK_ANSWER_BY,
    AGENT_TALK_CARRIER_TYPE,
    AGENT_TALK_HEADER,
    AGENT_TALK_SERVICE_DOCUMENT_VERSION,
    AGENT_TALK_SERVICE_WELL_KNOWN_PATH,
    AGENT_TALK_STEP_ACTOR,
    AGENT_TALK_STEP_TYPE,
    AGENT_TALK_STEP_VIA,
} from "./agentTalk.constants.js";
import type { AgentTalkPublicKeyResolver, AgentTalkSignedStep, AgentTalkSigningKey } from "./agentTalk.types.js";
import { formatAgentTalkStepBlock, readAgentTalkStepBlock } from "./agentTalkBlock.utils.js";
import {
    AGENT_TALK_DIRECT_BODY_MAX_BYTES,
    AGENT_TALK_DIRECT_REFUSAL,
    AGENT_TALK_DIRECT_TAKEN,
    createAgentTalkDirectBody,
    getAgentTalkDirectRequestHeaders,
    readAgentTalkDirectBody,
    type AgentTalkDirectResponse,
} from "./agentTalkDirect.utils.js";
import { getIsAgentTalkStepFresh } from "./agentTalkFreshness.utils.js";
import { signAgentTalkServiceDocument, type AgentTalkServiceDocument } from "./agentTalkServiceDocument.utils.js";
import { checkAgentTalkServiceToken, createAgentTalkServiceToken } from "./agentTalkServiceToken.utils.js";
import { formatAgentTalkHeader } from "./agentTalkHeader.utils.js";
import { exportAgentTalkPublicKeyJwk, generateAgentTalkSigningKeyPair, importAgentTalkPublicKeyJwk } from "./agentTalkJws.utils.js";
import { signAgentTalkStep, verifyAgentTalkStep } from "./agentTalkStep.utils.js";
import { validateAgentTalkSignedStep, validateAgentTalkUnsignedStep } from "./agentTalkStepValidation.utils.js";
import { createAgentTalkToken } from "./agentTalkToken.utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// an email as a service sends it: the html with the step's block, the words, and the header with its talk token
export type AgentTalkReferenceEmail = { htmlContent: string; textContent: string; headers: { name: string; value: string }[] };

// an email as a service receives it: who it is from, its Message-ID, and whether the receiving provider authenticated it as
// its From (protocol 3.2 item 3), which the receiver reads off its own Authentication-Results
export type AgentTalkReferenceReceived = { htmlContent: string; from: string; messageId: string; isFromAuthenticated: boolean };

// a service's published key, as its key set lists it
export type AgentTalkReferenceKey = JsonWebKey & { kid: string };

// a direct call as it goes over https: the headers and the body
export type AgentTalkReferenceDirectRequest = { headers: Record<string, string>; body: string };

// a service token is remembered this long, longer than it lives, so it is taken once
const SERVICE_TOKEN_REMEMBER_MS = 10 * 60 * 1000;

const getId = (prefix: string): string => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

// a whole agent talk service on this package alone, for one person: its own issuer and key, the email it sends with an ask
// or an answer, and the one way a step from another service gets in. it is the example a service other than input follows,
// and the second participant input's own tests talk to
export async function createAgentTalkReferenceParticipant(input: { issuer: string; address: string; directUrl?: string }) {
    const { issuer, address } = input;
    const directUrl = input.directUrl ?? `https://${issuer}/agent-talk/steps`;
    const pair = await generateAgentTalkSigningKeyPair();
    const kid = `${issuer}-key`;
    const key: AgentTalkSigningKey = { kid, privateKey: pair.privateKey };
    const { kty, crv, x } = await exportAgentTalkPublicKeyJwk(pair.publicKey, kid);
    const publicKey: AgentTalkReferenceKey = { kty, crv, x, kid };

    // the services it recognises and their keys, held before any mail arrives: a key is never fetched because mail came
    const recognised = new Map<string, Map<string, CryptoKey>>();
    // the steps it took and accepted, by id: a step that arrives twice is taken once
    const steps = new Map<string, AgentTalkSignedStep>();
    // the service tokens it took, by jti, until they could no longer be valid
    const seenTokens = new Map<string, number>();

    const getPublicKey: AgentTalkPublicKeyResolver = async (keyIssuer, keyId) =>
        await Promise.resolve(recognised.get(keyIssuer)?.get(keyId) ?? null);

    const sign = async (fields: Record<string, unknown>): Promise<AgentTalkSignedStep> => {
        const validation = validateAgentTalkUnsignedStep(fields);
        if (!validation.isValid) throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));

        const step = { ...validation.value, sig: await signAgentTalkStep(validation.value, key) };
        steps.set(step.id, step);
        return step;
    };

    // the step in a block, the talk token in the header and the block, and the words a person reads (rule 2)
    // the step is for this person: an ask naming their address, or an answer to an ask of theirs that is still open, from
    // someone it asked, and the first such answer
    const getIsForThisPerson = (step: AgentTalkSignedStep, now: Date): boolean => {
        const ask = step.type === AGENT_TALK_STEP_TYPE.ANSWER && step.re ? steps.get(step.re) : undefined;

        return (
            (step.type === AGENT_TALK_STEP_TYPE.ASK && step.to.includes(address)) ||
            (ask?.type === AGENT_TALK_STEP_TYPE.ASK &&
                ask.by.address === address &&
                ask.to.includes(step.by.address) &&
                now < new Date(ask.expires) &&
                ![...steps.values()].some((held) => held.type === AGENT_TALK_STEP_TYPE.ANSWER && held.re === ask.id))
        );
    };

    // direct admission: the service token by a recognised key for this url, not seen before; then the step, validated, signed by
    // the same service, current, and for this person. every failure is the same refusal
    const admitDirectStep = async (
        request: AgentTalkReferenceDirectRequest,
        received: unknown,
        now: Date,
    ): Promise<AgentTalkSignedStep | null> => {
        const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1];
        const token = bearer ? await checkAgentTalkServiceToken({ token: bearer, audience: directUrl, now, getPublicKey }) : null;
        if (!token?.isValid) return null;
        for (const [jti, until] of seenTokens) if (until < now.getTime()) seenTokens.delete(jti);
        if (seenTokens.has(token.claims.jti)) return null;
        seenTokens.set(token.claims.jti, now.getTime() + SERVICE_TOKEN_REMEMBER_MS);

        const validation = validateAgentTalkSignedStep(received);
        if (!validation.isValid) return null;
        const { seq: _seq, ...step } = validation.value;
        if (!(await verifyAgentTalkStep(step, token.claims.iss, getPublicKey))) return null;
        if (!getIsAgentTalkStepFresh(step, now) || steps.has(step.id) || !getIsForThisPerson(step, now)) return null;

        steps.set(step.id, step);
        return step;
    };

    const getEmail = async (step: AgentTalkSignedStep, words: string, expiresAt: Date, now: Date): Promise<AgentTalkReferenceEmail> => {
        const token = await createAgentTalkToken({ issuer, talkId: step.talk, stepId: step.id, address, expiresAt, now, key });

        return {
            htmlContent: `${formatAgentTalkStepBlock({ token, step }) ?? ""}<p>${words}</p>`,
            textContent: words,
            headers: [{ name: AGENT_TALK_HEADER, value: formatAgentTalkHeader({ talk: token }) }],
        };
    };

    const getDocumentFields = (): AgentTalkServiceDocument => ({
        v: AGENT_TALK_SERVICE_DOCUMENT_VERSION,
        issuer,
        name: issuer,
        description: "An agent talk reference participant",
        provider: { organization: issuer, url: `https://${issuer}` },
        keys: `https://${issuer}/.well-known/agent-talk-keys.json`,
        carriers: [{ type: AGENT_TALK_CARRIER_TYPE.HTTPS, url: directUrl }],
        doors: `https://${issuer}/agent-talk/doors/{address}`,
    });

    return {
        issuer,
        address,
        publicKey,
        documentUrl: `https://${issuer}${AGENT_TALK_SERVICE_WELL_KNOWN_PATH}`,
        directUrl,

        // another service's keys, added by whoever runs this one: recognising a service is its own policy
        async recognise(otherIssuer: string, keys: readonly AgentTalkReferenceKey[]) {
            const imported = await Promise.all(keys.map(async (jwk) => [jwk.kid, await importAgentTalkPublicKeyJwk(jwk)] as const));
            recognised.set(otherIssuer, new Map(imported));
        },

        // a question to someone, which opens a talk this service hosts
        async sendAsk(ask: { to: string; question: string; options: { id: string; label: string }[]; now?: Date }) {
            const now = ask.now ?? new Date();
            const expiresAt = new Date(now.getTime() + 7 * DAY_MS);
            const step = await sign({
                id: getId("st"),
                talk: getId("tk"),
                at: now.toISOString(),
                by: { address, actor: AGENT_TALK_STEP_ACTOR.PERSON },
                text: ask.question,
                type: AGENT_TALK_STEP_TYPE.ASK,
                to: [ask.to],
                question: ask.question,
                options: ask.options,
                can: { counter: false, decline: true, text: true },
                answerBy: AGENT_TALK_ASK_ANSWER_BY.PERSON,
                expires: expiresAt.toISOString(),
            });
            const words = [ask.question, ...ask.options.map((option) => `- ${option.label}`)].join("\n");

            return { step, email: await getEmail(step, words, expiresAt, now) };
        },

        // the person picks one option of an ask another service sent them
        async sendAnswer(answer: { ask: AgentTalkSignedStep; pick: string; now?: Date }) {
            if (answer.ask.type !== AGENT_TALK_STEP_TYPE.ASK) throw new Error("not an ask");
            const now = answer.now ?? new Date();
            const label = answer.ask.options?.find((option) => option.id === answer.pick)?.label ?? answer.pick;
            const step = await sign({
                id: getId("st"),
                talk: answer.ask.talk,
                at: now.toISOString(),
                by: { address, actor: AGENT_TALK_STEP_ACTOR.PERSON },
                via: AGENT_TALK_STEP_VIA.APP,
                re: answer.ask.id,
                text: `${label}.`,
                type: AGENT_TALK_STEP_TYPE.ANSWER,
                result: AGENT_TALK_ANSWER_RESULT.ANSWERED,
                picks: [answer.pick],
            });

            return { step, email: await getEmail(step, step.text, new Date(answer.ask.expires), now) };
        },

        // its person's agent says something in a talk it is in, with no person acting: each say counts against the agent's turn
        // (rule 9)
        async sendSay(say: { talk: string; text: string; now?: Date }) {
            const now = say.now ?? new Date();

            return await sign({
                id: getId("st"),
                talk: say.talk,
                at: now.toISOString(),
                by: { address, actor: AGENT_TALK_STEP_ACTOR.AGENT },
                text: say.text,
                type: AGENT_TALK_STEP_TYPE.SAY,
            });
        },

        // the one way a step from another service gets in, or null: the block counts (token bound to From, signed by a key it
        // holds, the message's own), the mail is authenticated as its From, and the step is for this person: an ask naming
        // their address, or an answer to an ask of theirs that is still open. a step it holds already is not taken again
        async accept(received: AgentTalkReferenceReceived, now: Date = new Date()): Promise<AgentTalkSignedStep | null> {
            if (!received.isFromAuthenticated) return null;
            const read = await readAgentTalkStepBlock({
                html: received.htmlContent,
                from: received.from,
                now,
                messageId: received.messageId,
                getPublicKey,
            });
            if (!read.isValid || read.claims.iss === issuer || steps.has(read.step.id)) return null;

            const { step } = read;
            if (!getIsForThisPerson(step, now)) return null;

            steps.set(step.id, step);
            return step;
        },

        // its own document, signed: where its key set is and the url it takes direct steps on
        async getDocument() {
            return await signAgentTalkServiceDocument(getDocumentFields(), key);
        },

        // the document of its person's address when the person keeps an open door: the same document with the door's id, which a
        // first ask to it names, and what it handles (protocol 9.1)
        async getDoorDocument(doorId: string) {
            return await signAgentTalkServiceDocument(
                {
                    ...getDocumentFields(),
                    door: {
                        id: doorId,
                        address,
                        handles: [{ id: "question", name: "Question", description: "Anything its person may answer" }],
                    },
                },
                key,
            );
        },

        // the direct call that carries one of its steps straight to another service, with a fresh service token for that url
        async createDirectRequest(
            step: AgentTalkSignedStep,
            to: { url: string; door?: string; now?: Date },
        ): Promise<AgentTalkReferenceDirectRequest> {
            const token = await createAgentTalkServiceToken({ issuer, audience: to.url, now: to.now ?? new Date(), key });

            return { headers: getAgentTalkDirectRequestHeaders(token), body: JSON.stringify(createAgentTalkDirectBody(step, to.door)) };
        },

        // its direct url: one step per call, taken by the same rules as mail. a body that is not one is said as such; after that
        // every refusal is the same answer
        async receiveDirect(request: AgentTalkReferenceDirectRequest, now: Date = new Date()): Promise<AgentTalkDirectResponse> {
            if (request.body.length > AGENT_TALK_DIRECT_BODY_MAX_BYTES) return AGENT_TALK_DIRECT_REFUSAL;
            let body: unknown;
            try {
                body = JSON.parse(request.body);
            } catch {
                body = null;
            }
            const read = readAgentTalkDirectBody(body);
            if (!read.isValid) return read.response;

            return (await admitDirectStep(request, read.step, now)) ? AGENT_TALK_DIRECT_TAKEN : AGENT_TALK_DIRECT_REFUSAL;
        },

        // the steps it holds of one talk, in the order it took them
        getTalk(talkId: string): AgentTalkSignedStep[] {
            return [...steps.values()].filter((step) => step.talk === talkId);
        },
    };
}
