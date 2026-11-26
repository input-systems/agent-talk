import {
    AGENT_TALK_ANSWER_RESOLUTION,
    AGENT_TALK_ATTENTION_STATE,
    AGENT_TALK_HOLD_REASON,
    AGENT_TALK_STEP_TYPE,
} from "./agentTalk.constants.js";
import type { AgentTalkAddress, AgentTalkAskStep, AgentTalkAttentionState, AgentTalkStep, AgentTalkAttention } from "./agentTalk.types.js";
import { getAgentTalkAnswerResolution, getIsAgentTalkAskOpenToAgents } from "./agentTalkFreshness.utils.js";
import { getIsKnownAgentTalkStep } from "./agentTalkStep.utils.js";

// a step that shows its side went on after it said it was waiting on its person
const MOVED_ON_STEP_TYPES: readonly string[] = [
    AGENT_TALK_STEP_TYPE.SAY,
    AGENT_TALK_STEP_TYPE.ASK,
    AGENT_TALK_STEP_TYPE.ANSWER,
    AGENT_TALK_STEP_TYPE.RESUME,
];

// a step by the asker's side that responds to an answer waiting for their yes: they confirmed it, or countered it
const RESPONDING_STEP_TYPES: readonly string[] = [AGENT_TALK_STEP_TYPE.SAY, AGENT_TALK_STEP_TYPE.ASK];

// the most pressing state wins: something for the viewer, then something still moving, then something stuck on them
const STATE_PRIORITY: readonly AgentTalkAttentionState[] = [
    AGENT_TALK_ATTENTION_STATE.NEEDS_YOU,
    AGENT_TALK_ATTENTION_STATE.AGENTS_WORKING,
    AGENT_TALK_ATTENTION_STATE.WAITING_ON_THEM,
];

const getPersonState = (person: AgentTalkAddress, viewer: AgentTalkAddress): AgentTalkAttentionState =>
    person === viewer ? AGENT_TALK_ATTENTION_STATE.NEEDS_YOU : AGENT_TALK_ATTENTION_STATE.WAITING_ON_THEM;

const getIsAskOpen = (ask: Pick<AgentTalkAskStep, "id" | "expires">, laterSteps: readonly AgentTalkStep[], now: Date): boolean => {
    // written so that a time that does not parse closes the ask
    if (!(now.getTime() < Date.parse(ask.expires))) return false;

    return !laterSteps.some((later) => later.type === AGENT_TALK_STEP_TYPE.ASK && later.counters === true && later.re === ask.id);
};

// what a talk needs from the person looking at it, read from its steps alone (in the host's order), so every
// surface and every service says the same thing. nothing pending means done, closed or not
export const getAgentTalkAttention = (input: {
    steps: readonly AgentTalkStep[];
    parties: readonly AgentTalkAddress[];
    address: AgentTalkAddress;
    now: Date;
}): AgentTalkAttention => {
    const { steps, parties, address, now } = input;

    if (steps.some((step) => step.type === AGENT_TALK_STEP_TYPE.CLOSE)) return { state: AGENT_TALK_ATTENTION_STATE.DONE };

    const pending: AgentTalkAttention[] = [];

    steps.forEach((step, index) => {
        // a step of a type this version does not know changes nothing here
        if (!getIsKnownAgentTalkStep(step)) return;

        const laterSteps = steps.slice(index + 1);

        switch (step.type) {
            case AGENT_TALK_STEP_TYPE.ASK: {
                if (!getIsAskOpen(step, laterSteps, now)) return;

                const canAgentAnswer = getIsAgentTalkAskOpenToAgents(step, now);

                for (const addressee of step.to) {
                    const hasAnswered = laterSteps.some(
                        (later) => later.type === AGENT_TALK_STEP_TYPE.ANSWER && later.re === step.id && later.by.address === addressee,
                    );
                    if (hasAnswered) continue;

                    const isWaitingOnPerson =
                        !canAgentAnswer ||
                        laterSteps.some(
                            (later) => later.type === AGENT_TALK_STEP_TYPE.WAIT && later.re === step.id && later.by.address === addressee,
                        );

                    pending.push({
                        state: isWaitingOnPerson ? getPersonState(addressee, address) : AGENT_TALK_ATTENTION_STATE.AGENTS_WORKING,
                        due: step.due ?? step.expires,
                    });
                }
                return;
            }
            case AGENT_TALK_STEP_TYPE.WAIT: {
                // a wait on an ask that ran out or was replaced has nothing left to wait for
                const target = steps.find((candidate) => candidate.id === step.re);
                if (target?.type === AGENT_TALK_STEP_TYPE.ASK && !getIsAskOpen(target, steps.slice(steps.indexOf(target) + 1), now)) return;

                const hasMovedOn = laterSteps.some(
                    (later) => later.by.address === step.by.address && MOVED_ON_STEP_TYPES.includes(later.type),
                );
                if (!hasMovedOn) pending.push({ state: getPersonState(step.by.address, address) });
                return;
            }
            case AGENT_TALK_STEP_TYPE.HOLD: {
                const getHasResumed = (person: AgentTalkAddress) =>
                    laterSteps.some((later) => later.type === AGENT_TALK_STEP_TYPE.RESUME && later.by.address === person);

                // a person took over: it is theirs until they hand it back
                if (step.reason === AGENT_TALK_HOLD_REASON.PERSON) {
                    if (!getHasResumed(step.by.address)) pending.push({ state: getPersonState(step.by.address, address) });
                    return;
                }

                // a new address joined the thread: every party has to say yes again
                const waitingParties = parties.filter((party) => !getHasResumed(party));
                if (waitingParties.length === 0) return;

                pending.push({
                    state: waitingParties.includes(address)
                        ? AGENT_TALK_ATTENTION_STATE.NEEDS_YOU
                        : AGENT_TALK_ATTENTION_STATE.WAITING_ON_THEM,
                });
                return;
            }
            case AGENT_TALK_STEP_TYPE.ANSWER: {
                // an answer the person did not sign with a service of their own, a web card pick or a reply read in words, waits
                // for the asker's yes until their side responds to it
                const ask = steps.find((candidate) => candidate.id === step.re);
                if (ask?.type !== AGENT_TALK_STEP_TYPE.ASK) return;
                if (getAgentTalkAnswerResolution(ask, step, new Date(step.at)) !== AGENT_TALK_ANSWER_RESOLUTION.CONFIRM) return;

                const hasResponded = laterSteps.some(
                    (later) => later.by.address === ask.by.address && RESPONDING_STEP_TYPES.includes(later.type),
                );
                if (!hasResponded) pending.push({ state: getPersonState(ask.by.address, address) });
                return;
            }
            case AGENT_TALK_STEP_TYPE.SAY:
            case AGENT_TALK_STEP_TYPE.RESUME:
            case AGENT_TALK_STEP_TYPE.CLOSE:
                return;
            default: {
                const unhandled: never = step;
                return unhandled;
            }
        }
    });

    for (const state of STATE_PRIORITY) {
        const matches = pending.filter((item) => item.state === state);
        if (matches.length === 0) continue;

        const [due] = matches
            .flatMap((item) => (item.due ? [item.due] : []))
            .sort((first, second) => Date.parse(first) - Date.parse(second));
        return due ? { state, due } : { state };
    }

    return { state: AGENT_TALK_ATTENTION_STATE.DONE };
};
