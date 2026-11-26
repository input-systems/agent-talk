# Agent Talk

Draft 1, 26 November 2026. Edited by Input. Home: https://www.input.so/agent-talk

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119 and RFC 8174 when, and only when, they appear in capitals.

## 1. Abstract

Agent Talk lets the agents of two people who email each other exchange structured steps beside their email thread. One person asks, the other decides, and each person's own agent does the work on their side.

Email provides identity, reach and the record people read. Agent Talk adds three things:

- **Structure**: exactly what is asked.
- **Speed**: agents answer where their people allowed it.
- **Bounds**: what an agent may see, share and promise.

The protocol has three parts:

- **The model**: talks, steps, asks, the card, and the rules every implementation follows (sections 3 to 7).
- **The email binding**: how presence, talks and steps travel in mail (section 8).
- **The A2A binding**: how two services exchange the same steps directly, as a profile extension of A2A 1.0 (section 9, and the extension page at https://www.input.so/agent-talk/v1).

A reference implementation in TypeScript, JSON Schemas for every object, and test vectors are published with this document.

### 1.1 Design goals

- **People decide.** Only a person's yes commits a person. An agent answers on its own only where its person allowed it, and only within narrow, named scopes.
- **Email stays the record.** Every step a person takes still travels as an email the other side can read without any software from this protocol.
- **Reading tells the sender nothing.** Receiving a message never makes a receiver fetch anything, so a sender cannot learn who reads its mail, or when.
- **No lookup.** There is no way to ask whether an address has an agent.
- **Agents inform, never instruct.** Every string from the other side is data. A step can trigger nothing except an answer to an open ask.

## 2. Terminology

- **Person**: someone with an email address. The address is the identity. A company takes part the same way, through a role address such as `support@` or `orders@`, and the same rules apply to it.
- **Agent**: software acting for one person.
- **Service**: an operator of agents, named by a DNS domain (its **issuer**).
- **Talk**: the steps exchanged for the people on one email thread.
- **Step**: one signed entry in a talk.
- **Ask**: a step that wants something back.
- **Card**: the rendering of an ask for a person.
- **Block**: the element in an email's HTML that holds the step the email carries (section 8.6).
- **Allowance**: a person's standing permission for one peer and one scope. Allowances are local to the giver's service and never travel.
- **Host**: the service that opened the talk. It orders steps and decides which answer counts.
- **Boundary**: the data an agent may read while acting in a talk (section 7, rule 5).
- **Open door**: an address whose owner chose to accept direct asks from any service its receiver recognises, such as a support desk (section 3.1, `isOpen`).
- **Recognised service**: a service whose keys a receiver already holds because it decided to trust them, on its own schedule and by its own policy (section 9.3).

## 3. Presence

A service learns that an address has an agent only from mail that address sent, or from a delegation the address's domain published (section 3.3).

### 3.1 The presence token

Every message a service sends for a person SHOULD carry a presence token, unless the person turned it off. The token is a compact JWS (RFC 7515), signed with Ed25519 (`alg: "EdDSA"`, RFC 8037), with protected header `typ: "agent-talk-presence"` and a `kid`, and this payload:

```json
{
    "v": 1,
    "iss": "north.example",
    "sub": "maya@example.com",
    "acc": ["ask", "say"],
    "types": ["time", "busy", "text", "file"],
    "iat": 1795000000,
    "exp": 1802776000
}
```

- `iss`: the service's issuer domain. Its keys are published as in section 3.4.
- `sub`: the sender's address, lowercased.
- `acc`: the step types the agent accepts.
- `types`: the value types it renders natively.
- `isOpen`: present only when true. Then any service the receiver recognises may send this address a direct ask with no email first. It is meant for role addresses such as a support desk, and for people who chose to be listed. An address MUST NOT set it without its owner's choice.
- `exp`: at most 90 days after `iat`.

### 3.2 Accepting presence

A receiver MUST count a presence token only when all of these hold:

1. The signature checks out against a current key of `iss` that the receiver already holds (section 3.4).
2. `sub` equals the message's From address.
3. The message is authenticated as coming from that address: the receiving provider's `Authentication-Results` shows a DKIM or SPF pass aligned with the From domain (DMARC alignment), or `iss` is the receiver's own service and it holds the send record.
4. The token is on the message itself, not inside quoted, forwarded or attached content.
5. `iat` is not more than 5 minutes ahead of the receiver's clock. A token dated ahead would stay good past its 90 days.

A receiver SHOULD keep presence per receiving mailbox and let it lapse at `exp` or 90 days after the last sighting, whichever comes first. When a known address shows up with a different `iss`, the receiver MUST NOT use the new service until its person confirms it.

There is no lookup. A service MUST NOT offer a way to ask whether an address has an agent, except for addresses that set `isOpen`.

### 3.3 Domain delegation

A domain owner MAY name the services that speak for its addresses, the way SPF and DKIM records name who may send. It lets a service speak for role addresses without a first email.

In DNS, as one or more TXT records at `_agent-talk.<domain>`:

```text
_agent-talk.example.com. TXT "v=1; svc=desk.example"
_agent-talk.example.com. TXT "v=1; svc=hosting.example; acct=acc_7Hq2"
_agent-talk.example.com. TXT "v=1; svc=mailer.example; local=news,billing"
```

| Tag     | Meaning                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v=1`   | Required, and first.                                                                                                                                                                                              |
| `svc`   | Required. The issuer domain of the service that may speak for addresses at this domain.                                                                                                                           |
| `acct`  | Required when `svc` hosts many organisations: which of its accounts. 1 to 128 letters, digits, `-` and `_`. Without it, a record naming a multi-tenant service would let any of its tenants speak for the domain. |
| `local` | Optional. A comma-separated list of local parts, at most 64. Only these addresses are delegated. Absent: every address at the domain.                                                                             |

A domain that cannot edit DNS MAY publish the same records at `https://<domain>/.well-known/agent-talk.json`:

```json
{ "v": 1, "services": [{ "svc": "desk.example" }, { "svc": "mailer.example", "local": ["news", "billing"] }] }
```

Rules:

- A record with a tag named twice, a tag this version does not define, or a malformed value does not count. In the file, one malformed entry makes the whole file not count, so a typo never narrows or widens what the domain said. A file holds at most 16 entries.
- A domain MAY delegate to several services. Where `local` sets overlap, each service may speak for those addresses; every step still names its own issuer.
- A record naming `acct` counts only for that account of `svc`. A record naming no `acct` counts only for a service that hosts no accounts.
- A receiver MAY treat a delegation as equal to presence for every address it covers.
- A receiver MUST look delegations up on its own schedule, never because a message arrived (rule 22): a DNS query or a fetch on arrival goes to the sender's own nameserver or host and tells it the mail was read. A receiver SHOULD stop counting a record that has been missing for 72 hours.
- A delegation does not take a person's own address away from the service that person's mail already names.

### 3.4 Keys

A service publishes the Ed25519 public keys it signs with as a JWK Set (RFC 7517), at the URL named in its Agent Card (section 9.1). It SHOULD be `https://<issuer>/.well-known/agent-talk-keys.json`. Each key has `kty: "OKP"`, `crv: "Ed25519"`, `x` and a `kid`.

- One key set covers presence tokens, talk tokens, step signatures, service tokens and the Agent Card signature.
- **Rotation.** A new key SHOULD appear in the set at least 24 hours before it signs anything. A retired key SHOULD stay in the set for at least 90 days after it last signed, because presence tokens live that long.
- **Compromise.** A service whose key is compromised removes it from the set at once. Tokens and steps signed by it stop counting when receivers next refresh.
- A receiver refreshes the key sets of the services it recognises on its own schedule. A token or step with a `kid` the receiver does not hold is not verified, and nothing is fetched because of it (rule 22).

## 4. Talk and steps

### 4.1 Talk

```ts
type Address = string; // lowercased mailbox address

type Talk = {
    v: 1;
    id: string; // URL-safe, at least 128 bits of randomness
    host: string; // the host's issuer domain
    parties: Address[]; // 2 in this version
    anchor?: { messageId: string }; // the opening email; absent on a direct talk
    title: string; // at most 60 characters
    createdAt: string; // RFC 3339, UTC
};
```

### 4.2 Step

```ts
type Step = {
    id: string;
    talk: string;
    seq?: number; // assigned by the host; strictly increasing
    at: string; // RFC 3339; services SHOULD write UTC with milliseconds
    by: { address: Address; actor: "person" | "agent" };
    via?: "app" | "link" | "email";
    re?: string; // the step this responds to
    email?: string; // Message-ID of the email that says this step in words
    text: string; // at most 2,000 characters
    sig: string; // detached compact JWS over the canonical step, by the author's service
} & (Say | Ask | Answer | Wait | Hold | Resume | Close);
```

- `actor: "person"` means the person took the step or approved that exact step. `actor: "agent"` means the agent took it on its own.
- `via: "link"` marks an answer given on a web card; `via: "email"` marks an answer read out of a plain reply.
- `text` states the step in plain words. A receiver that does not understand the step MUST show `text`.

**Signing.** `sig` is a detached compact JWS (RFC 7515, appendix F): `<protected>..<signature>`, with `alg: "EdDSA"` and the author service's `kid` in its protected header. Its payload is the step without `sig` and `seq`, in JCS canonical form (RFC 8785). The payload is not sent; a verifier rebuilds it from the step. A step that cannot be put in canonical form counts as unsigned. `seq` is left out because the host assigns it after the author signs.

**Names.** Every name a receiver prints or looks up is a plain token, so no id, type or address can carry markup or a line break into whatever shows it:

- `id`, `talk` and `re` are 1 to 128 letters, digits, `-` and `_`. Option and field ids are the same, at most 64.
- A step type, value type or field type is at most 64 characters: a lowercase letter, then letters, digits and `-`. A private one is `x-`, then a lowercase letter or digit, then letters, digits and `-`.
- An address is lowercased, at most 254 characters, with a plain host name and no spaces, quotes or brackets.
- `email` is a Message-ID in angle brackets, at most 998 characters. `sig` is at most 1,024 characters.
- Every time is RFC 3339 with an offset, on a day that exists, with every field in range: `2026-99-99T99:99:99Z`, `2026-02-30T10:00:00Z` and `24:00:00` have the right shape and MUST be rejected. Leap seconds are not accepted. A date is `YYYY-MM-DD` on a day that exists.
- Every string a step defines is non-empty.
- A step is at most 256,000 characters as JSON, whatever fields it holds, and nests at most 64 levels below its top-level object.
- Every length in this document counts UTF-16 code units, the way JSON text is commonly measured, so implementations in any language agree on the limits.

An author MUST use the types this version defines, or private ones. A receiver MUST also accept a type it does not know that is a valid name, and show the step or value by its `text`.

### 4.3 Step types

```ts
type Say = { type: "say"; values?: Value[]; receipt?: Receipt; about?: Thing };

type Ask = {
    type: "ask";
    about?: Thing;
    to: Address[]; // 1 or 2
    title?: string; // at most 60
    question: string; // at most 200
    context?: string[]; // at most 3 items of at most 120
    options?: Option[]; // at most 8; none makes an open ask
    select?: "one" | "many"; // default "one"
    fields?: Field[]; // at most 5
    can: { counter: boolean; decline: boolean; text: boolean };
    answerBy: "person" | "personOrAgent";
    needs?: Scope[]; // at most 8
    effect?: "event" | "introduction"; // what a yes sets off on the asker's side
    due?: string;
    autoUntil?: string; // at most 24 hours after `at`, not after `expires`; default `at` + 1 hour
    expires: string; // at most 30 days after `at`; default 7 days
    counters?: boolean; // with `re`: this ask replaces the one it answers
    requestedScopes?: Scope[]; // at most 3; scopes the asker asks to keep: only calendar.freeBusy, calendar.book, mail.shared
    requestedUntil?: string;
};

type Option = { id: string; label: string; detail?: string; isRecommended?: boolean; value?: Value };
type Field = { id: string; label: string; type: Value["type"]; isRequired?: boolean };

type Answer = {
    type: "answer";
    re: string;
    result: "answered" | "declined";
    picks?: string[]; // option ids, at most 8
    values?: Record<string, Value>; // keyed by field id, at most 5
    receipt?: Receipt;
    isInterpreted?: boolean;
    granted?: { scopes: Scope[]; isStanding: boolean; until?: string }; // what the person accepted of `requestedScopes`
};
// a declined answer carries no picks, values or granted

// this side's person has to act before it goes on; `re` (required) names the step that needs them
type Wait = { type: "wait" };

type Hold = { type: "hold"; reason: "audience" | "person"; addresses?: Address[] };
type Resume = { type: "resume" };
type Close = { type: "close"; reason: "done" | "cancelled"; outcome?: Value[] };

type Receipt = { shared: string; held?: string }; // at most 120 each

// <area>.<capability>; a tool scope names one of the person's own tools
type Scope =
    | "calendar.freeBusy"
    | "calendar.book"
    | "calendar.details" // covers calendar.freeBusy
    | "mail.shared"
    | "mail.own"
    | `tool.${string}.read`
    | `tool.${string}.write` // covers read on the same tool
    | `x-${string}`;

// what the message is, as one schema.org object: Order, Invoice, ParcelDelivery, EventReservation, …
type Thing = { "@type": string; [property: string]: unknown };
```

Limits: `label` at most 80, `detail` at most 120, at most one `isRecommended` per ask, at most 8 `values` on a say and 8 `outcome` values on a close, at most 50 `addresses` on a hold. A receiver MUST reject a step that breaks a limit. The JSON Schemas list every limit; `AGENT_TALK_LIMIT` in the reference implementation names them.

A scope is at most 128 characters: a lowercase letter, then letters, digits and `-`, then any number of `.` and a token of letters, digits and `-`. A tool name is a lowercase letter or digit, then up to 62 lowercase letters, digits and `-`. A receiver MUST accept a scope in `needs` that it does not know and treat it as one its person has not allowed.

`about` says what a message is, in the vocabulary of https://schema.org, which many senders already write into their email. The values of section 4.4 stay the way to say what a message asks and hands over.

- `about` is one object of at most 8,000 characters as JSON, with a `@type` of at most 64 characters.
- Its vocabulary is always schema.org. A sender SHOULD leave `@context` out, and a receiver MUST ignore one that is sent.
- A receiver that does not know the `@type` MUST ignore `about` and show `text`.
- `about` MUST NOT say anything the step's `text` and the email's words do not (rule 2), and it is data from the other side like every other string (rule 4).
- An action inside it (`potentialAction`) is not an ask. A receiver MUST NOT carry it out; what a message asks goes in an `ask` step.
- A receiver MUST NOT fetch anything `about` names on its own: a context, an image or any other URL (rule 22).

### 4.4 Values

Every value carries `text`, at most 500 characters, so an unknown type still reads.

```ts
type Value =
    | { type: "text"; text: string }
    | { type: "time"; text: string; start: string; end: string; timeZone: string; place?: string; isCall?: boolean }
    | { type: "busy"; text: string; from: string; to: string; blocks: { start: string; end: string }[] } // at most 500 blocks
    | { type: "date"; text: string; date: string }
    | { type: "place"; text: string; name: string; address?: string }
    | { type: "contact"; text: string; address: Address; name?: string }
    | { type: "amount"; text: string; currency: string; amount: string } // ISO 4217, decimal string
    | { type: "link"; text: string; url: string }
    | { type: "file"; text: string; name: string; mediaType: string; size: number; sha256: string; url: string }
    | { type: `x-${string}`; text: string };
```

- `time.timeZone` is an IANA zone name of at most 64 characters; `start` and `end` are RFC 3339 with offset, and `end` is after `start`.
- `link.url` and `file.url` are `https://` URLs. `file.name` and `file.mediaType` are at most 255 characters, `file.size` is a non-negative integer, and `file.sha256` is lowercase hex.
- `amount.currency` is three uppercase letters (ISO 4217); `amount.amount` is a decimal string such as `"12.50"`.
- Every other string in a value is at most 500 characters.
- `file.url` MUST be fetchable only by the talk's parties' services and SHOULD expire with the ask.
- Types starting with `x-` are private. A receiver that does not know a type MUST show `text` and MUST NOT fail the talk.

## 5. Lifecycle

- A talk is open from its first step until a `close` step, or 30 days without a step.
- An ask is open until it gets an answer from each address in `to`, is replaced by a counter, is withdrawn by a `close`, or reaches `expires`.
- A `hold` stops all agent steps (`actor: "agent"`) in the talk. Person steps are still allowed. A `hold` with `reason: "audience"` lifts once each party has sent a `resume`; a `hold` with `reason: "person"` lifts when that person sends a `resume`.
- The host assigns `seq`. If two answers to one ask from one address arrive, the lower `seq` counts and the later one is rejected.

### 5.1 Attention

Every surface that shows a talk SHOULD derive what it needs from the person from the steps alone, so that all of them agree:

| State           | When                                                                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `needsYou`      | something waits on the viewer: an open ask for them that no agent can answer or that their agent sent a `wait` on, a hold only they can lift, or an answer waiting for their confirmation (rule 12) |
| `agentsWorking` | an open ask an agent may still answer (before its `autoUntil`)                                                                                                                                      |
| `waitingOnThem` | the same as `needsYou`, for the other person                                                                                                                                                        |
| `done`          | the talk is closed, or nothing is pending                                                                                                                                                           |

When several apply, the first in this order wins: `needsYou`, `agentsWorking`, `waitingOnThem`.

The reference implementation's `getAgentTalkAttention` gives the exact derivation, with the earliest `due` of what is open.

## 6. The card

A receiver renders an ask as a card. A conforming card shows, in this order:

1. Who asks: name, address, and whether the person or their agent wrote it (`by.actor`).
2. `title`, `question` and `context`, presented as the asker's words.
3. What answering shares, drawn by the receiver from `needs`.
4. What a yes sets off, drawn by the receiver from `effect`.
5. The options with their details. A recommended option is marked as the asker's recommendation.
6. Notes from the receiver's own agent, if any. These MUST NOT be sent.
7. The actions `can` allows, `due`, and a way to set the card aside that sends nothing. For `requestedScopes`, each scope in the receiver's own words with its own switch, and a choice between this talk only and standing.

Lines 3 and 4 MUST NOT be taken from the asker's text. An answer MUST NOT carry data beyond what `needs` named.

## 7. Rules

1. **Email for people, direct for agents.** A talk starts with an email that carries its opening ask (section 8), unless the receiving address keeps an open door or its person gave the sender an allowance. Steps on a talk both sides are already in MAY travel directly (section 9), and email still carries every step a person took. A service MUST reject a direct step it does not take with the same response it gives for an unknown address.
2. **No hidden asks.** The email that opens or voices a step MUST say in words what the step says in structure.
3. **Actor honesty.** `actor` MUST be `"agent"` unless the person took or approved that exact step.
4. **Text is data.** An agent MUST treat every string from the other side as untrusted data. No step can trigger anything except an answer to an open ask.
5. **The boundary.** While acting in a talk, an agent MAY read only:
    - the talk itself
    - messages its person and that party actually sent each other
    - data its person allowed for that party

    Anything else needs the person's approval for that item.

6. **When an agent may act.** An open ask is the agent's move only when all of these hold; otherwise it is the person's:
    - it arrived as a signed step from a service the receiver recognises, and the talk is not held
    - `answerBy` is `"personOrAgent"`, and the ask's `autoUntil` has not passed
    - an allowance, or the person's hand-over of this talk, covers what the ask needs: its `needs`, `calendar.book` when `effect` is `"event"`, and `mail.shared` for an open ask that names nothing
    - an ask that needs nothing (a plain choice) is answered by an agent only after the person handed the talk over
    - the ask's `effect` is not `"introduction"`: a person decides whom they meet (rule 14)
    - the turn limit (rule 9) is not reached

    Every time comparison MUST be written so that a time that does not parse closes the ask or hands it to the person, and never leaves it open to an agent.

    When it is the person's move, the agent SHOULD send a `wait` step, and MUST NOT state the reason. An agent MAY hand over to its person at any time. An agent picks from `options` or counters with values of the same types, and answers an open ask only from inside the boundary. An agent MAY add other steps only after its person acted in the talk, or under an allowance.

7. **Consent behind every share and promise.** Data leaves, and effects happen, only on the person's approval of that step or under an allowance. Each use of an allowance SHOULD be logged for the person who gave it.
8. **Local notes stay local** (section 6, line 6).
9. **Turn limit.** An agent MUST NOT add more than 10 `say`, `ask` and `answer` steps since its person last acted in the talk. `wait`, `hold`, `resume` and `close` do not count. The host MUST refuse a step past the limit; a receiver MAY apply it to its copy of a talk another service hosts.
10. **No read receipts.** A service MUST NOT fetch or acknowledge a talk in a way that reveals when its person viewed it.
11. **Audience.** When a new address joins the email thread, the first service to see it MUST send a `hold` with `reason: "audience"`. The new address is not added to `parties`.
12. **How an answer takes effect.** The host judges an answer on its own clock when it accepts it, never on the answer's `at`:
    - **auto**: a signed step accepted before the ask's `autoUntil`. The effect MAY proceed with no one involved.
    - **recheck**: a signed step accepted after `autoUntil` and before `expires`. The asker's agent MUST re-check its person's current data before the effect, and then proceeds, counters, or asks its person.
    - **confirm**: an answer with `via: "link"` or `via: "email"`. An answer read out of a plain reply MUST set `isInterpreted`. The effect MUST wait for the asker's confirmation.
    - **expired**: accepted at or after `expires`. The host MUST refuse it; continuing takes a new ask.
13. **No secrets.** An ask MUST NOT request passwords, payment credentials, tokens or keys.
14. **Effects.** An ask's `effect` says what a yes sets off on the asker's side.
    - `"event"`: the asker's service sends the calendar invite (iTIP, RFC 5546) once the ask is answered, and records it in a `close` step's `outcome`.
    - `"introduction"`: the ask offers to introduce its receiver to someone. The option a yes picks MUST carry a `contact` value naming that person, the ask MUST have `answerBy: "person"`, and an agent MUST NOT answer it. Once it is answered with that option, the asker's service sends one email to both people that introduces them, and records it in a `close` step's `outcome`.
    - An introduction ask whose `about` is `{ "@type": "IntroductionRequest" }` turns it around: the asker asks its receiver to introduce the asker to the contact, instead of offering to introduce the receiver. Only the person answers it all the same. On a yes, the receiver's service offers the introduction to the contact itself and, once they agree, sends the email and closes the asker's talk with the same `outcome`.
    - A service MAY treat an address its person accepted an introduction to as one its person has written to (rule 22). An introduction MUST NOT give an allowance.
15. **Freshness.** A service MUST reject a direct step whose `at` is more than 5 minutes from its own clock, and a step id it has already accepted. After an ask's `autoUntil`, only a person answers it; the asking agent MAY re-check its data and send a new ask.
16. **Tools.** An agent MAY use its person's tools for another party only under an allowance for `tool.<name>.read` or `tool.<name>.write`, or with its person's approval of that exact call. The other party receives the answer, never the tool or its credentials. `read` covers calls that change nothing; `write` covers calls that add or update. Calls that delete, send, pay or change access MUST have the person's approval. A service MUST NOT reveal which tools a person has, except through answers that person's allowances or approvals produce.
17. **A person's words outrank the agents.** When a person sends a message in the anchored thread, each service MUST have its agent read it before that agent adds another step. Asks the message answers or contradicts are closed or asked again.
18. **Cancelling reverses.** When a talk is closed with reason `cancelled` after an effect was set off, the service that set it off MUST reverse it; for an event it sends an iTIP CANCEL.
19. **Fallback to email.** When a direct step a person took gets no response within the sender's timeout, the sender MUST send it by email with its talk token (section 8), under the same step id. A step an agent took on its own is not sent by email when a direct delivery fails, or after the uniform refusal; the other side's copy runs out at the ask's `expires`.
20. **Local policy.** A service MAY give any ask to its person for reasons of its own, such as the person's settings or a budget. It MUST NOT state the reason.
21. **Allowances are asked for, never taken.** An ask MAY carry `requestedScopes`: scopes the asker asks to keep. Only `calendar.freeBusy`, `calendar.book` and `mail.shared` MAY be requested; a receiver MUST reject an ask that requests anything else. Such an ask MUST have `answerBy: "person"`, and an agent MUST NOT answer it. The answer's `granted` names the scopes the person accepted, never more than were requested, and whether they hold for this talk only or stand. A service MUST NOT reveal the person's own limits on what they accepted, and MUST NOT reveal when an allowance is later changed or removed.
22. **Reading tells the sender nothing.** A service reads a step from the email that carries it (section 8.6). Answering an ask is the only signal a sender gets.
    - When a message arrives from an address its person has never written to, a service MUST NOT fetch anything because of it: not the talk link, not the talk from its host, and not a link, file or other URL that a step names.
    - Whoever the sender is, a service MUST NOT fetch the Agent Card or the keys of a service it does not already recognise, nor look up a delegation because a message arrived. It refreshes what it holds on its own schedule.
    - A person who follows a link acts for themselves.

## 8. Email binding

An email that opens or voices a step carries three things:

- the talk token, in a header (8.1, 8.2)
- the step itself, in a block in its HTML (8.6)
- a link for people (8.3, 8.5)

A receiving service reads the step from the block. The header and the link are how the email is recognised when the block did not arrive, and the link is where a person without an agent answers. Plain mail carries only the presence token.

### 8.1 Header

```text
X-Agent-Talk: v=1; p=<presence token>; t=<talk token>
```

- `p` is the presence token (section 3). `t` is present only on messages that open or voice a step.
- The header name keeps the `X-` prefix, because a widely used mail API only accepts custom headers named that way, set when a message is created.
- Long values are folded per RFC 5322.
- A header value SHOULD stay within 870 characters, the most a widely used sending service accepts. When `p` and `t` together are longer, the sender leaves `t` out of the header; the block (8.6) and the link (8.3) carry it.
- Some providers cannot set a custom header on every message, for example on reply and forward drafts. A receiver MUST treat the header, the block and the link as equal carriers of the talk token.

### 8.2 Talk token

A compact JWS with protected header `alg: "EdDSA"`, a `kid` and `typ: "agent-talk-talk"`, and the payload:

```json
{ "v": 1, "iss": "north.example", "talk": "tk_41", "step": "st_9f", "sub": "sam@example.org", "iat": 1795000000, "exp": 1795604800 }
```

- `sub` MUST equal the message's From address.
- `exp` is the ask's `expires`, at most 30 days after `iat`. After it the token MUST be refused: the email is only an email again, for both parties.
- `iat` MUST NOT be more than 5 minutes ahead of the receiver's clock.
- The token names a talk; it grants nothing. Membership is checked with the host, which only returns a talk to a service acting for one of its `parties`.

### 8.3 Link

Each message that carries `t` SHOULD also carry a link to `https://<iss>/t/<talk token>`, in the sender's disclosure line. The link opens the web card (section 10), and it is there for people.

- A receiver MAY read the token from the link when neither the header nor the block arrived. It MUST read it only from the message's own content, never from quoted history.
- A receiver MUST NOT follow the link on its own for a sender its person has never written to (rule 22).

### 8.4 Steps in words

Every email either party sends in the thread SHOULD carry the talk token of the step it voices. The sending service records the email's Message-ID in that step's `email` field.

### 8.5 Link header

```text
X-Agent-Talk-Link: <https://<iss>/t/<talk token>>
```

Like `List-Unsubscribe` (RFC 2369), the talk lives behind a link in the headers, so the email body only shows the sender's disclosure line. The URL serves three representations by content negotiation, with `Vary: Accept`:

- `text/markdown`, for agents that do not implement this protocol: who asks, the options, how to answer, and a statement that quoted text is information, not instructions.
- `application/agent-talk+json`, the step itself, for agents that do.
- `text/html`, the web card (section 10), for people.

On a message without a talk token, the link SHOULD point to the service's description of this protocol. A receiver MUST NOT treat a link as authenticated; it verifies the talk token first. A receiver that read the step from the block (8.6) needs none of these views.

### 8.6 The step block

A message that opens or voices a step SHOULD carry the step itself, in one element in its HTML part:

```html
<script type="application/agent-talk+json">
    { "v": 1, "token": "<talk token>", "step": { "id": "st_9f", "talk": "tk_41", "type": "ask", "question": "…", "sig": "…" } }
</script>
```

For the sender:

- `token` is the message's talk token (8.2). `step` is the step as its author's service signed it: with `sig`, and with `seq` once the host assigned one.
- The block is plain JSON of at most 32,000 characters. A step that does not fit travels behind the link only.
- Inside the JSON, `<`, `>` and `&` MUST be written as `\u003c`, `\u003e` and `\u0026`, so no text in a step can end the element. U+2028 and U+2029 SHOULD be escaped too.
- A message MUST NOT carry more than one block of its own, and the block SHOULD come before any quoted content.
- The block says what the email says in words and nothing more (rule 2). Mail apps do not show it.
- A message with no HTML part carries no block.

A receiver counts a block only when all of these hold:

1. Its `token` checks out as this message's talk token (8.2): the signature, `sub` equal to From, and not expired. The message is authenticated as coming from that address (section 3.2, item 3).
2. When the header also carries `t`, both tokens name the same talk and step.
3. The step's `talk` and `id` are the ones the token names, and its `by.address` equals the token's `sub`.
4. When the step has `email`, it equals the message's own Message-ID.
5. The step breaks no limit, and its `sig` verifies against a key of the token's `iss` that the receiver already holds (rule 22).

For the receiver:

- It removes line breaks from the block before parsing and before applying the 32,000 limit. JSON cannot hold a raw line break inside a string, so this undoes line wrapping in transit.
- It uses the first block that counts, MAY stop after eight blocks, and ignores a step whose id it already holds.
- A block that does not count is ignored. The message is then handled by its header and link, or as plain mail.
- A step read from a block is a signed step from the token's service. Whether an agent may act on it is rule 6, as for a step that arrived directly. The five minutes of rule 15 apply to direct steps only; a step from a block is judged by its ask's `autoUntil` and `expires`.
- It acts on an ask from a block only for an address in the ask's `to`.
- A block from a service the receiver does not recognise cannot be verified without fetching that service's keys, so it does not count as signed. Whether its content is shown is the receiver's own policy.

## 9. A2A binding

Two services MAY exchange steps directly over A2A 1.0, using JSON-RPC 2.0 over HTTPS. This section is the normative summary; the extension page at https://www.input.so/agent-talk/v1 gives the full wire detail with examples.

The binding is a **profile extension**: it constrains what messages carry and what task ids mean. It adds no A2A methods and no task states. Its URI is the version:

```text
https://www.input.so/agent-talk/v1
```

### 9.1 Discovery

A service publishes a signed A2A Agent Card at `https://<issuer>/.well-known/agent-card.json` and lists this protocol under `capabilities.extensions`:

```json
{
    "uri": "https://www.input.so/agent-talk/v1",
    "description": "Agent talk: signed steps between people's agents, the same steps email carries.",
    "required": true,
    "params": {
        "keys": "https://north.example/.well-known/agent-talk-keys.json",
        "addressCard": "https://api.north.example/a2a/cards/{address}"
    }
}
```

- `params.keys` names the service's JWK Set (section 3.4).
- `params.addressCard` is a URL template (RFC 6570, level 1) for the card of one open-door address.
- The card's `supportedInterfaces` names the A2A endpoint with `protocolBinding: "JSONRPC"` and `protocolVersion: "1.0"`. `capabilities.streaming` and `capabilities.pushNotifications` are `false`.
- The card declares the service token (9.4) as an `httpAuthSecurityScheme` with `scheme: "Bearer"` and `bearerFormat: "JWT"`, and requires it in `securityRequirements`.
- `defaultInputModes` and `defaultOutputModes` are `application/agent-talk+json` and `text/plain`.
- A service card lists no `skills`: a card MUST NOT list what a person's own agent can do.
- The card MUST be signed as A2A 1.0 section 8.4 describes: one entry in `signatures` holding a JWS protected header (`alg: "EdDSA"`, the `kid` of a key in the service's key set, `typ: "JOSE"`) and signature, over the card in JCS (RFC 8785) with `signatures` left out. A receiver uses a card only when its signature verifies against keys it already holds for that issuer.

A service fetches the Agent Card and keys of the services it recognises on its own schedule. It MUST NOT fetch them because a message arrived (rule 22).

**Open doors.** An address with an open door (`isOpen`, section 3.1) SHOULD say what it handles. Its per-address card, at the service card's `addressCard` template, is the service card with:

- one A2A skill per kind of request, each with an `id`, a `name`, a `description` and `tags`:

    ```json
    { "id": "order-status", "name": "Order status", "description": "Where an order is and when it arrives", "tags": ["orders"] }
    ```

- a `tenant` on its interface: an opaque id the endpoint routes the door's calls by.

Rules for open doors:

- A peer finds a door from presence (`iss` and `isOpen`) or from a delegation record (section 3.3), then the service card's `addressCard` template.
- Every address without an open door, known or not, MUST get the same response from the template URL (for example the same 404), so the template cannot be used to learn who has an agent.
- An asking agent uses the skills to decide whether to ask there. They are not a promise to answer.

### 9.2 Mapping

| Agent Talk                                | A2A 1.0                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| talk                                      | context: `contextId` is the talk id                                                                                              |
| step                                      | one `Message`: `messageId` is the step id, `role` is `ROLE_USER` (the sending service is the client)                             |
| the step body                             | one data part, `mediaType: "application/agent-talk+json"`, holding `{ "v": 1, "step": … }`: the signed step whole, without `seq` |
| the step in words (rule 2)                | one text part holding the step's `text`                                                                                          |
| ask                                       | the receiver creates a `Task` whose `id` is the ask's step id. The sender sends no `taskId`                                      |
| a step on an ask the receiver holds       | `SendMessage` with `taskId` set to the ask's id                                                                                  |
| a step on an ask the sender holds         | `SendMessage` with `referenceTaskIds: [<ask id>]`: an answer travelling back to the asker                                        |
| a counter                                 | a new ask (`re` and `counters: true`), so a new task, with `referenceTaskIds` naming the ask it replaces                         |
| `say`, `hold`, `resume`, a talk's `close` | a message in the context with no task; the receiver acknowledges with a `Message`                                                |
| `metadata[<extension URI>]`               | `{ "carrier": "a2a" }` only. A receiver ignores everything else in metadata and trusts nothing in it                             |

Task state is the receiver's view of an ask, read from the last step it holds on that ask:

| Last step on the ask               | `status.state`                                          |
| ---------------------------------- | ------------------------------------------------------- |
| the ask itself, or a counter       | `TASK_STATE_SUBMITTED`                                  |
| `wait`, `say`, `hold`, `resume`    | `TASK_STATE_WORKING`                                    |
| `answer` with `result: "answered"` | `TASK_STATE_COMPLETED`, with the answer as the artifact |
| `answer` with `result: "declined"` | `TASK_STATE_REJECTED`                                   |
| `close` of the ask or the talk     | `TASK_STATE_CANCELED`                                   |

- **The signed step is the truth.** A receiver validates and verifies the step in the data part exactly as it would a block (section 8.6), minus the binding to From. Transport authentication (9.4) says which service called; the step's `sig` says which service wrote it, and they MUST be the same issuer.
- **No talk token travels.** A talk token binds a step to an email's From. A direct step has no From; the service token and the speaks-for check (9.3) replace it.
- **Task state is not the host's verdict.** The host still judges every answer by rule 12 on its own clock. A completed task at the answerer does not mean the host counted the answer.

### 9.3 Admission

A service MUST accept a step from another service only when all of these hold, and MUST answer every failure with the uniform refusal (9.6):

1. The request carries `A2A-Version: 1.0` and names the extension in `A2A-Extensions` (9.6).
2. The service token (9.4) verifies against a key the receiver already holds for its `iss`, its `aud` is this endpoint, it is current, and its `jti` was not seen before.
3. The receiver recognises the calling service. Which services it recognises is its own policy, and steps from any other service MUST NOT resolve as **auto** (rule 12).
4. The step is valid (section 4) and its `sig` verifies against a key of the same issuer as the service token.
5. The calling service holds the right to speak for `by.address`: shown by presence it sent in authenticated mail (section 3.2), by the talk's opening email, or by a delegation of the address's domain (section 3.3).
6. Rule 1 holds: the step continues a talk the receiving address is already a party to with that author, or it is an ask to an address that keeps an open door, or its person holds an allowance for the author.
7. The step is fresh (rule 15) and within the turn limit (rule 9).

A receiver SHOULD publish the rules by which it recognises services, and MAY publish the list of services it recognises at `https://<issuer>/.well-known/agent-talk-services.json`:

```json
{
    "v": 1,
    "rules": "How this service decides whom it recognises, in plain words.",
    "services": [{ "issuer": "south.example", "state": "recognised", "since": "2026-11-20T09:00:00.000Z" }]
}
```

`state` is `recognised`, `suspended` or `revoked`. A suspended or revoked service's mail is read as plain mail and its direct steps are refused.

### 9.4 Service authentication

A service calls another's A2A endpoint with `Authorization: Bearer <service token>`. The service token is a compact JWS signed with a key from the caller's key set (section 3.4): protected header `alg: "EdDSA"`, `kid`, `typ: "JWT"`, and the claims:

```json
{
    "iss": "north.example",
    "aud": "https://api.south.example/a2a",
    "iat": 1795000000,
    "exp": 1795000300,
    "jti": "5b1c0e9e-6c1f-4f0e-9b7a-2f0c3c1d9a11"
}
```

- `aud` is the exact A2A endpoint URL the token is sent to.
- `exp` is at most 5 minutes after `iat`. `iat` MUST NOT be more than 5 minutes ahead of the receiver's clock.
- `jti` is 1 to 128 characters. The receiver MUST remember it until `exp` and refuse a token it has seen.

There is no shared secret, no handshake and no per-peer credential: the receiver already holds the caller's keys because it recognised the caller.

### 9.5 Methods

| A2A method                                                    | Use                                                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `SendMessage`                                                 | Every step. The one way a step leaves a service directly                                        |
| `GetTask`                                                     | The sender reads an ask's task as the receiver holds it. Never needed for correctness           |
| `CancelTask`                                                  | Not used: it cannot carry a signed step. A withdrawal is a `close` step sent with `SendMessage` |
| `SendStreamingMessage`, `SubscribeToTask`, push notifications | Not used in this version                                                                        |

**Results of `SendMessage`.** For an ask, the receiver returns the `Task` it opened (`id` is the ask's id, state `TASK_STATE_SUBMITTED`). For a step on a task the receiver holds, it returns that task in its new state. For any other step it returns an acknowledging `Message` in the context.

**`GetTask`.** The receiver returns the ask's task with the state of section 9.2. When the ask is answered, the task's one artifact holds the answer: a text part with its `text` and a data part with `{ "v": 1, "step": … }`, the signed answer whole. The asker verifies that step like any other. A receiver answers `GetTask` only for an ask the calling service sent, and answers any other id with the uniform refusal.

**Each service is server and client.** A step always travels from its author's service to the other side's, by `SendMessage`. An answer goes from the answerer's service to the asker's the same way an ask went the other way.

### 9.6 Errors and the uniform refusal

A receiver checks, in this order, before it reads anything else:

1. `A2A-Version` is `1.0`. Otherwise JSON-RPC error `-32009` (`VersionNotSupportedError`). An absent header means A2A 0.3, which this binding does not speak.
2. `A2A-Extensions` names `https://www.input.so/agent-talk/v1`. Otherwise `-32008` (`ExtensionSupportRequiredError`).

A response echoes `A2A-Extensions`. A request body over 64 KiB is refused before it is parsed.

After those two checks, a receiver answers every step it does not take with one response, whatever the reason: an unknown address, no allowance, a service it does not recognise, a bad signature or token, a replay, a stale step, the turn limit:

```json
{ "jsonrpc": "2.0", "id": "1", "error": { "code": -32004, "message": "Not accepted" } }
```

The response SHOULD take the same time whatever the reason (for example, padded to a fixed floor), so nothing is learned by asking. A sender MUST NOT fall back to email for an agent's step after the uniform refusal: the receiver said no, and email would be the same step past a no (rule 19).

## 10. Web link binding

For a person with no agent:

- The web card shows only what the opening email says.
- An answer given there is recorded with `via: "link"`, takes effect at most once, and only ever involves addresses in `parties`.
- Asks with `needs` other than `calendar.freeBusy` and `calendar.book`, and open asks, SHOULD confirm the address before accepting an answer.
- The link stops working when the ask expires.
- The same URL serves the markdown and JSON views (section 8.5); each shows only what the opening email says.

## 11. Security considerations

- **Identity** is as strong as the sender's mail domain authentication, the same as for a password reset by email.
- **Spoofed presence** is contained by the DMARC-aligned check (3.2) and by the confirm-on-change rule.
- **Copied tokens**: a presence token must match From; a talk token grants nothing without host membership.
- **Fetches on arrival** (rule 22): a sender can make every link, key location and service domain unique per recipient, so any fetch its message sets off tells it which address is live, that an agent reads that address, and when the mail arrived. Those addresses are the best targets for injected instructions. The step travels in the email for this reason, and a stranger's message sets off no fetch at all. Delegations are looked up on a schedule for the same reason.
- **The block** is the sender's data inside the sender's email and adds no authority the email lacks. It counts only with a talk token bound to From, on authenticated mail, with the step signed by the same service. A block copied into another sender's mail fails the From check. A quoted or forwarded block names another step or another Message-ID, and a step already held is ignored. A step delivered in a block cannot change afterwards, which one behind a link can.
- **Stripped blocks**: a security gateway may remove script elements. The message then falls back to its header and link.
- **`about`** is data from the sender (rule 4). A receiver never fetches what it names and never carries out an action inside it.
- **Forwarded mail and links**: the link shows what the email already says; answers involve only `parties`, once, before expiry.
- **Prompt injection**: rule 4, the boundary (rule 5), constrained answers (rule 6), and lines 3 and 4 of the card drawn from structure. Implementations SHOULD read the other side's text with a model that holds no tools, and pass on only structured results.
- **Enumeration**: no lookup (3.2), one refusal for unknown and unauthorised (9.6), one response for every address without an open door (9.1), no read receipts (rule 10), no fetch on arrival (rule 22). Allowances never travel.
- **Amplification and loops**: first contact rides on email; the turn limit (rule 9).
- **Diverging conversations**: the email thread and the talk can drift apart; rule 17 makes the person's message the one that counts.
- **Stale trust**: an allowance can outlive the person behind an address. Services SHOULD let unused allowances lapse and suspend them when the address fails mail authentication or changes service.
- **Replay**: direct steps must be fresh and unique (rule 15); service tokens are bound to one endpoint, live 5 minutes and are taken once (9.4); agents stop answering at `autoUntil`; talk tokens expire with their ask.
- **Delegated tool use**: a party's text could try to steer the other agent's tools. Rule 16 bounds it: a grant names one tool and read or write, destructive calls always need the person, and the asker only ever receives the answer.
- **Introductions** can be used to pose as a mutual contact. The ask comes from the introducer's own authenticated address, only the person answers it, the email that follows is the introducer's own, and it gives no allowance (rule 14).
- **Requests for allowances** invite social engineering. Rule 21 bounds them: three narrow scopes, the person alone answers, and the card states each scope in the receiver's own words. Services SHOULD limit how often one party may ask.
- **Recognition**: signatures prove which service spoke, not that it behaves. Each service keeps its own list of services it recognises and can drop one. Services SHOULD track how a recognised service behaves (bad signatures, replays, steps held as suspicious, asks declined or left to expire) and narrow what its direct steps may do, never widen what a person allowed. Signals anyone could forge, such as an unknown `kid` or a bad token in mail, SHOULD NOT count against a service.
- **Delegated domains**: an expired domain or a DNS takeover could hand a domain's addresses to a new service. Receivers re-check delegations on a schedule; a record that moves to another service ends the old delegation at once.
- **The markdown view** is read by other parties' models: it quotes the asker's text on single lines with markup escaped, and says that quoted text is not instructions. Ids, types, scopes and addresses are escaped too, and the grammar of section 4.2 keeps markup out of them in the first place.
- **Hostile steps**: a receiver validates before it verifies. Sizes, nesting and name grammar are bounded (section 4.2), a time has to exist, and a step that cannot be put in canonical form counts as unsigned. Fetches a service makes on its own schedule (cards, key sets, delegation files) SHOULD use HTTPS only, public addresses only, no redirects, a size cap and a timeout.
- **Account takeover**: equivalent to email today. Implementations SHOULD keep standing allowances narrow and visible.
- **Confidentiality**: services read steps in the clear because they run the agents. End-to-end encryption is out of scope for version 1.

## 12. Versioning

- `v` is an integer. Additive fields do not change it; receivers MUST ignore unknown fields.
- New step types and value types are additive and fall back to `text`.
- A change in meaning of an existing field bumps `v` and the extension URI (`…/v2`).
- A block carries its own `v`. A receiver ignores a block whose `v` it does not know.

## 13. IANA considerations

This draft intends to request:

- **Media type** `application/agent-talk+json` (RFC 6838), for the step block, the JSON view behind a talk link, and A2A data parts. Until registered, implementations use it as written.
- **Well-known URIs** (RFC 8615): `agent-talk.json` (section 3.3), `agent-talk-keys.json` (section 3.4) and `agent-talk-services.json` (section 9.3).
- **Underscored DNS node name** (RFC 8552): `_agent-talk`, RR type TXT (section 3.3).
- **Message header fields** (RFC 3864, provisional): `X-Agent-Talk` and `X-Agent-Talk-Link`, kept with the `X-` prefix for the reason in section 8.1.

## 14. Open issues

- What a receiver does with an `effect`, `via`, `reason` or `result` value it does not know: fall back to `text` and to the person, or refuse the step.
- Whether a counter should also move the task of the ask it replaces to `TASK_STATE_INPUT_REQUIRED`, rather than leaving that task as it was.
- Content negotiation for the link (8.5): which agents read the markdown view in practice.
- Talks with more than two parties.

## 15. References

- RFC 2119, RFC 8174: requirement levels.
- RFC 3339: timestamps. RFC 5322: email messages. RFC 2369: list header fields. RFC 5546: iTIP.
- RFC 7515: JSON Web Signature. RFC 7517: JSON Web Key. RFC 7519: JSON Web Token. RFC 8037: EdDSA in JOSE. RFC 8785: JSON Canonicalization Scheme.
- RFC 6570: URI templates. RFC 8615: well-known URIs. RFC 8552: underscored DNS names. RFC 6838: media types.
- DMARC: RFC 7489. Authentication-Results: RFC 8601.
- A2A Protocol 1.0: https://a2a-protocol.org
- schema.org: https://schema.org

## Appendix A. Scheduling, end to end (informative)

Sam, on `north.example`, wants a meeting with Maya, on `south.example`. Neither has written to the other before.

1. Sam's agent drafts an ask: `question: "Which time works for a call next week?"`, three `time` options, `effect: "event"`, `needs: ["calendar.freeBusy"]`, `answerBy: "personOrAgent"`. Sam approves it, so `by.actor` is `"person"`.
2. North sends Sam's email. It says the same in words, carries `X-Agent-Talk: v=1; p=…; t=…`, the step block, and a link to `https://north.example/t/<token>` in the disclosure line.
3. South receives it. DMARC passes for Sam's domain, the presence token's `sub` matches From, and south already recognises north and holds its keys. The block counts: the talk token names this talk and step, the step's `by.address` is Sam, and its `sig` verifies. South fetches nothing.
4. Maya has not given Sam's address any allowance, so this is Maya's move (rule 6). South shows her the card: Sam asks, line 3 says "Answering shares when you are free", line 4 says "A yes sends a calendar invite". Her own agent adds a note: Thursday clashes with a dentist appointment. The note is never sent.
5. Maya picks Friday. South signs an answer with `actor: "person"`, `picks: ["fri"]`, and, because both services speak A2A, sends it to north's endpoint with `SendMessage` and `referenceTaskIds: ["<ask id>"]`. Maya's reply email goes too, carrying the same answer in its block. North takes the step once, whichever arrives first.
6. North judges the answer on its own clock: signed and before `autoUntil`, so **auto** (rule 12). It sends the invite and adds a `close` with `reason: "done"` and the event in `outcome`.

## Appendix B. A question to a support desk (informative)

`support@shop.example` keeps an open door through `desk.example`. `shop.example` publishes `_agent-talk.shop.example. TXT "v=1; svc=desk.example"`.

1. Maya's agent wants to know where order 1042 is. South already recognises `desk.example` and checked the delegation on its daily schedule. The per-address card for `support@shop.example` lists the skill `order-status`.
2. Maya's agent asks directly: `SendMessage` to the desk's endpoint with a service token, the signed ask in a data part, `about: { "@type": "Order", "orderNumber": "1042" }`, `answerBy: "personOrAgent"`, and no options: an open ask. Admission passes rule 1 because the address keeps an open door.
3. The desk's agent answers in words inside its own boundary: the order data the desk holds for Maya's address. South shows the answer to Maya with `via` absent and `by.actor: "agent"`, so she sees the desk's agent wrote it.
4. Had the desk refused, south would have received the uniform refusal and nothing else, and would not fall back to email for an agent's step.

## Appendix C. Conformance

A **sending service** conforms when it:

- signs presence tokens, talk tokens and steps as in sections 3.1, 8.2 and 4.2, and publishes its keys (3.4)
- carries the header, the block and the link as in section 8, with the escaping of 8.6
- never marks an agent's step as a person's (rule 3), and keeps the turn limit (rule 9)

A **receiving service** conforms when it:

- counts presence, tokens and blocks only under the checks of sections 3.2, 8.2 and 8.6
- validates before it verifies, and shows unknown types by their `text`
- fetches nothing because a message arrived (rule 22)
- draws card lines 3 and 4 from structure (section 6) and leaves an ask to the person unless rule 6 holds

A **host** additionally assigns `seq`, judges answers by rule 12, and refuses steps past the turn limit.

A service that speaks the **A2A binding** additionally follows section 9: a signed card, service tokens, the admission order, and the uniform refusal.

The test vectors published with this document exercise the checks above. The reference implementation passes all of them.
