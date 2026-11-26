import { describe, expect, it } from "vitest";
import { getCanonicalJson } from "./agentTalkJson.utils.js";

describe("getCanonicalJson", () => {
    it("sorts keys, drops undefined and keeps arrays in order", () => {
        expect(getCanonicalJson({ b: 1, a: [3, { d: true, c: null }], e: undefined })).toBe('{"a":[3,{"c":null,"d":true}],"b":1}');
    });

    it("rejects numbers json cannot hold", () => {
        expect(() => getCanonicalJson({ a: Number.NaN })).toThrow();
    });

    it("rejects json nested deeper than any step is, instead of running out of stack", () => {
        const nested: unknown = JSON.parse(`${"[".repeat(15_000)}${"]".repeat(15_000)}`);

        expect(() => getCanonicalJson({ a: nested })).toThrow(TypeError);
    });
});
