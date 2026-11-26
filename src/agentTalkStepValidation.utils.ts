import {
    AGENT_TALK_LIMIT,
    AGENT_TALK_ANSWER_RESULT,
    AGENT_TALK_ASK_ANSWER_BY,
    AGENT_TALK_ASK_EFFECT,
    AGENT_TALK_ASK_SELECT,
    AGENT_TALK_CLOSE_REASON,
    DAY_MS,
    AGENT_TALK_HOLD_REASON,
    HOUR_MS,
    AGENT_TALK_PRIVATE_TYPE_PATTERN,
    AGENT_TALK_REQUESTABLE_SCOPES,
    AGENT_TALK_STEP_ACTOR,
    AGENT_TALK_STEP_TYPE,
    AGENT_TALK_STEP_VIA,
    AGENT_TALK_VALUE_TYPE,
} from "./agentTalk.constants.js";
import type {
    AgentTalkSignedStep,
    AgentTalkStep,
    AgentTalkUnsignedStep,
    AgentTalkValidationIssue,
    AgentTalkValidationResult,
    ValueOf,
} from "./agentTalk.types.js";
import { getCanonicalJson, getIsJsonObject } from "./agentTalkJson.utils.js";
import { getIsAgentTalkScope } from "./agentTalkScope.utils.js";
import { getIsKnownAgentTalkStep, getIsKnownAgentTalkValue } from "./agentTalkStep.utils.js";

type JsonObject = Record<string, unknown>;

// how far a step has come: built by its author, signed by its author's service, ordered by the host
const STEP_STAGE = {
    BUILT: "built",
    SIGNED: "signed",
    ORDERED: "ordered",
} as const;

type StepStage = ValueOf<typeof STEP_STAGE>;

const STEP_ACTORS: readonly string[] = Object.values(AGENT_TALK_STEP_ACTOR);
const STEP_VIAS: readonly string[] = Object.values(AGENT_TALK_STEP_VIA);
const ANSWER_RESULTS: readonly string[] = Object.values(AGENT_TALK_ANSWER_RESULT);
const HOLD_REASONS: readonly string[] = Object.values(AGENT_TALK_HOLD_REASON);
const CLOSE_REASONS: readonly string[] = Object.values(AGENT_TALK_CLOSE_REASON);
const ASK_ANSWER_BYS: readonly string[] = Object.values(AGENT_TALK_ASK_ANSWER_BY);
const ASK_SELECTS: readonly string[] = Object.values(AGENT_TALK_ASK_SELECT);
const ASK_EFFECTS: readonly string[] = Object.values(AGENT_TALK_ASK_EFFECT);
const REQUESTABLE: readonly string[] = AGENT_TALK_REQUESTABLE_SCOPES;

// ids, types and scopes are tokens, so whatever prints one or looks one up never meets markup or a line break
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const TYPE_PATTERN = /^[a-z][A-Za-z0-9-]*$/;
const SCOPE_PATTERN = /^[a-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)*$/;
// a mailbox address with a plain host name, and no spaces or markup before the @
const ADDRESS_PATTERN = /^[^\s@<>()[\]\\,;:"`]+@[a-z0-9.-]+\.[a-z0-9-]+$/;
// a Message-ID as mail headers write it (RFC 5322 msg-id): one id in angle brackets, no spaces or markup inside
const MESSAGE_ID_PATTERN = /^<[^\s<>@"]+@[^\s<>@"]+>$/;
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// a day that exists: Date.parse rolls 2026-02-30 over to 2 March instead of refusing it
const getIsRealDay = (year: string, month: string, day: string): boolean => {
    const date = new Date(0);
    date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));

    return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
};

// an rfc 3339 time on a day that exists, with an hour, minute, second and offset in range. no leap seconds
const getIsRealTime = (value: string): boolean => {
    const match = RFC3339_PATTERN.exec(value);
    if (!match) return false;
    const [, year = "", month = "", day = "", hour = "", minute = "", second = "", , , offsetHour = "0", offsetMinute = "0"] = match;

    return (
        getIsRealDay(year, month, day) &&
        Number(hour) <= 23 &&
        Number(minute) <= 59 &&
        Number(second) <= 59 &&
        Number(offsetHour) <= 23 &&
        Number(offsetMinute) <= 59
    );
};

const getIsRealDate = (value: string): boolean => {
    const match = DATE_PATTERN.exec(value);
    return match !== null && getIsRealDay(match[1] ?? "", match[2] ?? "", match[3] ?? "");
};
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HTTPS_PATTERN = /^https:\/\//;

const getIsKnownStepType = (type: string): boolean => getIsKnownAgentTalkStep({ type });
const getIsKnownValueType = (type: string): boolean => getIsKnownAgentTalkValue({ type });

// each check reads one key of a record and reports under its path. a key is required unless the last argument
// says it is optional
const createIssues = (stage: StepStage) => {
    const issues: AgentTalkValidationIssue[] = [];
    // an author uses the types and scopes this version knows, or private ones. a receiver also lets through a name
    // a later version added: it shows the text, and treats the scope as one nobody granted
    const isAuthoring = stage === STEP_STAGE.BUILT;

    const add = (path: string, message: string) => {
        issues.push({ path, message });
    };

    const text = (record: JsonObject, key: string, path: string, max: number, isOptional = false) => {
        const value = record[key];
        if (value === undefined && isOptional) return;
        if (typeof value !== "string" || value.length === 0) {
            add(`${path}.${key}`, "must be a non-empty string");
            return;
        }
        if (value.length > max) add(`${path}.${key}`, `must be at most ${max} characters`);
    };

    const id = (record: JsonObject, key: string, path: string, max: number, isOptional = false) => {
        const value = record[key];
        if (value === undefined && isOptional) return;
        if (typeof value !== "string" || value.length > max || !ID_PATTERN.test(value)) {
            add(`${path}.${key}`, `must be an id of letters, digits, - and _, at most ${max} long`);
        }
    };

    const oneOf = (record: JsonObject, key: string, path: string, allowed: readonly string[], isOptional = false) => {
        const value = record[key];
        if (value === undefined && isOptional) return;
        if (typeof value !== "string" || !allowed.includes(value)) add(`${path}.${key}`, `must be one of ${allowed.join(", ")}`);
    };

    const pattern = (record: JsonObject, key: string, path: string, regex: RegExp, label: string, isOptional = false) => {
        const value = record[key];
        if (value === undefined && isOptional) return;
        if (typeof value !== "string" || !regex.test(value)) add(`${path}.${key}`, `must be ${label}`);
    };

    // the shape alone lets 2026-99-99T99:99:99Z through, and a time that does not parse never compares as past
    const time = (record: JsonObject, key: string, path: string, isOptional = false) => {
        const value = record[key];
        if (value === undefined && isOptional) return;
        if (typeof value !== "string" || !getIsRealTime(value)) {
            add(`${path}.${key}`, "must be an RFC 3339 time");
        }
    };

    const flag = (record: JsonObject, key: string, path: string, isOptional = false) => {
        const value = record[key];
        if (value === undefined && isOptional) return;
        if (typeof value !== "boolean") add(`${path}.${key}`, "must be a boolean");
    };

    const list = (record: JsonObject, key: string, path: string, max: number, isOptional = false): unknown[] => {
        const value = record[key];
        if (value === undefined && isOptional) return [];
        if (!Array.isArray(value)) {
            add(`${path}.${key}`, "must be a list");
            return [];
        }
        const items: unknown[] = value;
        if (items.length > max) add(`${path}.${key}`, `must have at most ${max} items`);
        return items;
    };

    // the address is the identity, so it arrives lowercased. the length is checked before the pattern runs
    const address = (value: unknown, path: string) => {
        const isAddress =
            typeof value === "string" &&
            value.length <= AGENT_TALK_LIMIT.ADDRESS &&
            ADDRESS_PATTERN.test(value) &&
            value === value.toLowerCase();
        if (!isAddress) add(path, "must be a lowercased email address");
    };

    const type = (value: unknown, path: string, getIsKnown: (name: string) => boolean) => {
        const isAllowed =
            typeof value === "string" &&
            value.length <= AGENT_TALK_LIMIT.TYPE &&
            (getIsKnown(value) || (isAuthoring ? AGENT_TALK_PRIVATE_TYPE_PATTERN : TYPE_PATTERN).test(value));
        if (!isAllowed) add(path, isAuthoring ? "must be a known type or start with x-" : "must be a type name");
    };

    const scope = (value: unknown, path: string) => {
        const isAllowed =
            typeof value === "string" &&
            value.length <= AGENT_TALK_LIMIT.AGENT_TALK_SCOPE &&
            (isAuthoring ? getIsAgentTalkScope(value) : SCOPE_PATTERN.test(value));
        if (!isAllowed) add(path, isAuthoring ? "must be a known scope, a tool scope or start with x-" : "must be a scope name");
    };

    return { issues, add, text, id, oneOf, pattern, time, flag, list, address, type, scope };
};

type Issues = ReturnType<typeof createIssues>;

const validateValue = (value: unknown, path: string, check: Issues) => {
    if (!getIsJsonObject(value)) {
        check.add(path, "must be an object");
        return;
    }

    check.text(value, "text", path, AGENT_TALK_LIMIT.VALUE_TEXT);
    check.type(value.type, `${path}.type`, getIsKnownValueType);

    switch (value.type) {
        case AGENT_TALK_VALUE_TYPE.TIME:
            check.time(value, "start", path);
            check.time(value, "end", path);
            check.text(value, "timeZone", path, AGENT_TALK_LIMIT.TIME_ZONE);
            check.text(value, "place", path, AGENT_TALK_LIMIT.VALUE_TEXT, true);
            check.flag(value, "isCall", path, true);
            if (typeof value.start === "string" && typeof value.end === "string" && Date.parse(value.end) <= Date.parse(value.start)) {
                check.add(`${path}.end`, "must be after start");
            }
            return;
        case AGENT_TALK_VALUE_TYPE.BUSY: {
            check.time(value, "from", path);
            check.time(value, "to", path);
            check.list(value, "blocks", path, AGENT_TALK_LIMIT.BUSY_BLOCKS).forEach((block, index) => {
                const blockPath = `${path}.blocks[${index}]`;
                if (!getIsJsonObject(block)) {
                    check.add(blockPath, "must be an object");
                    return;
                }
                check.time(block, "start", blockPath);
                check.time(block, "end", blockPath);
            });
            return;
        }
        case AGENT_TALK_VALUE_TYPE.DATE:
            if (typeof value.date !== "string" || !getIsRealDate(value.date)) check.add(`${path}.date`, "must be a YYYY-MM-DD date");
            return;
        case AGENT_TALK_VALUE_TYPE.PLACE:
            check.text(value, "name", path, AGENT_TALK_LIMIT.VALUE_TEXT);
            check.text(value, "address", path, AGENT_TALK_LIMIT.VALUE_TEXT, true);
            return;
        case AGENT_TALK_VALUE_TYPE.CONTACT:
            check.address(value.address, `${path}.address`);
            check.text(value, "name", path, AGENT_TALK_LIMIT.VALUE_TEXT, true);
            return;
        case AGENT_TALK_VALUE_TYPE.AMOUNT:
            check.pattern(value, "currency", path, CURRENCY_PATTERN, "an ISO 4217 code");
            check.pattern(value, "amount", path, DECIMAL_PATTERN, "a decimal string");
            return;
        case AGENT_TALK_VALUE_TYPE.LINK:
            check.pattern(value, "url", path, HTTPS_PATTERN, "an https url");
            return;
        case AGENT_TALK_VALUE_TYPE.FILE:
            check.text(value, "name", path, AGENT_TALK_LIMIT.FILE_NAME);
            check.text(value, "mediaType", path, AGENT_TALK_LIMIT.MEDIA_TYPE);
            check.pattern(value, "sha256", path, SHA256_PATTERN, "a lowercase hex sha-256");
            check.pattern(value, "url", path, HTTPS_PATTERN, "an https url");
            if (typeof value.size !== "number" || !Number.isInteger(value.size) || value.size < 0)
                check.add(`${path}.size`, "must be a byte count");
            return;
        default:
            // text, private types and types a later version added carry nothing this version reads beyond their text
            return;
    }
};

const validateValues = (values: unknown[], path: string, check: Issues) => {
    values.forEach((value, index) => {
        validateValue(value, `${path}[${index}]`, check);
    });
};

const validateReceipt = (value: unknown, path: string, check: Issues) => {
    if (value === undefined) return;
    if (!getIsJsonObject(value)) {
        check.add(path, "must be an object");
        return;
    }
    check.text(value, "shared", path, AGENT_TALK_LIMIT.RECEIPT_LINE);
    check.text(value, "held", path, AGENT_TALK_LIMIT.RECEIPT_LINE, true);
};

// one schema.org object. its properties are the sender's to choose; only its type and its size are checked
const validateAbout = (value: unknown, path: string, check: Issues) => {
    if (value === undefined) return;
    if (!getIsJsonObject(value)) {
        check.add(path, "must be an object");
        return;
    }

    check.text(value, "@type", path, AGENT_TALK_LIMIT.ABOUT_TYPE);
    if (getCanonicalJson(value).length > AGENT_TALK_LIMIT.ABOUT) {
        check.add(path, `must be at most ${AGENT_TALK_LIMIT.ABOUT} characters as json`);
    }
};

// only free/busy, booking and shared mail may be asked for or said to be given
const validateRequestableScopes = (scopes: unknown[], path: string, check: Issues) => {
    scopes.forEach((scope, index) => {
        if (typeof scope !== "string" || !REQUESTABLE.includes(scope)) {
            check.add(`${path}[${index}]`, `may only be one of ${REQUESTABLE.join(", ")}`);
        }
    });
};

const validateAsk = (step: JsonObject, check: Issues) => {
    const path = "step";

    validateAbout(step.about, `${path}.about`, check);

    const to = check.list(step, "to", path, AGENT_TALK_LIMIT.TALK_PARTIES);
    if (Array.isArray(step.to) && to.length === 0) check.add(`${path}.to`, "must name who should answer");
    to.forEach((address, index) => {
        check.address(address, `${path}.to[${index}]`);
    });

    check.text(step, "title", path, AGENT_TALK_LIMIT.ASK_TITLE, true);
    check.text(step, "question", path, AGENT_TALK_LIMIT.ASK_QUESTION);

    check.list(step, "context", path, AGENT_TALK_LIMIT.ASK_CONTEXT_ITEMS, true).forEach((line, index) => {
        if (typeof line !== "string" || line.length === 0 || line.length > AGENT_TALK_LIMIT.ASK_CONTEXT_ITEM) {
            check.add(`${path}.context[${index}]`, `must be 1–${AGENT_TALK_LIMIT.ASK_CONTEXT_ITEM} characters`);
        }
    });

    const options = check.list(step, "options", path, AGENT_TALK_LIMIT.ASK_OPTIONS, true);
    const optionIds = new Set<unknown>();
    let recommendedCount = 0;
    options.forEach((option, index) => {
        const optionPath = `${path}.options[${index}]`;
        if (!getIsJsonObject(option)) {
            check.add(optionPath, "must be an object");
            return;
        }
        check.id(option, "id", optionPath, AGENT_TALK_LIMIT.OPTION_ID);
        if (optionIds.has(option.id)) check.add(`${optionPath}.id`, "must be unique");
        optionIds.add(option.id);
        check.text(option, "label", optionPath, AGENT_TALK_LIMIT.OPTION_LABEL);
        check.text(option, "detail", optionPath, AGENT_TALK_LIMIT.OPTION_DETAIL, true);
        check.flag(option, "isRecommended", optionPath, true);
        if (option.isRecommended === true) recommendedCount++;
        if (option.value !== undefined) validateValue(option.value, `${optionPath}.value`, check);
    });
    if (recommendedCount > 1) check.add(`${path}.options`, "may recommend at most one option");

    check.oneOf(step, "select", path, ASK_SELECTS, true);

    check.list(step, "fields", path, AGENT_TALK_LIMIT.ASK_FIELDS, true).forEach((field, index) => {
        const fieldPath = `${path}.fields[${index}]`;
        if (!getIsJsonObject(field)) {
            check.add(fieldPath, "must be an object");
            return;
        }
        check.id(field, "id", fieldPath, AGENT_TALK_LIMIT.OPTION_ID);
        check.text(field, "label", fieldPath, AGENT_TALK_LIMIT.FIELD_LABEL);
        check.type(field.type, `${fieldPath}.type`, getIsKnownValueType);
        check.flag(field, "isRequired", fieldPath, true);
    });

    const can = step.can;
    if (!getIsJsonObject(can)) {
        check.add(`${path}.can`, "must say whether counter, decline and text are allowed");
    } else {
        check.flag(can, "counter", `${path}.can`);
        check.flag(can, "decline", `${path}.can`);
        check.flag(can, "text", `${path}.can`);
    }

    check.oneOf(step, "answerBy", path, ASK_ANSWER_BYS);

    check.list(step, "needs", path, AGENT_TALK_LIMIT.ASK_NEEDS, true).forEach((scope, index) => {
        check.scope(scope, `${path}.needs[${index}]`);
    });

    check.oneOf(step, "effect", path, ASK_EFFECTS, true);
    if (step.effect === AGENT_TALK_ASK_EFFECT.INTRODUCTION) {
        // a person decides whom they meet, and a yes has to name them
        if (step.answerBy !== AGENT_TALK_ASK_ANSWER_BY.PERSON) check.add(`${path}.answerBy`, "only the person answers an introduction");
        const namesContact = options.some(
            (option) => getIsJsonObject(option) && getIsJsonObject(option.value) && option.value.type === AGENT_TALK_VALUE_TYPE.CONTACT,
        );
        if (!namesContact) check.add(`${path}.options`, "an introduction needs an option whose value is the contact to be introduced");
    }

    check.time(step, "due", path, true);
    check.time(step, "expires", path);
    check.time(step, "autoUntil", path, true);
    check.flag(step, "counters", path, true);

    const requestedScopes = check.list(step, "requestedScopes", path, AGENT_TALK_REQUESTABLE_SCOPES.length, true);
    validateRequestableScopes(requestedScopes, `${path}.requestedScopes`, check);
    check.time(step, "requestedUntil", path, true);
    if (requestedScopes.length > 0 && step.answerBy !== AGENT_TALK_ASK_ANSWER_BY.PERSON) {
        check.add(`${path}.answerBy`, "only the person answers an ask that requests scopes");
    }

    if (step.counters === true && typeof step.re !== "string") check.add(`${path}.re`, "a counter must name the ask it replaces");

    if (typeof step.at === "string" && typeof step.expires === "string") {
        const lifetime = Date.parse(step.expires) - Date.parse(step.at);
        if (lifetime <= 0) check.add(`${path}.expires`, "must be after at");
        if (lifetime > AGENT_TALK_LIMIT.ASK_EXPIRY_MAX_DAYS * DAY_MS) {
            check.add(`${path}.expires`, `must be within ${AGENT_TALK_LIMIT.ASK_EXPIRY_MAX_DAYS} days of at`);
        }
    }

    if (typeof step.at === "string" && typeof step.autoUntil === "string") {
        const autoWindow = Date.parse(step.autoUntil) - Date.parse(step.at);
        if (autoWindow <= 0) check.add(`${path}.autoUntil`, "must be after at");
        if (autoWindow > AGENT_TALK_LIMIT.ASK_AUTO_MAX_HOURS * HOUR_MS) {
            check.add(`${path}.autoUntil`, `must be within ${AGENT_TALK_LIMIT.ASK_AUTO_MAX_HOURS} hours of at`);
        }
        if (typeof step.expires === "string" && Date.parse(step.autoUntil) > Date.parse(step.expires)) {
            check.add(`${path}.autoUntil`, "must not be after expires");
        }
    }
};

const validateAnswer = (step: JsonObject, check: Issues) => {
    const path = "step";

    if (step.re === undefined) check.add(`${path}.re`, "an answer must name the ask it answers");
    check.oneOf(step, "result", path, ANSWER_RESULTS);

    const picks = check.list(step, "picks", path, AGENT_TALK_LIMIT.ASK_OPTIONS, true);
    picks.forEach((pick, index) => {
        if (typeof pick !== "string" || pick.length > AGENT_TALK_LIMIT.OPTION_ID || !ID_PATTERN.test(pick)) {
            check.add(`${path}.picks[${index}]`, "must be an option id");
        }
    });

    const values = step.values;
    if (values !== undefined) {
        if (!getIsJsonObject(values)) {
            check.add(`${path}.values`, "must map field ids to values");
        } else {
            if (Object.keys(values).length > AGENT_TALK_LIMIT.ASK_FIELDS)
                check.add(`${path}.values`, `must have at most ${AGENT_TALK_LIMIT.ASK_FIELDS} values`);
            for (const [fieldId, value] of Object.entries(values)) {
                if (fieldId.length > AGENT_TALK_LIMIT.OPTION_ID || !ID_PATTERN.test(fieldId)) {
                    check.add(`${path}.values`, "must be keyed by field ids");
                    continue;
                }
                validateValue(value, `${path}.values.${fieldId}`, check);
            }
        }
    }

    validateReceipt(step.receipt, `${path}.receipt`, check);
    check.flag(step, "isInterpreted", path, true);

    const granted = step.granted;
    if (granted !== undefined) {
        if (!getIsJsonObject(granted)) {
            check.add(`${path}.granted`, "must be an object");
        } else {
            const grantedScopes = check.list(granted, "scopes", `${path}.granted`, AGENT_TALK_REQUESTABLE_SCOPES.length);
            validateRequestableScopes(grantedScopes, `${path}.granted.scopes`, check);
            check.flag(granted, "isStanding", `${path}.granted`);
            check.time(granted, "until", `${path}.granted`, true);
        }
    }

    if (step.result === AGENT_TALK_ANSWER_RESULT.DECLINED && (picks.length > 0 || values !== undefined || granted !== undefined)) {
        check.add(`${path}.result`, "a decline carries no picks, values or granted scopes");
    }
};

const validateBody = (step: JsonObject, check: Issues) => {
    const path = "step";

    switch (step.type) {
        case AGENT_TALK_STEP_TYPE.SAY:
            validateValues(check.list(step, "values", path, AGENT_TALK_LIMIT.SAY_VALUES, true), `${path}.values`, check);
            validateReceipt(step.receipt, `${path}.receipt`, check);
            validateAbout(step.about, `${path}.about`, check);
            return;
        case AGENT_TALK_STEP_TYPE.ASK:
            validateAsk(step, check);
            return;
        case AGENT_TALK_STEP_TYPE.ANSWER:
            validateAnswer(step, check);
            return;
        case AGENT_TALK_STEP_TYPE.HOLD:
            check.oneOf(step, "reason", path, HOLD_REASONS);
            check.list(step, "addresses", path, AGENT_TALK_LIMIT.HOLD_ADDRESSES, true).forEach((address, index) => {
                check.address(address, `${path}.addresses[${index}]`);
            });
            return;
        case AGENT_TALK_STEP_TYPE.WAIT:
            if (step.re === undefined) check.add(`${path}.re`, "a wait must name the step that needs the person");
            return;
        case AGENT_TALK_STEP_TYPE.RESUME:
            return;
        case AGENT_TALK_STEP_TYPE.CLOSE:
            check.oneOf(step, "reason", path, CLOSE_REASONS);
            validateValues(check.list(step, "outcome", path, AGENT_TALK_LIMIT.CLOSE_OUTCOME, true), `${path}.outcome`, check);
            return;
        default:
            // a private type, or one a later version added: a receiver shows its text, so only the envelope and the
            // step's size are checked
            return;
    }
};

const validateEnvelope = (step: JsonObject, check: Issues, stage: StepStage) => {
    const path = "step";

    check.id(step, "id", path, AGENT_TALK_LIMIT.ID);
    check.id(step, "talk", path, AGENT_TALK_LIMIT.ID);
    if (stage !== STEP_STAGE.BUILT) check.text(step, "sig", path, AGENT_TALK_LIMIT.SIGNATURE);
    // a signed step has its order only once the host accepted it
    if (stage === STEP_STAGE.ORDERED || (stage === STEP_STAGE.SIGNED && step.seq !== undefined)) {
        if (typeof step.seq !== "number" || !Number.isInteger(step.seq) || step.seq < 0)
            check.add(`${path}.seq`, "must be a non-negative integer");
    }
    check.time(step, "at", path);

    const by = step.by;
    if (!getIsJsonObject(by)) {
        check.add(`${path}.by`, "must name who took the step");
    } else {
        check.address(by.address, `${path}.by.address`);
        check.oneOf(by, "actor", `${path}.by`, STEP_ACTORS);
    }

    check.oneOf(step, "via", path, STEP_VIAS, true);
    check.id(step, "re", path, AGENT_TALK_LIMIT.ID, true);
    check.text(step, "email", path, AGENT_TALK_LIMIT.MESSAGE_ID, true);
    check.pattern(step, "email", path, MESSAGE_ID_PATTERN, "a Message-ID in angle brackets", true);
    check.text(step, "text", path, AGENT_TALK_LIMIT.STEP_TEXT);
    check.type(step.type, `${path}.type`, getIsKnownStepType);
};

const textEncoder = new TextEncoder();

// checked first, so nothing below walks a step that is too large, or nested too deep to have a canonical form. bytes, not
// characters, since the direct carrier caps its body in bytes
const getSizeIssue = (step: JsonObject): AgentTalkValidationIssue | null => {
    try {
        return textEncoder.encode(getCanonicalJson(step)).length > AGENT_TALK_LIMIT.STEP
            ? { path: "step", message: `must be at most ${AGENT_TALK_LIMIT.STEP} bytes as json` }
            : null;
    } catch {
        return { path: "step", message: "must be plain json" };
    }
};

const validate = <T>(input: unknown, stage: StepStage): AgentTalkValidationResult<T> => {
    if (!getIsJsonObject(input)) return { isValid: false, issues: [{ path: "step", message: "must be an object" }] };

    const sizeIssue = getSizeIssue(input);
    if (sizeIssue) return { isValid: false, issues: [sizeIssue] };

    const check = createIssues(stage);
    validateEnvelope(input, check, stage);
    validateBody(input, check);

    return check.issues.length === 0 ? { isValid: true, value: input as T } : { isValid: false, issues: check.issues };
};

// a step as the host stores and relays it, with its order and signature
export const validateAgentTalkStep = (input: unknown): AgentTalkValidationResult<AgentTalkStep> =>
    validate<AgentTalkStep>(input, STEP_STAGE.ORDERED);

// a step as its author signed it, which is how an email carries it: the host's order is there only once it accepted it
export const validateAgentTalkSignedStep = (input: unknown): AgentTalkValidationResult<AgentTalkSignedStep> =>
    validate<AgentTalkSignedStep>(input, STEP_STAGE.SIGNED);

// a step as its author builds it, before signing and before the host orders it. an author names known types and
// scopes or private ones; only a receiver lets through names a later version added
export const validateAgentTalkUnsignedStep = (input: unknown): AgentTalkValidationResult<AgentTalkUnsignedStep> =>
    validate<AgentTalkUnsignedStep>(input, STEP_STAGE.BUILT);
