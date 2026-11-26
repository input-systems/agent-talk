# Changelog

## Unreleased

Agent Talk no longer binds to A2A. Between services:

- A service publishes a signed **service document** at `/.well-known/agent-talk-service.json`: its issuer, name, provider, key set URL, the **carriers** it takes direct steps on, and a template for its open doors' **door documents**, which add the door's id, address and what it handles. It is signed as an EdDSA JWS with `typ: "agent-talk-service"` over the document in JCS without `signatures`, and verifies only for the issuer it names. Readers ignore carrier types they do not know; a service with no carrier speaks by email alone.
- The one carrier defined is `https`: one POST per step with `{ v, step, door? }` and the service token, answered `202` when taken, the uniform refusal `403 not_accepted` for every step not taken, and `400` (`bad_request`, `unsupported_version`) for a body that is not one. Admission, freshness, the turn limit, retries and the fallback to email are unchanged.
- Removed: the A2A extension page and its URI, the A2A extension proposal, the Agent Card well-known path, task ids, `GetTask`, JSON-RPC and the A2A headers. Section 9.7 says what Agent Talk keeps from A2A.
- Schemas: added `service-document.schema.json` and `direct-body.schema.json`. Vectors: `agent-cards.json` replaced by `service-documents.json` and `direct-bodies.json`; `service-tokens.json` uses a carrier URL as its audience.
- Reference implementation synced: `agentTalkServiceDocument.utils.ts` and `agentTalkDirect.utils.ts` replace the A2A and Agent Card helpers.

A step is now at most 64,000 bytes as canonical JSON in UTF-8, down from 256,000 characters, so every valid step fits a direct body's 64 KiB.

Agents that read a link: the markdown view now gives an answer URL and a filled-in request, and an answer through the link declares `actor`. An answer marked `agent` is refused unless the ask is open to agents; every link answer still waits for the asker's confirmation (section 10).

## 1.0.0-draft.1

First public draft of the protocol, the A2A extension, the JSON Schemas, the test vectors and the TypeScript reference implementation.
