import { AGENT_TALK_LIMIT, AGENT_TALK_MEDIA_TYPE, AGENT_TALK_VERSION, AGENT_TALK_STEP_BLOCK_REJECT_REASON } from "./agentTalk.constants.js";
import type {
    AgentTalkPublicKeyResolver,
    AgentTalkSignedStep,
    AgentTalkStepBlock,
    AgentTalkStepBlockRead,
    AgentTalkTokenClaims,
} from "./agentTalk.types.js";
import { getCanonicalJson, getIsJsonObject } from "./agentTalkJson.utils.js";
import { verifyAgentTalkStep } from "./agentTalkStep.utils.js";
import { validateAgentTalkSignedStep } from "./agentTalkStepValidation.utils.js";
import { checkAgentTalkToken } from "./agentTalkToken.utils.js";

// <script type="application/agent-talk+json">{"step":{…},"token":"<talk token>","v":1}</script>
// an email that carries a step holds the step itself in its html, so a receiver reads it without fetching
// anything from the sender. mail apps never show a script element

type UncheckedStepBlock = Omit<AgentTalkStepBlock, "step"> & { step: unknown };

// a message carries one block; quoted history may add a few. more than this is not read
const READ_BLOCKS_MAX = 8;
// an opening tag longer than this is not a block's
const OPENING_TAG_MAX = 256;

const MEDIA_TYPE_PATTERN = AGENT_TALK_MEDIA_TYPE.replace(/[+/]/g, "\\$&");
// the type may come without quotes: html minifiers strip them
const BLOCK_TYPE_PATTERN = new RegExp(
    `\\stype\\s*=\\s*(?:"${MEDIA_TYPE_PATTERN}"|'${MEDIA_TYPE_PATTERN}'|${MEDIA_TYPE_PATTERN}(?=\\s|$))`,
    "i",
);

// json strings are the only place these can sit, and \u escapes parse back to the same characters, so the
// signature still holds. without them a step's text could close the element or open a comment
const ESCAPES: Record<string, string> = {
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029",
};

// null when the step does not fit: it then travels behind the link only
export const formatAgentTalkStepBlock = (input: { token: string; step: AgentTalkSignedStep }): string | null => {
    const block: AgentTalkStepBlock = { v: AGENT_TALK_VERSION, token: input.token, step: input.step };
    const json = getCanonicalJson(block).replace(/[<>&\u2028\u2029]/g, (character) => ESCAPES[character] ?? character);
    if (json.length > AGENT_TALK_LIMIT.STEP_BLOCK) return null;

    return `<script type="${AGENT_TALK_MEDIA_TYPE}">${json}</script>`;
};

// line wrapping in transit adds a line break every 76 characters or so; anything longer than this is not a wrapped block
const WRAPPED_BLOCK_MAX = AGENT_TALK_LIMIT.STEP_BLOCK * 2;

const parseBlockJson = (json: string): UncheckedStepBlock | null => {
    if (json.length > WRAPPED_BLOCK_MAX) return null;
    // a json string cannot hold a raw line break, so dropping them all undoes a mail server's line wrapping. the cap is on
    // the block as its sender wrote it
    const unwrapped = json.replace(/[\r\n]/g, "");
    if (unwrapped.length > AGENT_TALK_LIMIT.STEP_BLOCK) return null;

    try {
        const value: unknown = JSON.parse(unwrapped);
        if (!getIsJsonObject(value) || typeof value.v !== "number" || typeof value.token !== "string") return null;

        return { v: value.v, token: value.token, step: value.step };
    } catch {
        return null;
    }
};

// one pass over html that came from anyone: every search starts where the last one ended, and at most
// READ_BLOCKS_MAX elements are opened, so a hostile message cannot make this slow
const parseStepBlocks = (html: string): UncheckedStepBlock[] => {
    const blocks: UncheckedStepBlock[] = [];
    const opening = /<script(?=[\s>])/gi;
    const closing = /<\/script\s*>/gi;
    let readCount = 0;

    for (let match = opening.exec(html); match !== null && readCount < READ_BLOCKS_MAX; match = opening.exec(html)) {
        const tag = html.slice(match.index, match.index + OPENING_TAG_MAX);
        const tagLength = tag.indexOf(">");
        if (tagLength === -1 || !BLOCK_TYPE_PATTERN.test(tag.slice(0, tagLength))) continue;

        readCount++;
        const start = match.index + tagLength + 1;
        closing.lastIndex = start;
        const end = closing.exec(html);
        if (!end) break;

        const block = parseBlockJson(html.slice(start, end.index));
        if (block) blocks.push(block);
        opening.lastIndex = closing.lastIndex;
    }

    return blocks;
};

// message ids are compared without their angle brackets
const getMessageId = (value: string): string => value.trim().replace(/^<|>$/g, "");

const checkStepBlock = async (
    block: UncheckedStepBlock,
    input: {
        from: string;
        now: Date;
        headerClaims?: Pick<AgentTalkTokenClaims, "talk" | "step">;
        messageId: string;
        getPublicKey: AgentTalkPublicKeyResolver;
    },
): Promise<AgentTalkStepBlockRead> => {
    if (block.v !== AGENT_TALK_VERSION) return { isValid: false, reason: AGENT_TALK_STEP_BLOCK_REJECT_REASON.WRONG_VERSION };

    const token = await checkAgentTalkToken({ token: block.token, from: input.from, now: input.now, getPublicKey: input.getPublicKey });
    if (!token.isValid) return token;

    const { claims } = token;
    const { headerClaims } = input;
    if (headerClaims && (headerClaims.talk !== claims.talk || headerClaims.step !== claims.step)) {
        return { isValid: false, reason: AGENT_TALK_STEP_BLOCK_REJECT_REASON.TOKEN_MISMATCH };
    }

    const validation = validateAgentTalkSignedStep(block.step);
    if (!validation.isValid) return { isValid: false, reason: AGENT_TALK_STEP_BLOCK_REJECT_REASON.INVALID_STEP };

    const step = validation.value;
    if (step.talk !== claims.talk || step.id !== claims.step)
        return { isValid: false, reason: AGENT_TALK_STEP_BLOCK_REJECT_REASON.TOKEN_MISMATCH };
    if (step.by.address !== claims.sub) return { isValid: false, reason: AGENT_TALK_STEP_BLOCK_REJECT_REASON.AUTHOR_MISMATCH };
    if (step.email !== undefined && getMessageId(step.email) !== getMessageId(input.messageId)) {
        return { isValid: false, reason: AGENT_TALK_STEP_BLOCK_REJECT_REASON.EMAIL_MISMATCH };
    }
    if (!(await verifyAgentTalkStep(step, claims.iss, input.getPublicKey))) {
        return { isValid: false, reason: AGENT_TALK_STEP_BLOCK_REJECT_REASON.BAD_STEP_SIGNATURE };
    }

    return { isValid: true, claims, step };
};

// the step an email carries, read from the html of the message's own content: the first block whose talk token
// names the sender and whose step that token names, written by that sender and signed by the token's service.
// the caller still checks the mail was authenticated as From, passes only the message's own html (never quoted
// history) when it can tell them apart, and resolves keys from what it already holds: fetching a service's keys
// because its mail arrived tells that service who reads it
export const readAgentTalkStepBlock = async (input: {
    html: string;
    from: string;
    now: Date;
    // what the talk token in the message's own header names, when it carried one: only that step's block counts
    headerClaims?: Pick<AgentTalkTokenClaims, "talk" | "step">;
    // the message's own Message-ID: a block whose step names another email is not this message's
    messageId: string;
    getPublicKey: AgentTalkPublicKeyResolver;
}): Promise<AgentTalkStepBlockRead> => {
    let rejected: AgentTalkStepBlockRead | null = null;

    for (const block of parseStepBlocks(input.html)) {
        const result = await checkStepBlock(block, input);
        if (result.isValid) return result;
        rejected ??= result;
    }

    return rejected ?? { isValid: false, reason: AGENT_TALK_STEP_BLOCK_REJECT_REASON.NO_BLOCK };
};
