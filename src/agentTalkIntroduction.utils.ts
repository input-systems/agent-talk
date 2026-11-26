import {
    AGENT_TALK_ANSWER_RESULT,
    AGENT_TALK_ASK_EFFECT,
    AGENT_TALK_INTRODUCTION_REQUEST_TYPE,
    AGENT_TALK_STEP_TYPE,
    AGENT_TALK_VALUE_TYPE,
} from "./agentTalk.constants.js";

// the parts of a step who-introduced-whom reads, so the api's steps and the web's parsed rows both fit
type IntroductionValue = { type: string; address?: string };
export type AgentTalkIntroductionStep = {
    type: string;
    id: string;
    re?: string;
    by: { address: string };
    result?: string;
    picks?: readonly string[];
    effect?: string;
    about?: { "@type": string };
    outcome?: readonly IntroductionValue[];
    options?: readonly { id: string; value?: IntroductionValue }[];
};

const getContactAddress = (value: IntroductionValue | undefined): string | null =>
    value?.type === AGENT_TALK_VALUE_TYPE.CONTACT && value.address ? value.address.toLowerCase() : null;

// the people this side of a talk agreed to meet: the one its own introduction request names, and the one an introduction
// asked of it names when its own answer picked them
const getAgreedIntroductionAddresses = (steps: readonly AgentTalkIntroductionStep[], peerAddress: string): Set<string> => {
    const agreed = new Set<string>();
    for (const ask of steps) {
        if (ask.type !== AGENT_TALK_STEP_TYPE.ASK || ask.effect !== AGENT_TALK_ASK_EFFECT.INTRODUCTION) continue;

        if (ask.by.address !== peerAddress) {
            const requested = ask.about?.["@type"] === AGENT_TALK_INTRODUCTION_REQUEST_TYPE ? ask.options : [];
            for (const option of requested ?? []) {
                const address = getContactAddress(option.value);
                if (address) agreed.add(address);
            }
            continue;
        }
        for (const answer of steps) {
            const isOwnYes =
                answer.type === AGENT_TALK_STEP_TYPE.ANSWER &&
                answer.re === ask.id &&
                answer.by.address !== peerAddress &&
                answer.result === AGENT_TALK_ANSWER_RESULT.ANSWERED;
            if (!isOwnYes) continue;
            for (const option of ask.options ?? []) {
                const address = answer.picks?.includes(option.id) ? getContactAddress(option.value) : null;
                if (address) agreed.add(address);
            }
        }
    }

    return agreed;
};

// who introduced the address to this side of one talk, by its introduction close, or null. the other side may close a talk
// it hosts with any outcome, so its close counts only for someone this side asked to meet or said yes to meeting; a close
// this side wrote is its own. the introduced side is never the introducer, and a booking's close, which names a time, is none
export const getAgentTalkIntroducedBy = (
    steps: readonly AgentTalkIntroductionStep[],
    peerAddress: string,
    address: string,
): string | null => {
    const comparable = address.trim().toLowerCase();
    const close = steps.find(
        (step) =>
            step.type === AGENT_TALK_STEP_TYPE.CLOSE &&
            step.by.address !== comparable &&
            !(step.outcome ?? []).some((value) => value.type === AGENT_TALK_VALUE_TYPE.TIME) &&
            (step.outcome ?? []).some((value) => getContactAddress(value) === comparable),
    );
    if (!close) return null;
    if (close.by.address !== peerAddress) return close.by.address;

    return getAgreedIntroductionAddresses(steps, peerAddress).has(comparable) ? close.by.address : null;
};
