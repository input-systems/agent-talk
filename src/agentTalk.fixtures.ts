import type { AgentTalkAskStep, AgentTalkPublicKeyResolver, AgentTalkSigningKey } from "./agentTalk.types.js";
import { generateAgentTalkSigningKeyPair } from "./agentTalkJws.utils.js";

export const ISSUER = "input.so";
export const KID = "2026-11";

export const MEMBER_ADDRESS = "krijn@example.com";
export const MAYA = "maya@example.com";

// when the fixture ask was written, and when it runs out
export const ASKED_AT = "2026-11-20T10:00:00.000Z";
export const EXPIRES_AT = "2026-11-27T10:00:00.000Z";

// a service's signing key, and the resolver a receiver that recognises that service holds
export const createKeys = async (): Promise<{ key: AgentTalkSigningKey; getPublicKey: AgentTalkPublicKeyResolver }> => {
    const pair = await generateAgentTalkSigningKeyPair();

    return {
        key: { kid: KID, privateKey: pair.privateKey },
        getPublicKey: (issuer, kid) => Promise.resolve(issuer === ISSUER && kid === KID ? pair.publicKey : null),
    };
};

// krijn's agent asks maya which of two evenings works, as its author wrote it
export const createAsk = (overrides: Partial<AgentTalkAskStep> = {}): AgentTalkAskStep => ({
    id: "st_1",
    talk: "tk_1",
    at: ASKED_AT,
    by: { address: MEMBER_ADDRESS, actor: "agent" },
    text: "Krijn's agent asks which evening works for dinner.",
    type: "ask",
    to: [MAYA],
    question: "Which evening works for dinner?",
    context: ["Both free after 7"],
    options: [
        {
            id: "tue",
            label: "Tuesday · 7:30 PM",
            detail: "Walkable for you both",
            isRecommended: true,
            value: {
                type: "time",
                text: "Tue 24 Nov, 19:30–21:30",
                start: "2026-11-24T19:30:00+01:00",
                end: "2026-11-24T21:30:00+01:00",
                timeZone: "Europe/Amsterdam",
            },
        },
        {
            id: "thu",
            label: "Thursday · 8:00 PM",
            value: {
                type: "time",
                text: "Thu 26 Nov, 20:00–22:00",
                start: "2026-11-26T20:00:00+01:00",
                end: "2026-11-26T22:00:00+01:00",
                timeZone: "Europe/Amsterdam",
            },
        },
    ],
    can: { counter: true, decline: true, text: false },
    answerBy: "personOrAgent",
    needs: ["calendar.book"],
    expires: EXPIRES_AT,
    ...overrides,
});

export const minutesAfterAsk = (minutes: number): Date => new Date(Date.parse(ASKED_AT) + minutes * 60 * 1000);
