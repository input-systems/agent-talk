import type {
    AGENT_TALK_VERSION,
    AGENT_TALK_ANSWER_RESOLUTION,
    AGENT_TALK_ANSWER_RESULT,
    AGENT_TALK_ASK_ANSWER_BY,
    AGENT_TALK_ASK_EFFECT,
    AGENT_TALK_ASK_SELECT,
    AGENT_TALK_ATTENTION_STATE,
    AGENT_TALK_CARD_STATE,
    AGENT_TALK_CLOSE_REASON,
    AGENT_TALK_HOLD_REASON,
    AGENT_TALK_SCOPE,
    AGENT_TALK_STEP_ACTOR,
    AGENT_TALK_STEP_BLOCK_REJECT_REASON,
    AGENT_TALK_STEP_TYPE,
    AGENT_TALK_STEP_VIA,
    AGENT_TALK_TOKEN_REJECT_REASON,
    AGENT_TALK_TOOL_ACCESS,
    AGENT_TALK_VALUE_TYPE,
} from "./agentTalk.constants.js";

export type ValueOf<T> = T[keyof T];

// lowercased mailbox address; the address is the identity
export type AgentTalkAddress = string;

export type AgentTalkPrivateType = `x-${string}`;

export type AgentTalkStepType = ValueOf<typeof AGENT_TALK_STEP_TYPE>;
export type AgentTalkStepActor = ValueOf<typeof AGENT_TALK_STEP_ACTOR>;
export type AgentTalkStepVia = ValueOf<typeof AGENT_TALK_STEP_VIA>;
export type AgentTalkValueType = ValueOf<typeof AGENT_TALK_VALUE_TYPE> | AgentTalkPrivateType;
export type AgentTalkToolAccess = ValueOf<typeof AGENT_TALK_TOOL_ACCESS>;
export type AgentTalkToolScope = `tool.${string}.${AgentTalkToolAccess}`;
export type AgentTalkScope = ValueOf<typeof AGENT_TALK_SCOPE> | AgentTalkToolScope | AgentTalkPrivateType;
export type AgentTalkAnswerResolution = ValueOf<typeof AGENT_TALK_ANSWER_RESOLUTION>;
export type AgentTalkAnswerResult = ValueOf<typeof AGENT_TALK_ANSWER_RESULT>;
export type AgentTalkCardState = ValueOf<typeof AGENT_TALK_CARD_STATE>;
export type AgentTalkAttentionState = ValueOf<typeof AGENT_TALK_ATTENTION_STATE>;
// `due` is the earliest date among what the state is about, when one is set
export type AgentTalkAttention = { state: AgentTalkAttentionState; due?: string };
export type AgentTalkHoldReason = ValueOf<typeof AGENT_TALK_HOLD_REASON>;
export type AgentTalkCloseReason = ValueOf<typeof AGENT_TALK_CLOSE_REASON>;
export type AgentTalkAskAnswerBy = ValueOf<typeof AGENT_TALK_ASK_ANSWER_BY>;
export type AgentTalkAskSelect = ValueOf<typeof AGENT_TALK_ASK_SELECT>;
export type AgentTalkAskEffect = ValueOf<typeof AGENT_TALK_ASK_EFFECT>;
export type AgentTalkTokenRejectReason = ValueOf<typeof AGENT_TALK_TOKEN_REJECT_REASON>;
export type AgentTalkStepBlockRejectReason = ValueOf<typeof AGENT_TALK_STEP_BLOCK_REJECT_REASON>;

export type AgentTalk = {
    v: typeof AGENT_TALK_VERSION;
    id: string;
    host: string;
    parties: AgentTalkAddress[];
    anchor?: { messageId: string };
    title: string;
    createdAt: string;
};

// every value carries its own text. a receiver shows the text of a type it does not know: a private one, or one
// a later version added
export type AgentTalkValue =
    | { type: typeof AGENT_TALK_VALUE_TYPE.TEXT; text: string }
    | {
          type: typeof AGENT_TALK_VALUE_TYPE.TIME;
          text: string;
          start: string;
          end: string;
          timeZone: string;
          place?: string;
          isCall?: boolean;
      }
    | { type: typeof AGENT_TALK_VALUE_TYPE.BUSY; text: string; from: string; to: string; blocks: { start: string; end: string }[] }
    | { type: typeof AGENT_TALK_VALUE_TYPE.DATE; text: string; date: string }
    | { type: typeof AGENT_TALK_VALUE_TYPE.PLACE; text: string; name: string; address?: string }
    | { type: typeof AGENT_TALK_VALUE_TYPE.CONTACT; text: string; address: AgentTalkAddress; name?: string }
    | { type: typeof AGENT_TALK_VALUE_TYPE.AMOUNT; text: string; currency: string; amount: string }
    | { type: typeof AGENT_TALK_VALUE_TYPE.LINK; text: string; url: string }
    | { type: typeof AGENT_TALK_VALUE_TYPE.FILE; text: string; name: string; mediaType: string; size: number; sha256: string; url: string }
    | { type: AgentTalkPrivateType; text: string };

export type AgentTalkReceipt = { shared: string; held?: string };

export type AgentTalkOption = { id: string; label: string; detail?: string; isRecommended?: boolean; value?: AgentTalkValue };

export type AgentTalkField = { id: string; label: string; type: AgentTalkValueType; isRequired?: boolean };

// what a message is, as one schema.org object (Order, Invoice, ParcelDelivery, …). the values stay the way to say
// what a message asks and hands over
export type AgentTalkThing = { "@type": string; [property: string]: unknown };

export type AgentTalkSayBody = {
    type: typeof AGENT_TALK_STEP_TYPE.SAY;
    values?: AgentTalkValue[];
    receipt?: AgentTalkReceipt;
    about?: AgentTalkThing;
};

export type AgentTalkAskBody = {
    type: typeof AGENT_TALK_STEP_TYPE.ASK;
    about?: AgentTalkThing;
    to: AgentTalkAddress[];
    title?: string;
    question: string;
    context?: string[];
    options?: AgentTalkOption[];
    select?: AgentTalkAskSelect;
    fields?: AgentTalkField[];
    can: { counter: boolean; decline: boolean; text: boolean };
    answerBy: AgentTalkAskAnswerBy;
    needs?: AgentTalkScope[];
    effect?: AgentTalkAskEffect;
    due?: string;
    // after this no agent may answer on its own; a person decides, or the asking agent re-checks and asks again
    autoUntil?: string;
    expires: string;
    counters?: boolean;
    // scopes the asker asks to keep. only the person answers such an ask, and they choose which, and for how long
    requestedScopes?: AgentTalkScope[];
    requestedUntil?: string;
};

// what the person accepted of a request: for this talk only, or standing until removed or until a date. the
// other side is told this much; never the person's own limits, and never when it is later removed
export type AgentTalkGranted = { scopes: AgentTalkScope[]; isStanding: boolean; until?: string };

export type AgentTalkAnswerBody = {
    type: typeof AGENT_TALK_STEP_TYPE.ANSWER;
    re: string;
    result: AgentTalkAnswerResult;
    picks?: string[];
    values?: Record<string, AgentTalkValue>;
    receipt?: AgentTalkReceipt;
    isInterpreted?: boolean;
    granted?: AgentTalkGranted;
};

// this side's person has to act before it goes on; `re` names the step that needs them
export type AgentTalkWaitBody = { type: typeof AGENT_TALK_STEP_TYPE.WAIT };
export type AgentTalkHoldBody = { type: typeof AGENT_TALK_STEP_TYPE.HOLD; reason: AgentTalkHoldReason; addresses?: AgentTalkAddress[] };
export type AgentTalkResumeBody = { type: typeof AGENT_TALK_STEP_TYPE.RESUME };
export type AgentTalkCloseBody = { type: typeof AGENT_TALK_STEP_TYPE.CLOSE; reason: AgentTalkCloseReason; outcome?: AgentTalkValue[] };

// a step of a type this version does not know: a private one, or one a later version added. a receiver shows
// its text and nothing else
export type AgentTalkPrivateBody = { type: AgentTalkPrivateType };

export type AgentTalkStepBody =
    | AgentTalkSayBody
    | AgentTalkAskBody
    | AgentTalkAnswerBody
    | AgentTalkWaitBody
    | AgentTalkHoldBody
    | AgentTalkResumeBody
    | AgentTalkCloseBody
    | AgentTalkPrivateBody;

export type AgentTalkStepEnvelope = {
    id: string;
    talk: string;
    seq: number;
    at: string;
    by: { address: AgentTalkAddress; actor: AgentTalkStepActor };
    via?: AgentTalkStepVia;
    re?: string;
    email?: string;
    text: string;
    sig: string;
};

export type AgentTalkStep = AgentTalkStepEnvelope & AgentTalkStepBody;

// what the author signs: the step without the host's order and the signature itself
export type AgentTalkUnsignedStep = Omit<AgentTalkStepEnvelope, "seq" | "sig"> & AgentTalkStepBody;

// a step as its author signed it. the host's order is there once the host has accepted it
export type AgentTalkSignedStep = AgentTalkUnsignedStep & { sig: string; seq?: number };

// an ask as its author wrote it; modules take the fields they read from it
export type AgentTalkAskStep = Omit<AgentTalkStepEnvelope, "seq" | "sig"> & AgentTalkAskBody;

// what an email that carries a step holds in its html: the talk token that binds it to the sender, and the step
export type AgentTalkStepBlock = { v: number; token: string; step: AgentTalkSignedStep };

export type AgentTalkPresenceClaims = {
    v: typeof AGENT_TALK_VERSION;
    iss: string;
    sub: AgentTalkAddress;
    acc: AgentTalkStepType[];
    types: AgentTalkValueType[];
    // any recognised service may ask this address directly, with no email first: a company's support address,
    // never a person by default
    isOpen?: boolean;
    iat: number;
    exp: number;
};

export type AgentTalkTokenClaims = {
    v: typeof AGENT_TALK_VERSION;
    iss: string;
    talk: string;
    step: string;
    sub: AgentTalkAddress;
    iat: number;
    // the ask's expiry: after it the email is only an email again, on both ends
    exp: number;
};

export type AgentTalkHeader = { v: number; presence?: string; talk?: string };

// finds a service's current key by its domain and key id; null when the service or key is unknown. it answers
// from keys the caller already holds
export type AgentTalkPublicKeyResolver = (issuer: string, kid: string) => Promise<CryptoKey | null>;

export type AgentTalkSigningKey = { kid: string; privateKey: CryptoKey };

export type AgentTalkTokenCheck<T> = { isValid: true; claims: T } | { isValid: false; reason: AgentTalkTokenRejectReason };

export type AgentTalkStepBlockRead =
    | { isValid: true; claims: AgentTalkTokenClaims; step: AgentTalkSignedStep }
    | { isValid: false; reason: AgentTalkStepBlockRejectReason };

export type AgentTalkValidationIssue = { path: string; message: string };

export type AgentTalkValidationResult<T> = { isValid: true; value: T } | { isValid: false; issues: AgentTalkValidationIssue[] };
