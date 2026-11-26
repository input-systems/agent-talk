# Agent Talk

**An open protocol for people's agents to talk beside their email.**

Two people email each other. Each has an agent. Agent Talk lets those agents exchange signed, structured steps (an ask with options, an answer, a wait, a close) beside the email thread, so a meeting gets booked or a question gets answered without anyone copying times between windows. People still decide: only a person's yes commits a person, and an agent acts on its own only where its person allowed it.

- **Specification:** https://www.input.so/agent-talk ([`spec/agent-talk.md`](spec/agent-talk.md))
- **A2A extension:** https://www.input.so/agent-talk/v1 ([`spec/a2a-extension.md`](spec/a2a-extension.md))
- **JSON Schemas:** [`spec/schemas/`](spec/schemas/)
- **Test vectors:** [`spec/vectors/`](spec/vectors/)
- **Reference implementation:** this package, `@input/agent-talk`

## How it works

- **Email is the record.** Every step a person takes travels as an ordinary email the other side can read without any software from this protocol. The step itself rides along in the email's HTML as one signed JSON block, with a header and a link for people.
- **Agents can go direct.** When both people's services speak [A2A](https://a2a-protocol.org), the same steps also travel directly as A2A messages, under a profile extension.
- **Reading tells the sender nothing.** A receiver reads the step from the email it arrived in and fetches nothing because a message arrived. There is no way to ask whether an address has an agent.
- **Text is data.** Every string from the other side is untrusted. A step can trigger nothing except an answer to an open ask, and a turn limit stops two agents from running a talk without a person.

## Install

```sh
npm install @input/agent-talk
```

Node 22 or later, or any modern browser. No runtime dependencies: JSON and WebCrypto only.

## Usage

```ts
import { checkAgentTalkPresenceToken, readAgentTalkStepBlock, signAgentTalkStep, validateAgentTalkStep } from "@input/agent-talk";
import type { AgentTalkStep, AgentTalkValue } from "@input/agent-talk";
```

Two whole services on the package alone, talking to each other:

```ts
import { createAgentTalkReferenceParticipant } from "@input/agent-talk";

const north = await createAgentTalkReferenceParticipant({ issuer: "north.example", address: "sam@north.example" });
const south = await createAgentTalkReferenceParticipant({ issuer: "south.example", address: "maya@south.example" });
await south.recognise(north.issuer, [north.publicKey]);

const { email } = await north.sendAsk({ to: "maya@south.example", question: "Which evening?", options });
const ask = await south.accept({ htmlContent: email.htmlContent, from: "sam@north.example", messageId, isFromAuthenticated: true });
```

`createAgentTalkReferenceParticipant` is the example a new service follows: its own issuer and Ed25519 key, the email it sends with an ask or an answer, and one `accept` that takes a step only when the block counts, the mail was authenticated as its From, the issuer is one it recognised beforehand, and the step is for its person. It speaks A2A too (`getCard`, `createA2aRequest`, `receiveA2a`).

| Export                                                                                       | Purpose                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentTalk`, `AgentTalkStep`, `AgentTalkValue`, `AgentTalkThing`, …                          | The model: talks, the seven step types (`say`, `ask`, `answer`, `wait`, `hold`, `resume`, `close`), typed values, and `about`, one schema.org object that says what a message is |
| `validateAgentTalkStep` / `validateAgentTalkSignedStep` / `validateAgentTalkUnsignedStep`    | Shape and limit checks with paths, for a step as a host stores it, as its author signed it, and as its author built it                                                           |
| `getIsKnownAgentTalkStep` / `getIsKnownAgentTalkValue`                                       | Narrow to the types this version knows. Anything else is shown by its `text`                                                                                                     |
| `signAgentTalkStep` / `verifyAgentTalkStep`                                                  | Detached Ed25519 JWS over the canonical step (JCS), without the host's `seq`. Verifying fails closed and never throws                                                            |
| `createAgentTalkPresenceToken` / `checkAgentTalkPresenceToken`                               | "This address has an agent", signed by its service, bound to the From address, 90 days at most                                                                                   |
| `createAgentTalkToken` / `checkAgentTalkToken`                                               | The talk token: names a talk and step on an email; grants nothing on its own                                                                                                     |
| `formatAgentTalkHeader` / `parseAgentTalkHeader`                                             | The `X-Agent-Talk: v=1; p=…; t=…` header, kept within 870 characters                                                                                                             |
| `formatAgentTalkStepBlock` / `readAgentTalkStepBlock`                                        | The step in an email's HTML, as one `<script type="application/agent-talk+json">` element, and every check a receiver makes before it counts                                     |
| `formatAgentTalkLinkHeader` / `parseAgentTalkLinkHeader`                                     | `X-Agent-Talk-Link: <https://…>`, the talk behind a header link                                                                                                                  |
| `getAgentTalkAskMarkdown`                                                                    | The markdown view of an ask for agents that don't speak the protocol, with everything the asker wrote escaped                                                                    |
| `getIsAgentTalkAskOpenToAgents` / `getIsAgentTalkStepFresh` / `getAgentTalkAnswerResolution` | When agents stop answering, which direct steps are too old, and how an accepted answer takes effect (`auto`, `recheck`, `confirm`, `expired`)                                    |
| `getAgentTalkAttention`                                                                      | What a talk needs from the person looking at it, read from the steps alone so every surface agrees                                                                               |
| `getIsAgentTalkTurnLimitReached`                                                             | The turn limit: at most 10 says, asks and answers by an agent until its person acts                                                                                              |
| `getAgentTalkIntroducedBy`                                                                   | Who introduced an address to one side of a talk                                                                                                                                  |
| `createAgentTalkA2aMessage` / `readAgentTalkA2aMessage` / `getAgentTalkA2aTask` / …          | The A2A 1.0 binding: the step in a data part, task state, `GetTask`, header checks and the uniform refusal                                                                       |
| `createAgentTalkServiceToken` / `checkAgentTalkServiceToken`                                 | The EdDSA JWT one service calls another's A2A endpoint with                                                                                                                      |
| `createAgentTalkServiceCard` / `signAgentTalkAgentCard` / `verifyAgentTalkAgentCard`         | A service's signed Agent Card, and an open door's per-address card                                                                                                               |
| `parseAgentTalkDelegationTxt` / `parseAgentTalkDelegationFile`                               | A domain's `_agent-talk` TXT records and its `/.well-known/agent-talk.json`                                                                                                      |
| `AGENT_TALK_LIMIT`                                                                           | Every size and time limit of the protocol, by name                                                                                                                               |

### What the caller still checks

The package checks everything it can see in a step, a token or a block. These are the caller's:

- **Mail authentication.** That the message really came from its From address (an aligned DKIM or SPF pass in `Authentication-Results`, or your own send record), and that the token or block sat on the message itself, not in quoted history.
- **Keys.** Pass an `AgentTalkPublicKeyResolver` that answers from keys you already hold, and returns `null` for a service you don't recognise. Never fetch a service's keys because its mail arrived.
- **Membership and audience.** A talk token only names a talk; the host decides whether a service speaks for one of its parties. Act on an ask only for an address in its `to`.
- **Permissions.** What a person allowed another person's agent to do is your service's to know. The protocol only knows scopes.
- **Replay.** Remember step ids and service token `jti`s you have taken.

## Development

```sh
pnpm install
pnpm check            # type-check, lint, format check, build
pnpm test             # unit tests, schema checks, test vectors
pnpm vectors:generate # regenerate spec/vectors from the reference implementation
pnpm site:build       # build the specification site into site/dist
```

## License

Apache License 2.0. See [`LICENSE`](LICENSE). The specification, schemas and test vectors are under the same license.

Agent Talk is made by [Input](https://www.input.so).
