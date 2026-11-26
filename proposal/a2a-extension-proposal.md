# Proposal: Agent Talk, an A2A profile extension for people's agents that meet over email

Status: ready to submit at launch. Target: the A2A project's extension listing (a pull request or discussion in the A2A repository, as its contribution guide asks at the time).

- **Extension URI:** `https://www.input.so/agent-talk/v1`
- **Specification:** https://www.input.so/agent-talk/v1 (the extension) and https://www.input.so/agent-talk (the protocol it binds)
- **Kind:** profile extension, with data in the Agent Card
- **Reference implementation:** `@input/agent-talk` (TypeScript, Apache-2.0, zero runtime dependencies), https://github.com/input-systems/agent-talk
- **Maintainer:** Input (https://www.input.so)

## Summary

A2A connects agents that already know each other's endpoints. Most agents that should talk to each other have never met: two people's assistants, or a person's assistant and a company's support desk. What those people do share is an email thread.

Agent Talk is a small protocol for that case. Two people's agents exchange signed, structured steps (an ask with options, an answer, a wait, a close) beside the email thread. Every step a person takes still travels as an email the other side can read without any new software, with the step embedded in it. When both sides' services speak A2A, the same steps also travel directly as A2A messages, under this extension.

The extension adds nothing to A2A's methods or task states. It fixes what a message carries (one signed step, whole, in a data part), what a task id means (the ask's step id), and how a service authenticates (an EdDSA JWT signed with the key it already publishes), and it requires one uniform refusal so the direct door cannot be used to learn who has an agent.

## Why a profile extension

- **The signed step must be the unit of truth.** The same step can arrive by email and by A2A. Receivers deduplicate by step id and verify the step's own signature, whichever way it came. That only works if the step travels whole and unchanged, so the extension pins it to one data part with its own media type, `application/agent-talk+json`.
- **Tasks map cleanly.** An ask is a task, its id is the ask's id, and the task state is the receiver's view of the last step on the ask. Counters, waits, answers and withdrawals map to existing task states. No new states are needed.
- **No new methods.** `SendMessage` carries every step, and `GetTask` reads an ask's task. `CancelTask` is not used because a withdrawal has to be a signed step.

## What it constrains

| A2A element     | Constraint                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent Card      | the extension is `required: true`; `params.keys` (JWK Set URL) and `params.addressCard` (URI template); signed per 1.0 §8.4 with EdDSA; no skills on a service card                                 |
| Request headers | `A2A-Version: 1.0` and `A2A-Extensions` naming the URI, checked before anything else (`-32009`, `-32008`)                                                                                           |
| Authentication  | `httpAuthSecurityScheme` Bearer JWT: EdDSA, `aud` is the endpoint, at most 5 minutes, `jti` taken once                                                                                              |
| Message         | `messageId` = step id, `contextId` = talk id, `ROLE_USER`; exactly one `application/agent-talk+json` data part with the signed step; a text part with its words; metadata holds nothing that counts |
| Task            | `id` = the ask's step id; state read from the last step on the ask; an answer is the artifact                                                                                                       |
| Errors          | every refused step gets `-32004` "Not accepted", whatever the reason                                                                                                                                |

## Safety properties

These are the parts we think are worth a reviewer's attention, because they shape the extension:

- **People decide.** Only a person's yes commits a person. An agent answers on its own only within narrow, named scopes its person allowed, and introductions and requests for standing permission are always the person's.
- **No fetch on arrival.** A receiver never fetches a card, a key set or a link because a message arrived. A sender could make each of those unique per recipient and learn who reads its mail, and when. Cards and keys are refreshed only for services the receiver already recognises, on its own schedule.
- **No enumeration.** There is no lookup. Every refused step gets the same response, and every address without an open door gets the same response from the per-address card URL.
- **Agents inform, never instruct.** Every string from the other side is data. A step can trigger nothing except an answer to an open ask, and a turn limit stops two agents from running a talk without a person.

## Interoperability results

Measured on the reference implementation and on Input's production service code, on 26 November 2026:

- **Two independent participants.** The package's reference participant is a whole second service on the package alone (its own issuer, key and email). Interop tests run Input's service against it over email and over A2A: 19 cases, covering asks and answers in both directions, the email fallback when the participant is down (the step arrives by email with the same id and is taken once), a first ask to an open door found through a DNS delegation, a first ask under a standing permission, refusal without one (byte-identical to an unknown address), replayed tokens and stale steps.
- **The official SDK.** With `@a2a-js/sdk` 1.3: Agent Cards, messages, tasks and send results round-trip through the SDK's 1.0 JSON types; the SDK client gets `ExtensionSupportRequiredError` without the header; it sends a step with a service token and reads the task back.
- **One gap found in the SDK.** `@a2a-js/sdk` 1.3 drops empty fields (such as an empty `skills`) before canonicalising, and loses `securitySchemes` when canonicalising a card it parsed. Its verifier therefore cannot check a card signed per 1.0 §8.4.1. We follow the specification and pin the difference in a test; we would be glad to send a fix upstream.
- **Test vectors.** Language-neutral vectors for canonical JSON, step signatures, presence, talk and service tokens, headers, email blocks and signed cards are published with the specification, so a second implementation can check itself without our code.

Email-side interop (the header, the block and the link through Gmail, Outlook, iCloud and a security gateway) is tracked separately in the protocol and does not affect this extension.

## Open questions for the A2A community

1. Should a counter-proposal move the original task to `TASK_STATE_INPUT_REQUIRED`? Today a counter is a new ask (a new task) that references the one it replaces, and the original task's state does not change.
2. Is there interest in a shared convention for a **uniform refusal** in A2A generally? Any extension that admits callers by private policy (allowlists, per-person permissions) has the same enumeration problem.
3. Is there a preferred place to register the media type `application/agent-talk+json` alongside the extension, or should it move to the vendor tree?

## Submission checklist

- [ ] The specification pages are live at the extension URI and at https://www.input.so/agent-talk, indexed.
- [ ] The repository is public with the reference implementation, schemas and vectors.
- [ ] `@input/agent-talk` is published to npm.
- [ ] Interop numbers above re-run on the release commit and updated.
- [ ] Submit following the A2A repository's contribution guide for extensions at the time; link this proposal.
