# Agent Talk test vectors

Language-neutral vectors for implementing Agent Talk. The reference implementation in `src/` generates them, and `vectors.test.ts` checks that it still produces and accepts exactly what they say.

## Files

| File                   | What it covers                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `keys.json`            | The Ed25519 keys behind every vector: public JWK sets per issuer, and the private keys                       |
| `canonical-json.json`  | JCS (RFC 8785) input and exact output                                                                        |
| `step-signatures.json` | Signing steps of every type (detached JWS over the step in JCS, without `seq` and `sig`), and verifying them |
| `presence-tokens.json` | Presence token checks (protocol 3)                                                                           |
| `talk-tokens.json`     | Talk token checks (protocol 8.2), from mail and from an answer link                                          |
| `service-tokens.json`  | A2A service token checks (protocol 9.3)                                                                      |
| `headers.json`         | Formatting and parsing `X-Agent-Talk` and `X-Agent-Talk-Link`                                                |
| `blocks.json`          | Formatting step blocks and reading them from email HTML (protocol 8.6)                                       |
| `agent-cards.json`     | Signing and verifying an A2A Agent Card                                                                      |

Each file has the same shape:

```json
{
    "description": "what the file covers and how to run its cases",
    "version": 1,
    "cases": [{ "name": "…", "description": "…", "…inputs": "…", "expected": "…" }]
}
```

Files that mix operations give each case a `kind` (`sign` / `verify`, `format` / `parse`, `format` / `read`). Times are ISO 8601 strings in UTC.

## Running them from another language

1. Load `keys.json`. A case's `receiverKeys` lists the keys the receiver already holds, as `{ iss, kid }` pairs. Your key resolver must answer only from those, and return nothing for any other pair. `rogue.example` is never held unless a case says so.
2. For each case, call your implementation with the case's inputs, with your clock set to the case's `now`.
3. Compare with `expected`:
    - A check returns `{ "isValid": true, "claims": … }` or `{ "isValid": false, "reason": "…" }`. The reason strings are the protocol's: `malformed`, `unknownKey`, `badSignature`, `wrongVersion`, `fromMismatch`, `postDated`, `tooLong`, `expired`, `wrongAudience`, and for blocks also `noBlock`, `invalidStep`, `tokenMismatch`, `authorMismatch`, `emailMismatch`, `badStepSignature`. Each file's `description` gives the order the checks run in: the first that fails is the reason.
    - Ed25519 is deterministic, so signatures, tokens, blocks and signed cards must match byte for byte. A token case with `signer` holds a genuine signature by that issuer's key, which you can reproduce.
    - Canonical JSON must match byte for byte. `{ "error": true }` means canonicalisation must fail.

Some cases describe the caller's job rather than the reader's: the reader does not tell quoted or forwarded content apart, so a quoted block is rejected only through its token's From, its step's Message-ID, or a step id the receiver already holds.

## Regenerating

```sh
pnpm vectors:generate
```

This runs `scripts/generate-vectors.ts` with fixed keys and a fixed clock, so unchanged code writes the same bytes. Regenerate only after a deliberate change to the protocol or the implementation, and review the diff.

## The keys are test-only

The private keys in `keys.json` and `scripts/generate-vectors.ts` are public. They exist so anyone can reproduce these signatures. Never use them, or the `.example` issuers, for anything else.
