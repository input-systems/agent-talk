import { AGENT_TALK_CARRIER_TYPE, AGENT_TALK_SERVICE_DOCUMENT_VERSION, AGENT_TALK_SIGNING_ALGORITHM } from "./agentTalk.constants.js";
import type { AgentTalkPublicKeyResolver, AgentTalkSigningKey } from "./agentTalk.types.js";
import { getIsJsonObject } from "./agentTalkJson.utils.js";
import { decodeJws, encodeJwsSegment, signJws, verifyJws } from "./agentTalkJws.utils.js";

// one way a step can reach a service directly: its type and where. a reader ignores a type it does not know, so a service may
// list more carriers later (a queue, a relay) without anyone having to switch
export type AgentTalkCarrier = { type: string; url: string };

// one kind of request an open door handles
export type AgentTalkDoorHandle = { id: string; name: string; description: string };

// an open door's own part of its document: the address, the opaque id a direct step names to reach it, and what it handles
export type AgentTalkDoor = { id: string; address: string; handles: AgentTalkDoorHandle[] };

// a service's document (protocol 9.1): who signs as the issuer, where its keys are, the carriers it takes direct steps on (none
// for a service that speaks by email alone), and where an address's door document is. an open door's document is the same with
// `door`
export type AgentTalkServiceDocument = {
    v: number;
    issuer: string;
    name: string;
    description: string;
    provider: { organization: string; url: string };
    keys: string;
    carriers: AgentTalkCarrier[];
    doors?: string;
    door?: AgentTalkDoor;
};

// one signature over a document: the protected header and the signature, base64url, over the document in jcs (rfc 8785) with
// `signatures` left out. the document itself is the payload and travels beside it
export type AgentTalkServiceDocumentSignature = { protected: string; signature: string };

export type AgentTalkSignedServiceDocument = AgentTalkServiceDocument & { signatures: AgentTalkServiceDocumentSignature[] };

const DOCUMENT_SIGNATURE_TYPE = "agent-talk-service";

const DOCUMENT_LIMIT = {
    TEXT: 500,
    URL: 2048,
    CARRIERS: 8,
    HANDLES: 10,
    HANDLE_NAME: 60,
    HANDLE_DESCRIPTION: 300,
    ID: 128,
    SIGNATURES: 8,
} as const;

const DOOR_TEMPLATE_VARIABLE = "{address}";

const getUnsignedDocument = (document: Record<string, unknown>): Record<string, unknown> => {
    const { signatures: _signatures, ...unsigned } = document;
    return unsigned;
};

const getIsText = (value: unknown, max: number = DOCUMENT_LIMIT.TEXT): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= max;

const getIsHttpsUrl = (value: unknown): value is string =>
    getIsText(value, DOCUMENT_LIMIT.URL) && value.startsWith("https://") && URL.canParse(value);

const KNOWN_CARRIER_TYPES: readonly string[] = Object.values(AGENT_TALK_CARRIER_TYPE);

// a carrier this version knows must be right, or the document is refused so its publisher hears of it. one it does not know is
// kept when it has a type and a url, and otherwise dropped: a later carrier may use another kind of url, and must never make
// an older reader refuse the carriers it does know
const readCarrier = (value: unknown): AgentTalkCarrier | null | undefined => {
    if (!getIsJsonObject(value) || !getIsText(value.type, DOCUMENT_LIMIT.ID)) return undefined;
    if (!KNOWN_CARRIER_TYPES.includes(value.type)) {
        return getIsText(value.url, DOCUMENT_LIMIT.URL) ? { type: value.type, url: value.url } : undefined;
    }

    return getIsHttpsUrl(value.url) ? { type: value.type, url: value.url } : null;
};

const readHandle = (value: unknown): AgentTalkDoorHandle | null =>
    getIsJsonObject(value) &&
    getIsText(value.id, DOCUMENT_LIMIT.ID) &&
    getIsText(value.name, DOCUMENT_LIMIT.HANDLE_NAME) &&
    getIsText(value.description, DOCUMENT_LIMIT.HANDLE_DESCRIPTION)
        ? { id: value.id, name: value.name, description: value.description }
        : null;

const readDoor = (value: unknown): AgentTalkDoor | null | undefined => {
    if (value === undefined) return undefined;
    if (!getIsJsonObject(value) || !getIsText(value.id, DOCUMENT_LIMIT.ID) || !getIsText(value.address, DOCUMENT_LIMIT.TEXT)) return null;
    if (!Array.isArray(value.handles) || value.handles.length > DOCUMENT_LIMIT.HANDLES) return null;
    const handles = value.handles.map(readHandle);

    return handles.every((handle) => handle !== null) ? { id: value.id, address: value.address, handles } : null;
};

// a document as its reader takes it, or null: this version, its own issuer, an https key set, at most 8 carriers each with an
// https url, a door template that names `{address}`, and a well-formed door. fields this version does not define are left out
export const readAgentTalkServiceDocument = (value: unknown): AgentTalkServiceDocument | null => {
    if (!getIsJsonObject(value) || value.v !== AGENT_TALK_SERVICE_DOCUMENT_VERSION) return null;
    const { issuer, name, description, provider, keys, carriers, doors } = value;
    if (!getIsText(issuer, DOCUMENT_LIMIT.ID) || !getIsText(name) || !getIsText(description) || !getIsHttpsUrl(keys)) return null;
    if (!getIsJsonObject(provider) || !getIsText(provider.organization) || !getIsHttpsUrl(provider.url)) return null;
    if (!Array.isArray(carriers) || carriers.length > DOCUMENT_LIMIT.CARRIERS) return null;
    const readCarriers: AgentTalkCarrier[] = [];
    for (const carrier of carriers.map(readCarrier)) {
        if (carrier === null) return null;
        if (carrier) readCarriers.push(carrier);
    }
    if (doors !== undefined && !(getIsHttpsUrl(doors) && doors.includes(DOOR_TEMPLATE_VARIABLE))) return null;
    const door = readDoor(value.door);
    if (door === null) return null;

    return {
        v: AGENT_TALK_SERVICE_DOCUMENT_VERSION,
        issuer,
        name,
        description,
        provider: { organization: provider.organization, url: provider.url },
        keys,
        carriers: readCarriers,
        ...(doors === undefined ? {} : { doors }),
        ...(door === undefined ? {} : { door }),
    };
};

// the document with one signature by this key, replacing any it had
export const signAgentTalkServiceDocument = async (
    document: AgentTalkServiceDocument,
    key: AgentTalkSigningKey,
): Promise<AgentTalkSignedServiceDocument> => {
    const unsigned = getUnsignedDocument(document);
    const jws = await signJws(unsigned, { alg: AGENT_TALK_SIGNING_ALGORITHM, kid: key.kid, typ: DOCUMENT_SIGNATURE_TYPE }, key.privateKey);
    const [protectedHeader = "", , signature = ""] = jws.split(".");

    return { ...document, signatures: [{ protected: protectedHeader, signature }] };
};

// whether the document names this issuer and one of its signatures checks out against a key the caller holds for it. a
// document with no signature, one only by keys the caller does not hold, or one another issuer's key signed, does not
export const verifyAgentTalkServiceDocument = async (
    document: unknown,
    issuer: string,
    getPublicKey: AgentTalkPublicKeyResolver,
): Promise<boolean> => {
    if (!getIsJsonObject(document) || document.issuer !== issuer || !Array.isArray(document.signatures)) return false;

    let payload: string;
    try {
        payload = encodeJwsSegment(getUnsignedDocument(document));
    } catch {
        return false;
    }

    for (const signature of document.signatures.slice(0, DOCUMENT_LIMIT.SIGNATURES)) {
        if (!getIsJsonObject(signature) || typeof signature.protected !== "string" || typeof signature.signature !== "string") continue;
        const decoded = decodeJws(`${signature.protected}.${payload}.${signature.signature}`);
        if (decoded?.header.typ !== DOCUMENT_SIGNATURE_TYPE) continue;
        const publicKey = await getPublicKey(issuer, decoded.header.kid);
        if (publicKey && (await verifyJws(decoded, publicKey))) return true;
    }

    return false;
};

// where the service takes direct steps: its https carrier, or null for a service that speaks by email alone
export const getAgentTalkDirectUrl = (document: AgentTalkServiceDocument): string | null =>
    document.carriers.find((carrier) => carrier.type === AGENT_TALK_CARRIER_TYPE.HTTPS)?.url ?? null;

// where one address's door document is, from the document's template, or null when it names none
export const getAgentTalkDoorDocumentUrl = (document: AgentTalkServiceDocument, address: string): string | null =>
    document.doors ? document.doors.replace(DOOR_TEMPLATE_VARIABLE, encodeURIComponent(address.trim().toLowerCase())) : null;
