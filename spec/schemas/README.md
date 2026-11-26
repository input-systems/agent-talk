# Agent Talk JSON Schemas

JSON Schemas (draft 2020-12) for every Agent Talk wire object. The reference implementation in `src/` is the source of truth; `schemas.test.ts` checks that both accept the same valid objects and reject the same invalid ones.

Every schema's `$id` is `https://www.input.so/agent-talk/v1/schemas/<file>`, and they refer to each other by relative `$ref`, so load them all into one validator.

| File                                | Covers                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common.schema.json`                | Shared grammars: ids, option ids, type names, private `x-` names, addresses, times, scopes (as a receiver reads them, and as an author writes them), requestable scopes, issuer domains, compact JWS                                                                          |
| `value.schema.json`                 | A value: the nine types of section 4.4, private `x-` types and types a later version adds, each shown by its `text`                                                                                                                                                           |
| `step.schema.json`                  | A signed step as it travels: the envelope with `sig` and an optional `seq`, the seven step bodies by `type`, and private or unknown step types. `#/$defs/orderedStep` is a step with the host's `seq`; `$defs` also holds `option`, `field`, `receipt`, `about` and `granted` |
| `step-block.schema.json`            | The `{ v, token, step }` JSON inside an email's `<script type="application/agent-talk+json">`                                                                                                                                                                                 |
| `presence-token-claims.schema.json` | The presence token payload; `#/$defs/protectedHeader` is its header (`alg: EdDSA`, `kid`, `typ: agent-talk-presence`)                                                                                                                                                         |
| `talk-token-claims.schema.json`     | The talk token payload; header `typ: agent-talk-talk`                                                                                                                                                                                                                         |
| `service-token-claims.schema.json`  | The A2A service token payload; header `typ: JWT`                                                                                                                                                                                                                              |
| `delegation-file.schema.json`       | `/.well-known/agent-talk.json`                                                                                                                                                                                                                                                |

The step schema describes what a **receiver** accepts: any valid type name and any scope name, shown by `text` or treated as never granted. An author uses only the types and scopes this version defines, or private `x-` ones (`common.schema.json#/$defs/authorScope`). Unknown properties are allowed everywhere, because receivers ignore fields they do not know.

Times use `format: "date-time"` next to the code's pattern. Use a validator that asserts formats (ajv with `ajv-formats`), or impossible times like `2026-99-99T99:99:99Z` get through.

## Checks only code can do

- A step at most 256,000 characters as canonical JSON (RFC 8785), nested at most 64 levels deep.
- `about` at most 8,000 characters as canonical JSON.
- An ask's `expires` after `at` and within 30 days of it; `autoUntil` after `at`, within 24 hours of it, and not after `expires`.
- A time value's `end` after its `start`.
- Option ids unique within an ask.
- `sig` verifies: a detached compact JWS (header `{ alg: EdDSA, kid }`, no `typ`) over the step without `seq` and `sig`.
- Tokens: the signature against a key of `iss`; `sub` equal to the message's From; `iat` at most 5 minutes ahead of the receiver's clock; `exp` at most 90 days (presence), 30 days (talk) or 300 seconds (service) after `iat`; now before `exp`; a service token's `aud` equal to the endpoint and its `jti` not seen before.
- A block: at most 32,000 characters of JSON with `<`, `>` and `&` escaped; its token is this message's talk token; the step's `talk`, `id` and `by.address` match the token; `email`, when set, equals the message's Message-ID.

## Where the schemas and the code differ

- Lengths: JSON Schema counts characters, the code counts UTF-16 code units, so a string with emoji can pass a schema and break a limit in code.
- Addresses: the code requires an address to equal its own lowercase form; the schema rules out only `A-Z`, so `Émile@example.com` passes the schema.
- Times: both sides refuse a day that does not exist and a field out of range. The code also refuses a leap second (`23:59:60`), which `date-time` allows. A `date` value must be a real day on both sides.
- Token claims: the code checks only the types of the claims; the schemas also hold `iss`, `sub`, `talk` and `step` to their grammars.
- Delegation file: the code trims and lowercases `svc` and local parts; the schema wants them canonical.
