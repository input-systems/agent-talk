import { AGENT_TALK_LIMIT, AGENT_TALK_VERSION, COMPACT_JWS_PATTERN } from "./agentTalk.constants.js";
import type { AgentTalkHeader } from "./agentTalk.types.js";

// X-Agent-Talk: v=1; p=<presence token>; t=<talk token>

const PARAMETER_SEPARATOR = ";";

// a talk token that would push the value past what sending services take is left out: the email's block and
// its link carry it as well
export const formatAgentTalkHeader = (header: Omit<AgentTalkHeader, "v">): string => {
    const parameters = [`v=${AGENT_TALK_VERSION}`];
    if (header.presence) parameters.push(`p=${header.presence}`);

    const value = parameters.join(`${PARAMETER_SEPARATOR} `);
    if (!header.talk) return value;

    const valueWithTalk = `${value}${PARAMETER_SEPARATOR} t=${header.talk}`;
    return valueWithTalk.length > AGENT_TALK_LIMIT.HEADER_VALUE ? value : valueWithTalk;
};

// tolerant of folding whitespace and unknown parameters; a token that isn't a compact jws is dropped
export const parseAgentTalkHeader = (value: string): AgentTalkHeader | null => {
    const parameters = new Map<string, string>();

    for (const part of value.replace(/\s+/g, "").split(PARAMETER_SEPARATOR)) {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex <= 0) continue;
        parameters.set(part.slice(0, separatorIndex).toLowerCase(), part.slice(separatorIndex + 1));
    }

    const version = Number(parameters.get("v"));
    if (!Number.isInteger(version) || version < 1) return null;

    const presence = parameters.get("p");
    const talk = parameters.get("t");

    return {
        v: version,
        ...(presence && COMPACT_JWS_PATTERN.test(presence) ? { presence } : {}),
        ...(talk && COMPACT_JWS_PATTERN.test(talk) ? { talk } : {}),
    };
};

// X-Agent-Talk-Link: <https://input.so/t/<talk token>>
// one url, three views: markdown for agents that don't speak the protocol, json for those that do, the web card for people
const LINK_PATTERN = /^\s*<(https:\/\/[^\s<>]+)>\s*$/;

export const formatAgentTalkLinkHeader = (url: string): string => `<${url}>`;

// only an https url in angle brackets counts; anything else is ignored
export const parseAgentTalkLinkHeader = (value: string): string | null => LINK_PATTERN.exec(value)?.[1] ?? null;
