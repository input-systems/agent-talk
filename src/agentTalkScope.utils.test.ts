import { describe, expect, it } from "vitest";
import { getIsAgentTalkScope } from "./agentTalkScope.utils.js";

describe("scopes", () => {
    it("accepts known, tool and private scopes only", () => {
        expect(["calendar.freeBusy", "mail.shared", "tool.notion.read", "x-acme-orders"].every(getIsAgentTalkScope)).toBe(true);
        expect(["freeBusy", "tool.linear", "tool..read", "x-", "x-\n# heading"].some(getIsAgentTalkScope)).toBe(false);
    });
});
