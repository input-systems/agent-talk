import { describe, expect, it } from "vitest";
import { createKeys, ISSUER } from "./agentTalk.fixtures.js";
import type { AgentTalkSigningKey } from "./agentTalk.types.js";
import { signJws } from "./agentTalkJws.utils.js";
import {
    checkAgentTalkPresenceToken,
    checkAgentTalkLinkToken,
    checkAgentTalkToken,
    createAgentTalkPresenceToken,
    createAgentTalkToken,
} from "./agentTalkToken.utils.js";

const NOW = new Date("2026-11-20T10:00:00.000Z");
const NOW_SECONDS = NOW.getTime() / 1000;
const DAY_SECONDS = 24 * 60 * 60;

const createMayaToken = async (key: AgentTalkSigningKey, now: Date = NOW) =>
    await createAgentTalkPresenceToken({ issuer: ISSUER, address: "maya@example.com", accepts: ["ask"], types: ["text"], now, key });

describe("presence token", () => {
    it("checks out for the address it names", async () => {
        const { key, getPublicKey } = await createKeys();
        const token = await createAgentTalkPresenceToken({
            issuer: ISSUER,
            address: "Maya@Example.com",
            accepts: ["ask", "say"],
            types: ["time", "text"],
            now: NOW,
            key,
        });

        const result = await checkAgentTalkPresenceToken({ token, from: "maya@example.com", now: NOW, getPublicKey });

        expect(result.isValid).toBe(true);
        if (result.isValid) expect(result.claims.sub).toBe("maya@example.com");
    });

    it("carries an open door only when asked to", async () => {
        const { key, getPublicKey } = await createKeys();
        const base = { issuer: ISSUER, accepts: ["ask" as const], types: ["text" as const], now: NOW, key };
        const support = await createAgentTalkPresenceToken({ ...base, address: "support@example.com", isOpen: true });
        const person = await createAgentTalkPresenceToken({ ...base, address: "maya@example.com" });

        const supportCheck = await checkAgentTalkPresenceToken({ token: support, from: "support@example.com", now: NOW, getPublicKey });
        const personCheck = await checkAgentTalkPresenceToken({ token: person, from: "maya@example.com", now: NOW, getPublicKey });

        expect(supportCheck.isValid && supportCheck.claims.isOpen).toBe(true);
        expect(personCheck.isValid && personCheck.claims.isOpen).toBeUndefined();
    });

    it("is refused on mail from another address", async () => {
        const { key, getPublicKey } = await createKeys();
        const token = await createMayaToken(key);

        expect(await checkAgentTalkPresenceToken({ token, from: "eve@example.com", now: NOW, getPublicKey })).toEqual({
            isValid: false,
            reason: "fromMismatch",
        });
    });

    it("is refused once expired", async () => {
        const { key, getPublicKey } = await createKeys();
        const token = await createMayaToken(key);
        const later = new Date(NOW.getTime() + 91 * DAY_SECONDS * 1000);

        expect(await checkAgentTalkPresenceToken({ token, from: "maya@example.com", now: later, getPublicKey })).toEqual({
            isValid: false,
            reason: "expired",
        });
    });

    it("is refused when it claims to live longer than ninety days", async () => {
        const { key, getPublicKey } = await createKeys();
        const claims = {
            v: 1,
            iss: ISSUER,
            sub: "maya@example.com",
            acc: [],
            types: [],
            iat: NOW_SECONDS,
            exp: NOW_SECONDS + 91 * DAY_SECONDS,
        };
        const token = await signJws(claims, { alg: "EdDSA", kid: key.kid, typ: "agent-talk-presence" }, key.privateKey);

        expect(await checkAgentTalkPresenceToken({ token, from: "maya@example.com", now: NOW, getPublicKey })).toEqual({
            isValid: false,
            reason: "tooLong",
        });
    });

    it("is refused when it is dated ahead of now, so its cap cannot be stretched", async () => {
        const { key, getPublicKey } = await createKeys();
        const nextYear = new Date("2027-11-20T10:00:00.000Z");
        const token = await createMayaToken(key, nextYear);

        expect(await checkAgentTalkPresenceToken({ token, from: "maya@example.com", now: NOW, getPublicKey })).toEqual({
            isValid: false,
            reason: "postDated",
        });
        expect(await checkAgentTalkPresenceToken({ token, from: "maya@example.com", now: nextYear, getPublicKey })).toMatchObject({
            isValid: true,
        });
    });

    it("is refused when signed by an unknown key or tampered with", async () => {
        const { key, getPublicKey } = await createKeys();
        const other = await createKeys();
        const token = await createMayaToken(key);

        expect(await checkAgentTalkPresenceToken({ token, from: "maya@example.com", now: NOW, getPublicKey: other.getPublicKey })).toEqual({
            isValid: false,
            reason: "badSignature",
        });

        const [header, , signature] = token.split(".");
        const forgedPayload = Buffer.from(
            JSON.stringify({ v: 1, iss: ISSUER, sub: "eve@example.com", acc: [], types: [], iat: 1, exp: 2 }),
        ).toString("base64url");
        expect(
            await checkAgentTalkPresenceToken({
                token: `${header}.${forgedPayload}.${signature}`,
                from: "eve@example.com",
                now: NOW,
                getPublicKey,
            }),
        ).toEqual({
            isValid: false,
            reason: "badSignature",
        });
    });

    it("is not accepted as a talk token", async () => {
        const { key, getPublicKey } = await createKeys();
        const token = await createMayaToken(key);

        expect(await checkAgentTalkToken({ token, from: "maya@example.com", now: NOW, getPublicKey })).toEqual({
            isValid: false,
            reason: "malformed",
        });
    });
});

describe("talk token", () => {
    const createToken = async (key: AgentTalkSigningKey, expiresAt: Date) =>
        await createAgentTalkToken({
            issuer: ISSUER,
            talkId: "tk_1",
            stepId: "st_1",
            address: "krijn@example.com",
            expiresAt,
            now: NOW,
            key,
        });

    it("names the talk and step for its sender", async () => {
        const { key, getPublicKey } = await createKeys();
        const token = await createToken(key, new Date("2026-11-27T10:00:00.000Z"));

        const result = await checkAgentTalkToken({ token, from: "krijn@example.com", now: NOW, getPublicKey });

        expect(result.isValid && result.claims.talk).toBe("tk_1");
    });

    it("dies with its ask, so a stale email is only an email again", async () => {
        const { key, getPublicKey } = await createKeys();
        const token = await createToken(key, new Date("2026-11-27T10:00:00.000Z"));

        expect(
            await checkAgentTalkToken({ token, from: "krijn@example.com", now: new Date("2026-11-27T10:00:00.000Z"), getPublicKey }),
        ).toEqual({
            isValid: false,
            reason: "expired",
        });
    });

    it("checks out from a link, which names no sender, and still dies with its ask", async () => {
        const { key, getPublicKey } = await createKeys();
        const token = await createToken(key, new Date("2026-11-27T10:00:00.000Z"));

        const fromLink = await checkAgentTalkLinkToken({ token, now: NOW, getPublicKey });
        expect(fromLink.isValid && fromLink.claims).toMatchObject({ talk: "tk_1", step: "st_1", sub: "krijn@example.com" });
        expect(await checkAgentTalkLinkToken({ token, now: new Date("2026-11-27T10:00:00.000Z"), getPublicKey })).toEqual({
            isValid: false,
            reason: "expired",
        });
    });

    it("is refused when it claims to outlive the longest ask", async () => {
        const { key, getPublicKey } = await createKeys();
        const token = await createToken(key, new Date("2027-01-20T10:00:00.000Z"));

        expect(await checkAgentTalkToken({ token, from: "krijn@example.com", now: NOW, getPublicKey })).toEqual({
            isValid: false,
            reason: "tooLong",
        });
    });
});
