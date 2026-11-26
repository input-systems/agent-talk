import { AGENT_TALK_PRIVATE_TYPE_PATTERN, AGENT_TALK_SCOPE } from "./agentTalk.constants.js";
import type { AgentTalkScope } from "./agentTalk.types.js";

// tool.<name>.read or tool.<name>.write; the name is the tool's lowercase identifier ("linear", "google-drive")
const TOOL_SCOPE_PATTERN = /^tool\.([a-z0-9][a-z0-9-]{0,62})\.(read|write)$/;

const KNOWN_SCOPES: readonly string[] = Object.values(AGENT_TALK_SCOPE);

export const getIsAgentTalkScope = (value: string): value is AgentTalkScope =>
    KNOWN_SCOPES.includes(value) || TOOL_SCOPE_PATTERN.test(value) || AGENT_TALK_PRIVATE_TYPE_PATTERN.test(value);
