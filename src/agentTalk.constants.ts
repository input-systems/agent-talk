export const AGENT_TALK_VERSION = 1;

// outlook only takes custom headers named x-…, set when the message is created
export const AGENT_TALK_HEADER = "X-Agent-Talk";

// like List-Unsubscribe: the talk lives behind a link in the headers, so the body only shows the badge line
export const AGENT_TALK_LINK_HEADER = "X-Agent-Talk-Link";

// a step as json: the type of the block an email carries in its html, and of the json view behind the link
export const AGENT_TALK_MEDIA_TYPE = "application/agent-talk+json";

export const AGENT_TALK_SIGNING_ALGORITHM = "EdDSA";

export const COMPACT_JWS_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const AGENT_TALK_STEP_TYPE = {
    SAY: "say",
    ASK: "ask",
    ANSWER: "answer",
    WAIT: "wait",
    HOLD: "hold",
    RESUME: "resume",
    CLOSE: "close",
} as const;

export const AGENT_TALK_STEP_ACTOR = {
    PERSON: "person",
    AGENT: "agent",
} as const;

export const AGENT_TALK_STEP_VIA = {
    APP: "app",
    LINK: "link",
    EMAIL: "email",
} as const;

export const AGENT_TALK_VALUE_TYPE = {
    TEXT: "text",
    TIME: "time",
    BUSY: "busy",
    DATE: "date",
    PLACE: "place",
    CONTACT: "contact",
    AMOUNT: "amount",
    LINK: "link",
    FILE: "file",
} as const;

// a private step, value or scope name: x- and a short token. anything a receiver prints or looks up stays a token
export const AGENT_TALK_PRIVATE_TYPE_PATTERN = /^x-[a-z0-9][A-Za-z0-9-]{0,61}$/;

// <area>.<capability>. a tool scope names one of the person's own tools: tool.<name>.read or tool.<name>.write
export const AGENT_TALK_SCOPE = {
    CALENDAR_FREE_BUSY: "calendar.freeBusy",
    CALENDAR_BOOK: "calendar.book",
    CALENDAR_DETAILS: "calendar.details",
    MAIL_SHARED: "mail.shared",
    MAIL_OWN: "mail.own",
} as const;

// what the other side may ask to keep. everything wider is only ever given from the person's own side
export const AGENT_TALK_REQUESTABLE_SCOPES = [
    AGENT_TALK_SCOPE.CALENDAR_FREE_BUSY,
    AGENT_TALK_SCOPE.CALENDAR_BOOK,
    AGENT_TALK_SCOPE.MAIL_SHARED,
] as const;

// read changes nothing; write adds or updates. deleting, sending, paying and changing access are never covered
export const AGENT_TALK_TOOL_ACCESS = {
    READ: "read",
    WRITE: "write",
} as const;

// how an accepted answer may take effect on the asker's side
export const AGENT_TALK_ANSWER_RESOLUTION = {
    AUTO: "auto",
    RECHECK: "recheck",
    CONFIRM: "confirm",
    EXPIRED: "expired",
} as const;

// what a conversation needs from the person looking at it, read from the steps alone so every surface agrees
export const AGENT_TALK_ATTENTION_STATE = {
    NEEDS_YOU: "needsYou",
    WAITING_ON_THEM: "waitingOnThem",
    AGENTS_WORKING: "agentsWorking",
    DONE: "done",
} as const;

// why a token does not count. local only: the other side is never told
export const AGENT_TALK_TOKEN_REJECT_REASON = {
    MALFORMED: "malformed",
    UNKNOWN_KEY: "unknownKey",
    BAD_SIGNATURE: "badSignature",
    WRONG_VERSION: "wrongVersion",
    FROM_MISMATCH: "fromMismatch",
    POST_DATED: "postDated",
    TOO_LONG: "tooLong",
    EXPIRED: "expired",
} as const;

// why the block in an email does not count: its token's reason, or one of its own
export const AGENT_TALK_STEP_BLOCK_REJECT_REASON = {
    ...AGENT_TALK_TOKEN_REJECT_REASON,
    NO_BLOCK: "noBlock",
    INVALID_STEP: "invalidStep",
    TOKEN_MISMATCH: "tokenMismatch",
    AUTHOR_MISMATCH: "authorMismatch",
    EMAIL_MISMATCH: "emailMismatch",
    BAD_STEP_SIGNATURE: "badStepSignature",
} as const;

// where an ask's web card stands for the person who got it
export const AGENT_TALK_CARD_STATE = {
    OPEN: "open",
    ANSWERED: "answered",
    CLOSED: "closed",
} as const;

export const AGENT_TALK_ANSWER_RESULT = {
    ANSWERED: "answered",
    DECLINED: "declined",
} as const;

export const AGENT_TALK_HOLD_REASON = {
    AUDIENCE: "audience",
    PERSON: "person",
} as const;

export const AGENT_TALK_CLOSE_REASON = {
    DONE: "done",
    CANCELLED: "cancelled",
} as const;

export const AGENT_TALK_ASK_ANSWER_BY = {
    PERSON: "person",
    PERSON_OR_AGENT: "personOrAgent",
} as const;

export const AGENT_TALK_ASK_SELECT = {
    ONE: "one",
    MANY: "many",
} as const;

// what a yes sets off on the asker's side: a calendar invite, or an email that introduces two people
export const AGENT_TALK_ASK_EFFECT = {
    EVENT: "event",
    INTRODUCTION: "introduction",
} as const;

// the `about` type of an introduction ask that turns it around: the asker asks its receiver to introduce the asker to the
// contact, instead of offering to introduce the receiver. only the person answers it all the same
export const AGENT_TALK_INTRODUCTION_REQUEST_TYPE = "IntroductionRequest";

export const AGENT_TALK_LIMIT = {
    TALK_TITLE: 60,
    TALK_PARTIES: 2,
    // a whole step as canonical json in utf-8 bytes, whatever it holds. with the direct body's wrapper and the longest door it
    // stays under the direct body's 64 KiB, so every valid step can travel directly
    STEP: 64_000,
    STEP_TEXT: 2_000,
    // step and talk ids; option and field ids are shorter
    ID: 128,
    OPTION_ID: 64,
    // a step, value or scope name
    TYPE: 64,
    AGENT_TALK_SCOPE: 128,
    ADDRESS: 254,
    SIGNATURE: 1_024,
    MESSAGE_ID: 998,
    ASK_TITLE: 60,
    ASK_QUESTION: 200,
    ASK_CONTEXT_ITEMS: 3,
    ASK_CONTEXT_ITEM: 120,
    ASK_OPTIONS: 8,
    ASK_FIELDS: 5,
    ASK_NEEDS: 8,
    OPTION_LABEL: 80,
    OPTION_DETAIL: 120,
    FIELD_LABEL: 80,
    RECEIPT_LINE: 120,
    SAY_VALUES: 8,
    CLOSE_OUTCOME: 8,
    HOLD_ADDRESSES: 50,
    VALUE_TEXT: 500,
    TIME_ZONE: 64,
    FILE_NAME: 255,
    MEDIA_TYPE: 255,
    BUSY_BLOCKS: 500,
    // `about`, serialised, and its `@type`
    ABOUT: 8_000,
    ABOUT_TYPE: 64,
    // the json inside an email's block; a step that does not fit travels behind the link
    STEP_BLOCK: 32_000,
    // a widely used sending service refuses a longer header value
    HEADER_VALUE: 870,
    ASK_EXPIRY_DEFAULT_DAYS: 7,
    ASK_EXPIRY_MAX_DAYS: 30,
    PRESENCE_MAX_DAYS: 90,
    // how far ahead of the receiver's clock a token may be dated
    TOKEN_CLOCK_SKEW_MINUTES: 5,
    AGENT_STEPS_PER_TURN: 10,
    ASK_AUTO_DEFAULT_MINUTES: 60,
    ASK_AUTO_MAX_HOURS: 24,
    DIRECT_STEP_MAX_AGE_MINUTES: 5,
} as const;

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// the version of a service's document (protocol 9.1): a change in meaning takes a new one
export const AGENT_TALK_SERVICE_DOCUMENT_VERSION = 1;

// where a service publishes its document, on its issuer's domain
export const AGENT_TALK_SERVICE_WELL_KNOWN_PATH = "/.well-known/agent-talk-service.json";

// the carriers a service document may list. readers ignore a type they do not know, so a new one is additive
export const AGENT_TALK_CARRIER_TYPE = {
    HTTPS: "https",
} as const;
