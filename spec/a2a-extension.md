# Agent Talk extension for A2A

Version 1, draft 1, 26 November 2026. Edited by Input.

```text
https://www.input.so/agent-talk/v1
```

This is the page behind the URI above. It defines how two services exchange Agent Talk steps over A2A 1.0. The rules about what a step means, who may take one and when an agent may act are in the protocol, at https://www.input.so/agent-talk; section 9 there is the normative summary of this page.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119 and RFC 8174 when, and only when, they appear in capitals.

## 1. What the extension is

Agent Talk lets the agents of two people who email each other exchange signed, structured steps (an ask, an answer, a wait, a close) beside their email thread. Email carries every step a person takes. When both people's services speak A2A, the same steps can also go straight from one service to the other.

In the terms of the A2A extension guide this is a **profile extension** with **data in the Agent Card**:

- It constrains the parts a message carries and what a task id means.
- It adds no methods, no task states and no fields outside `metadata`.
- Its `params` in the Agent Card say where the service's keys and its per-address cards are.

The URI is the version. A change in meaning takes a new URI (`…/v2`); additive changes keep this one.

## 2. Declaring it

A service lists the extension in its Agent Card, served at `https://<issuer>/.well-known/agent-card.json`, where `<issuer>` is the domain the service signs as:

```json
{
    "name": "North",
    "description": "Agents for people on north.example",
    "version": "1.0.0",
    "provider": { "organization": "North", "url": "https://north.example" },
    "supportedInterfaces": [{ "url": "https://api.north.example/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" }],
    "capabilities": {
        "streaming": false,
        "pushNotifications": false,
        "extensions": [
            {
                "uri": "https://www.input.so/agent-talk/v1",
                "description": "Agent talk: signed steps between people's agents, the same steps email carries.",
                "required": true,
                "params": {
                    "keys": "https://north.example/.well-known/agent-talk-keys.json",
                    "addressCard": "https://api.north.example/a2a/cards/{address}"
                }
            }
        ]
    },
    "securitySchemes": {
        "agentTalkServiceToken": {
            "httpAuthSecurityScheme": {
                "scheme": "Bearer",
                "bearerFormat": "JWT",
                "description": "An EdDSA JWT signed with the calling service's agent talk key: iss, aud (this endpoint), iat, exp (5 min), jti."
            }
        }
    },
    "securityRequirements": [{ "schemes": { "agentTalkServiceToken": {} } }],
    "defaultInputModes": ["application/agent-talk+json", "text/plain"],
    "defaultOutputModes": ["application/agent-talk+json", "text/plain"],
    "skills": [],
    "signatures": [{ "protected": "eyJhbGciOiJFZERTQSIsImtpZCI6Im5vcnRoLTEiLCJ0eXAiOiJKT1NFIn0", "signature": "…" }]
}
```

### 2.1 Parameters

| Parameter     | Required | Meaning                                                                                                                                          |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `keys`        | yes      | HTTPS URL of a JWK Set (RFC 7517) of Ed25519 keys (`kty: "OKP"`, `crv: "Ed25519"`, with `kid`). One set covers every signature the service makes |
| `addressCard` | yes      | URI template (RFC 6570, level 1) with one variable, `address`: the card of one open-door address                                                 |

### 2.2 Rules for the card

- `required` MUST be `true`. A client that does not speak the extension cannot take part.
- `skills` MUST be empty on a service card. A card never lists what a person's own agent can do.
- The card MUST be signed as A2A 1.0 section 8.4 describes: a JWS with protected header `alg: "EdDSA"`, a `kid` from the key set and `typ: "JOSE"`, over the card in JCS (RFC 8785) with `signatures` left out. Fields that are empty and not required are left out of the card before signing, as section 8.4.1 says.
- A client uses a card only when its signature verifies against keys it already holds for that issuer. It MUST NOT fetch a card or a key set because a message arrived; it refreshes the cards and key sets of services it recognises on its own schedule.

### 2.3 Per-address cards

An address whose owner chose an open door (a support desk, an orders address) has a card of its own at the `addressCard` template. It is the service card with two changes:

- `skills` lists what the door handles, one skill per kind of request, each with `id`, `name`, `description` and `tags`.
- Its interface carries a `tenant`: an opaque id the endpoint routes the door's calls by.

```json
{
    "supportedInterfaces": [
        { "url": "https://api.desk.example/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0", "tenant": "door_5Lr8" }
    ],
    "skills": [{ "id": "order-status", "name": "Order status", "description": "Where an order is and when it arrives", "tags": ["orders"] }]
}
```

Every address without an open door, known or not, MUST get the same response from the template (for example the same 404). Nothing about other addresses can be learned from it.

## 3. Activation

Every request MUST carry both headers:

```http
A2A-Version: 1.0
A2A-Extensions: https://www.input.so/agent-talk/v1
```

The server checks them before it reads anything else:

| Request                                 | Response                                                  |
| --------------------------------------- | --------------------------------------------------------- |
| `A2A-Version` absent or not `1.0`       | JSON-RPC error `-32009` (`VersionNotSupportedError`)      |
| `A2A-Extensions` does not name this URI | JSON-RPC error `-32008` (`ExtensionSupportRequiredError`) |

The response echoes `A2A-Extensions: https://www.input.so/agent-talk/v1`. A request body over 64 KiB is refused before it is parsed.

## 4. Authentication

The client sends `Authorization: Bearer <service token>`. The service token is a compact JWS signed with a key from the client's own key set:

- Protected header: `alg: "EdDSA"`, `kid`, `typ: "JWT"`.
- Claims: `iss` (the client's issuer domain), `aud` (the exact endpoint URL it is sent to), `iat`, `exp` (at most 5 minutes after `iat`), `jti` (1 to 128 characters).

The server verifies it against keys it already holds for `iss`, refuses an `iat` more than 5 minutes ahead of its clock, and remembers each `jti` until `exp` so no token is taken twice. There is no shared secret and no handshake.

## 5. Messages

Every step travels as one `SendMessage`. The message carries the step twice: in words, and signed and whole.

```json
{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "SendMessage",
    "params": {
        "message": {
            "messageId": "st_9f2a",
            "contextId": "tk_41c7",
            "role": "ROLE_USER",
            "extensions": ["https://www.input.so/agent-talk/v1"],
            "parts": [
                { "text": "Does Thursday 14:00 or Friday 10:00 work for a call?" },
                {
                    "data": {
                        "v": 1,
                        "step": {
                            "id": "st_9f2a",
                            "talk": "tk_41c7",
                            "type": "ask",
                            "at": "2026-11-26T10:00:00.000Z",
                            "by": { "address": "sam@north.example", "actor": "person" },
                            "to": ["maya@south.example"],
                            "question": "Which time works for a call?",
                            "options": [
                                { "id": "thu", "label": "Thursday 14:00" },
                                { "id": "fri", "label": "Friday 10:00" }
                            ],
                            "can": { "counter": true, "decline": true, "text": true },
                            "answerBy": "person",
                            "expires": "2026-12-03T10:00:00.000Z",
                            "text": "Does Thursday 14:00 or Friday 10:00 work for a call?",
                            "sig": "eyJhbGciOiJFZERTQSIsImtpZCI6Im5vcnRoLTEifQ..…"
                        }
                    },
                    "mediaType": "application/agent-talk+json"
                }
            ],
            "metadata": { "https://www.input.so/agent-talk/v1": { "carrier": "a2a" } }
        }
    }
}
```

### 5.1 The profile

- `messageId` MUST be the step's `id`, and `contextId` the step's `talk`.
- `role` is `ROLE_USER`: the service sending the step is the client.
- The message MUST carry exactly one data part with `mediaType: "application/agent-talk+json"`, holding `{ "v": 1, "step": … }`. The step is whole, with its `sig`, and without `seq`, which only the host assigns.
- The message SHOULD carry one text part with the step's `text`, so a person reading a log, or a client that ignores data parts, sees what the step says.
- `metadata` under the extension URI holds `{ "carrier": "a2a" }` and nothing else that counts. A server ignores everything else in metadata.
- A message with no data part of this media type, more than one, a `v` it does not know, or a step whose `id` and `talk` differ from `messageId` and `contextId`, is refused.

**The signed step is the truth.** The server validates and verifies the step exactly as it would a step read from an email (protocol section 8.6), without the binding to an email's From. The issuer of the service token and the issuer whose key signed the step MUST be the same.

### 5.2 Tasks

| The step                                                              | How it is sent                                                                            | What the server returns                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| an ask                                                                | no `taskId`                                                                               | a new `Task` whose `id` is the ask's step id, `TASK_STATE_SUBMITTED` |
| a step on an ask the server holds                                     | `taskId` set to the ask's id                                                              | that task, in its new state                                          |
| a step on an ask the client holds (an answer going back to the asker) | `referenceTaskIds: ["<ask id>"]`                                                          | an acknowledging `Message`                                           |
| a counter                                                             | a new ask (`re` and `counters: true`), with `referenceTaskIds` naming the ask it replaces | a new `Task`                                                         |
| `say`, `hold`, `resume`, a talk's `close`                             | in the context, no task                                                                   | an acknowledging `Message`                                           |

A task's state is the server's view of the ask, read from the last step it holds on it:

| Last step on the ask            | `status.state`         |
| ------------------------------- | ---------------------- |
| the ask itself, or a counter    | `TASK_STATE_SUBMITTED` |
| `wait`, `say`, `hold`, `resume` | `TASK_STATE_WORKING`   |
| `answer`, answered              | `TASK_STATE_COMPLETED` |
| `answer`, declined              | `TASK_STATE_REJECTED`  |
| `close`                         | `TASK_STATE_CANCELED`  |

A task's state is never the host's verdict. The service that hosts the talk judges every answer on its own clock (protocol rule 12).

Reply to the ask above:

```json
{
    "jsonrpc": "2.0",
    "id": "1",
    "result": {
        "task": {
            "id": "st_9f2a",
            "contextId": "tk_41c7",
            "status": { "state": "TASK_STATE_SUBMITTED", "timestamp": "2026-11-26T10:00:00.412Z" }
        }
    }
}
```

### 5.3 `GetTask`

The client that sent an ask MAY read its task:

```json
{ "jsonrpc": "2.0", "id": "2", "method": "GetTask", "params": { "id": "st_9f2a" } }
```

When the ask is answered, the task carries the answer as its one artifact, in the same two parts a message uses:

```json
{
    "jsonrpc": "2.0",
    "id": "2",
    "result": {
        "id": "st_9f2a",
        "contextId": "tk_41c7",
        "status": { "state": "TASK_STATE_COMPLETED", "timestamp": "2026-11-26T10:07:12.000Z" },
        "artifacts": [
            {
                "artifactId": "st_c033",
                "parts": [
                    { "text": "Friday 10:00 works." },
                    {
                        "data": {
                            "v": 1,
                            "step": {
                                "id": "st_c033",
                                "type": "answer",
                                "re": "st_9f2a",
                                "result": "answered",
                                "picks": ["fri"],
                                "sig": "…"
                            }
                        },
                        "mediaType": "application/agent-talk+json"
                    }
                ]
            }
        ]
    }
}
```

The client verifies the answer step like any other. A server answers `GetTask` only for an ask the calling service sent; any other id gets the uniform refusal. `GetTask` is never needed for correctness: answers travel back by `SendMessage`.

### 5.4 Methods not used

`CancelTask` cannot carry a signed step, so a withdrawal is a `close` step sent with `SendMessage`. Streaming, `SubscribeToTask`, push notification configs and `GetExtendedAgentCard` are not used in this version.

## 6. Admission and the uniform refusal

After the activation checks of section 3, a server takes a step only when all of these hold:

1. The service token verifies, is for this endpoint, is current, and its `jti` is new.
2. The server recognises the calling service. Which services it recognises is its own policy.
3. The step is valid and its signature verifies against the same issuer's keys.
4. The calling service may speak for the step's author: presence that service sent in authenticated mail, the talk's opening email, or the author's domain delegating to it (`_agent-talk.<domain>` TXT, or `/.well-known/agent-talk.json`).
5. The step continues a talk the receiving address is already in with that author, or it is an ask to an address with an open door, or the receiving person gave the author an allowance.
6. The step's `at` is within 5 minutes of the server's clock, its id has not been taken before, and its author's agent has not passed the turn limit.

Every step the server does not take, for whatever reason, gets one response:

```json
{ "jsonrpc": "2.0", "id": "1", "error": { "code": -32004, "message": "Not accepted" } }
```

The response SHOULD take the same time whatever the reason. A client learns nothing from a refusal about who has an agent or who allowed whom. After a refusal, a client MUST NOT send an agent's step by email instead; a step a person took has already gone by email.

## 7. Delivery and fallback

- A client SHOULD retry a step that met a transport failure, a 5xx, a timeout, or a JSON-RPC error other than the uniform refusal, a few times over a couple of minutes.
- After the last attempt, a step a person took MUST go by email with its talk token, under the same step id. A step an agent took on its own does not; the other side's copy of the ask runs out at its `expires`.
- A step may arrive both directly and in an email. The second arrival has an id the server already holds and is ignored.
- Silence is not a failure. A task that stays submitted means the person has not acted yet.

## 8. Security

The protocol's security considerations (section 11 of https://www.input.so/agent-talk) apply in full. For this extension in particular:

- **No fetch on arrival.** Neither a card, a key set nor a delegation is fetched because a request or a message arrived.
- **Enumeration.** The uniform refusal, the single response for addresses without an open door, and no lookup method.
- **Replay.** Service tokens bound to one endpoint, short lived and taken once; steps fresh and taken once.
- **Hostile input.** The body cap, validation before verification, and a step's text treated as data, never as instructions.

## 9. Interoperability

- The reference implementation, `@input/agent-talk`, builds and reads every object on this page, and its reference participant runs a whole second service on the package alone: test vectors and the source are published with the protocol.
- Its JSON has been checked against the official A2A JavaScript SDK (`@a2a-js/sdk` 1.3): the card, messages, tasks and send results round-trip through the SDK's 1.0 types, and the SDK's client receives `ExtensionSupportRequiredError` without the header, sends a step with a service token, and reads a task.
- Known gap: that SDK version drops empty fields such as an empty `skills` before canonicalising a card, so its verifier cannot check a card signed per A2A 1.0 section 8.4.1, which keeps required empty fields. Implementations should follow the specification.
