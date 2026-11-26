import { getIsJsonObject } from "./agentTalkJson.utils.js";

// the dns name a domain names its agent talk services under (protocol 3.3)
export const AGENT_TALK_DELEGATION_RECORD_PREFIX = "_agent-talk.";

// the file a domain that cannot edit dns publishes instead, on its own host
export const AGENT_TALK_DELEGATION_WELL_KNOWN_PATH = "/.well-known/agent-talk.json";

// a domain's word that a service may speak for its addresses: the service's issuer domain, the hosted account when the service
// hosts many companies, and the local parts it covers (none: every address at the domain)
export type AgentTalkDelegationRecord = { svc: string; acct?: string; local?: string[] };

const ISSUER_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const ACCOUNT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const LOCAL_PART_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$/;
const LOCAL_PARTS_MAX = 64;
const RECORDS_MAX = 16;

const getLocalParts = (value: unknown): string[] | null => {
    if (!Array.isArray(value) || value.length === 0 || value.length > LOCAL_PARTS_MAX) return null;
    const parts = value.map((part) => (typeof part === "string" ? part.trim().toLowerCase() : ""));

    return parts.every((part) => LOCAL_PART_PATTERN.test(part)) ? parts : null;
};

const getRecord = (fields: { svc?: unknown; acct?: unknown; local?: unknown }): AgentTalkDelegationRecord | null => {
    const svc = typeof fields.svc === "string" ? fields.svc.trim().toLowerCase() : "";
    if (!ISSUER_PATTERN.test(svc)) return null;
    if (fields.acct !== undefined && (typeof fields.acct !== "string" || !ACCOUNT_PATTERN.test(fields.acct))) return null;
    const local = fields.local === undefined ? undefined : getLocalParts(fields.local);
    if (local === null) return null;

    return { svc, ...(typeof fields.acct === "string" ? { acct: fields.acct } : {}), ...(local ? { local } : {}) };
};

// one txt record, `v=1; svc=intercom.com; acct=…; local=news,billing`, or null when it is not one: `v=1` first, `svc` required,
// a tag named twice or unknown makes the whole record not count
export function parseAgentTalkDelegationTxt(txt: string): AgentTalkDelegationRecord | null {
    const tags = txt
        .split(";")
        .map((tag) => tag.trim())
        .filter(Boolean);
    if (tags[0]?.replace(/\s+/g, "") !== "v=1") return null;

    const fields = new Map<string, string>();
    for (const tag of tags.slice(1)) {
        const separator = tag.indexOf("=");
        if (separator <= 0) return null;
        const name = tag.slice(0, separator).trim();
        if (fields.has(name) || !["svc", "acct", "local"].includes(name)) return null;
        fields.set(name, tag.slice(separator + 1).trim());
    }
    const local = fields.get("local");

    return getRecord({ svc: fields.get("svc"), acct: fields.get("acct"), local: local === undefined ? undefined : local.split(",") });
}

// the well-known file, `{ "v": 1, "services": [{ "svc", "acct", "local" }] }`: its records, or null when the file is not one. a
// malformed entry makes the whole file not count, so a typo never narrows or widens what the domain said
export function parseAgentTalkDelegationFile(value: unknown): AgentTalkDelegationRecord[] | null {
    if (!getIsJsonObject(value) || value.v !== 1 || !Array.isArray(value.services) || value.services.length > RECORDS_MAX) return null;
    const records = value.services.map((entry) => (getIsJsonObject(entry) ? getRecord(entry) : null));

    return records.every((record) => record !== null) ? records : null;
}

// whether a record speaks for an address: its service, the hosted account the delegation is for (a record naming an account
// counts only for that account, one naming none only for a service that hosts no accounts), and the local part
export function getIsAgentTalkDelegatedAddress(
    record: AgentTalkDelegationRecord,
    expected: { svc: string; acct?: string; address: string },
): boolean {
    if (record.svc !== expected.svc || record.acct !== expected.acct) return false;
    if (!record.local) return true;
    const localPart = expected.address.toLowerCase().split("@")[0] ?? "";

    return record.local.includes(localPart);
}
