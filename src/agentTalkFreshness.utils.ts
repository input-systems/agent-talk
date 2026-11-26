import {
    AGENT_TALK_LIMIT,
    AGENT_TALK_ANSWER_RESOLUTION,
    AGENT_TALK_ASK_ANSWER_BY,
    MINUTE_MS,
    AGENT_TALK_STEP_VIA,
} from "./agentTalk.constants.js";
import type { AgentTalkAnswerResolution, AgentTalkAskStep, AgentTalkStepEnvelope } from "./agentTalk.types.js";

type TimedAsk = Pick<AgentTalkAskStep, "at" | "answerBy" | "autoUntil" | "expires">;

// every comparison here is written so that a time that does not parse closes the window instead of holding it open

// the moment after which no agent may answer on its own; without autoUntil, an hour after the ask
export const getAgentTalkAskAutoUntil = (ask: Pick<AgentTalkAskStep, "at" | "autoUntil">): Date =>
    new Date(ask.autoUntil ? Date.parse(ask.autoUntil) : Date.parse(ask.at) + AGENT_TALK_LIMIT.ASK_AUTO_DEFAULT_MINUTES * MINUTE_MS);

// whether an agent may still answer this ask for its person; allowances are the caller's check.
// past autoUntil a person decides, or the asking agent re-checks and asks again
export const getIsAgentTalkAskOpenToAgents = (ask: TimedAsk, now: Date): boolean =>
    ask.answerBy === AGENT_TALK_ASK_ANSWER_BY.PERSON_OR_AGENT &&
    now < getAgentTalkAskAutoUntil(ask) &&
    now.getTime() < Date.parse(ask.expires);

// a step delivered service to service must be minutes old at most, so a captured one cannot be replayed later;
// the host also refuses a step id it has already seen. steps that ride on email skip this: mail can be slow
export const getIsAgentTalkStepFresh = (step: Pick<AgentTalkStepEnvelope, "at">, now: Date): boolean =>
    Math.abs(now.getTime() - Date.parse(step.at)) <= AGENT_TALK_LIMIT.DIRECT_STEP_MAX_AGE_MINUTES * MINUTE_MS;

// how an accepted answer may take effect on the asker's side. judged on the host's clock when it accepts the
// answer, never on the answer's own `at`, which its author sets
export const getAgentTalkAnswerResolution = (
    ask: TimedAsk,
    answer: Pick<AgentTalkStepEnvelope, "via">,
    acceptedAt: Date,
): AgentTalkAnswerResolution => {
    if (!(acceptedAt.getTime() < Date.parse(ask.expires))) return AGENT_TALK_ANSWER_RESOLUTION.EXPIRED;

    // a web card pick or a plain reply carries no service signature, so the asker confirms it
    if (answer.via === AGENT_TALK_STEP_VIA.LINK || answer.via === AGENT_TALK_STEP_VIA.EMAIL) return AGENT_TALK_ANSWER_RESOLUTION.CONFIRM;

    // a late answer is still good, but the asker's agent re-checks its own data before anything happens
    return acceptedAt < getAgentTalkAskAutoUntil(ask) ? AGENT_TALK_ANSWER_RESOLUTION.AUTO : AGENT_TALK_ANSWER_RESOLUTION.RECHECK;
};
