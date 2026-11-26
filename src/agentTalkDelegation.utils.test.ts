import { describe, expect, it } from "vitest";
import { getIsAgentTalkDelegatedAddress, parseAgentTalkDelegationFile, parseAgentTalkDelegationTxt } from "./agentTalkDelegation.utils.js";

describe("parseAgentTalkDelegationTxt", () => {
    it("reads the service, the account and the local parts", () => {
        expect(parseAgentTalkDelegationTxt("v=1; svc=intercom.com")).toEqual({ svc: "intercom.com" });
        expect(parseAgentTalkDelegationTxt("v=1; svc=input.so; acct=acc_7Hq2")).toEqual({ svc: "input.so", acct: "acc_7Hq2" });
        expect(parseAgentTalkDelegationTxt("v=1; svc=Resend.com; local=news, Billing")).toEqual({
            svc: "resend.com",
            local: ["news", "billing"],
        });
    });

    it("counts nothing that is not exactly a record", () => {
        expect(parseAgentTalkDelegationTxt("svc=intercom.com; v=1")).toBeNull();
        expect(parseAgentTalkDelegationTxt("v=2; svc=intercom.com")).toBeNull();
        expect(parseAgentTalkDelegationTxt("v=1")).toBeNull();
        expect(parseAgentTalkDelegationTxt("v=1; svc=intercom.com; svc=evil.com")).toBeNull();
        expect(parseAgentTalkDelegationTxt("v=1; svc=intercom.com; extra=1")).toBeNull();
        expect(parseAgentTalkDelegationTxt("v=1; svc=localhost")).toBeNull();
        expect(parseAgentTalkDelegationTxt("v=1; svc=intercom.com; local=")).toBeNull();
    });
});

describe("parseAgentTalkDelegationFile", () => {
    it("reads every entry, or none when one is malformed", () => {
        expect(parseAgentTalkDelegationFile({ v: 1, services: [{ svc: "intercom.com" }, { svc: "resend.com", local: ["news"] }] })).toEqual(
            [{ svc: "intercom.com" }, { svc: "resend.com", local: ["news"] }],
        );
        expect(parseAgentTalkDelegationFile({ v: 1, services: [{ svc: "intercom.com" }, { svc: 3 }] })).toBeNull();
        expect(parseAgentTalkDelegationFile({ v: 2, services: [] })).toBeNull();
    });
});

describe("getIsAgentTalkDelegatedAddress", () => {
    it("matches the service, the account exactly and the local part", () => {
        expect(getIsAgentTalkDelegatedAddress({ svc: "intercom.com" }, { svc: "intercom.com", address: "help@acme.com" })).toBe(true);
        expect(getIsAgentTalkDelegatedAddress({ svc: "input.so", acct: "a" }, { svc: "input.so", address: "help@acme.com" })).toBe(false);
        expect(getIsAgentTalkDelegatedAddress({ svc: "input.so" }, { svc: "input.so", acct: "a", address: "help@acme.com" })).toBe(false);
        expect(
            getIsAgentTalkDelegatedAddress({ svc: "resend.com", local: ["news"] }, { svc: "resend.com", address: "billing@acme.com" }),
        ).toBe(false);
    });
});
