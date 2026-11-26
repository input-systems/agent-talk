import { AGENT_TALK_LIMIT, AGENT_TALK_STEP_ACTOR, AGENT_TALK_STEP_TYPE } from "./agentTalk.constants.js";
import type { AgentTalkStepEnvelope } from "./agentTalk.types.js";

type TurnStep = Pick<AgentTalkStepEnvelope, "by"> & { type: string };

// the steps an agent's turn counts (rule 9): what it says, asks and answers. wait, hold, resume and close never count
const TURN_STEP_TYPES: ReadonlySet<string> = new Set([AGENT_TALK_STEP_TYPE.SAY, AGENT_TALK_STEP_TYPE.ASK, AGENT_TALK_STEP_TYPE.ANSWER]);

// whether this step would take an agent past its turn (rule 9): no more than 10 says, asks and answers since its person last
// acted in the talk. a person's own step, or a step that does not count, never reaches it
export const getIsAgentTalkTurnLimitReached = (step: TurnStep, steps: readonly TurnStep[]): boolean => {
    if (step.by.actor !== AGENT_TALK_STEP_ACTOR.AGENT || !TURN_STEP_TYPES.has(step.type)) return false;

    let count = 0;
    for (const held of steps.toReversed()) {
        if (held.by.address !== step.by.address) continue;
        if (held.by.actor === AGENT_TALK_STEP_ACTOR.PERSON) break;
        if (TURN_STEP_TYPES.has(held.type)) count++;
    }

    return count >= AGENT_TALK_LIMIT.AGENT_STEPS_PER_TURN;
};
