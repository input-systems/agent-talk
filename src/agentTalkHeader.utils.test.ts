import { describe, expect, it } from "vitest";
import {
    formatAgentTalkHeader,
    formatAgentTalkLinkHeader,
    parseAgentTalkHeader,
    parseAgentTalkLinkHeader,
} from "./agentTalkHeader.utils.js";

describe("agent talk header", () => {
    it("round-trips both tokens and survives folding", () => {
        const header = formatAgentTalkHeader({ presence: "a.b.c", talk: "d.e.f" });

        expect(header).toBe("v=1; p=a.b.c; t=d.e.f");
        expect(parseAgentTalkHeader("v=1;\r\n p=a.b.c; t=d.e.f; future=1")).toEqual({ v: 1, presence: "a.b.c", talk: "d.e.f" });
    });

    it("drops tokens that are not compact jws and refuses a missing version", () => {
        expect(parseAgentTalkHeader("v=1; p=<script>")).toEqual({ v: 1 });
        expect(parseAgentTalkHeader("p=a.b.c")).toBeNull();
    });

    it("leaves the talk token out when the value would pass what sending services take", () => {
        const presence = `${"a".repeat(400)}.b.c`;
        const talk = `${"d".repeat(460)}.e.f`;

        expect(formatAgentTalkHeader({ presence, talk: "d.e.f" })).toBe(`v=1; p=${presence}; t=d.e.f`);
        expect(formatAgentTalkHeader({ presence, talk })).toBe(`v=1; p=${presence}`);
    });
});

describe("agent talk link header", () => {
    it("round-trips an https url and ignores anything else", () => {
        const url = "https://input.so/t/abc.def.ghi";

        expect(parseAgentTalkLinkHeader(formatAgentTalkLinkHeader(url))).toBe(url);
        expect(parseAgentTalkLinkHeader(` <${url}>\r\n`)).toBe(url);
        expect(parseAgentTalkLinkHeader("<http://input.so/t/abc>")).toBeNull();
        expect(parseAgentTalkLinkHeader("https://input.so/t/abc")).toBeNull();
    });
});
