# Security

Agent Talk is a security-sensitive protocol: it decides when one person's agent may act on another person's message. We take reports seriously.

## Reporting a vulnerability

Report privately through GitHub's **Report a vulnerability** button on this repository's Security tab. Please do not open a public issue for a security problem.

Include what you found, how to reproduce it, and whether it affects the protocol itself (the specification in `spec/`) or the reference implementation (`src/`). We acknowledge reports within three working days.

## Scope

- The specification: anything that lets a sender learn who reads its mail, make an agent act without its person, enumerate who has an agent, forge or replay a step, or widen what a person allowed.
- The reference implementation: validation, signing and verifying, token checks, the email block reader, the A2A helpers.

Services built on the protocol, including Input's, have their own disclosure process.
