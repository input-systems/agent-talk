import { describe, expect, it } from "vitest";
import type { AgentTalkPublicKeyResolver } from "./agentTalk.types.js";
import { generateAgentTalkSigningKeyPair } from "./agentTalkJws.utils.js";
import {
    AGENT_TALK_SERVICE_TOKEN_REJECT_REASON,
    checkAgentTalkServiceToken,
    createAgentTalkServiceToken,
} from "./agentTalkServiceToken.utils.js";

const NOW = new Date("2026-11-25T12:00:00Z");
const AUDIENCE = "https://api.input.so/agent-talk-service/steps";

describe("service token", () => {
    it("checks the key, the audience and the lifetime", async () => {
        const pair = await generateAgentTalkSigningKeyPair();
        const key = { kid: "k1", privateKey: pair.privateKey };
        const getPublicKey: AgentTalkPublicKeyResolver = async (issuer, kid) =>
            await Promise.resolve(issuer === "peer.test" && kid === "k1" ? pair.publicKey : null);
        const token = await createAgentTalkServiceToken({ issuer: "peer.test", audience: AUDIENCE, now: NOW, key, jti: "j1" });

        const check = await checkAgentTalkServiceToken({ token, audience: AUDIENCE, now: NOW, getPublicKey });
        expect(check.isValid && check.kid).toBe("k1");
        expect(check.isValid && check.claims).toMatchObject({ iss: "peer.test", aud: AUDIENCE, jti: "j1" });

        await expect(
            checkAgentTalkServiceToken({ token, audience: "https://other.test/agent-talk/steps", now: NOW, getPublicKey }),
        ).resolves.toEqual({
            isValid: false,
            reason: AGENT_TALK_SERVICE_TOKEN_REJECT_REASON.WRONG_AUDIENCE,
        });
        await expect(
            checkAgentTalkServiceToken({ token, audience: AUDIENCE, now: new Date(NOW.getTime() + 6 * 60 * 1000), getPublicKey }),
        ).resolves.toEqual({ isValid: false, reason: AGENT_TALK_SERVICE_TOKEN_REJECT_REASON.EXPIRED });
        await expect(
            checkAgentTalkServiceToken({ token, audience: AUDIENCE, now: NOW, getPublicKey: async () => await Promise.resolve(null) }),
        ).resolves.toEqual({ isValid: false, reason: AGENT_TALK_SERVICE_TOKEN_REJECT_REASON.UNKNOWN_KEY });
        await expect(checkAgentTalkServiceToken({ token: `${token}x`, audience: AUDIENCE, now: NOW, getPublicKey })).resolves.toMatchObject(
            {
                isValid: false,
            },
        );
    });
});
