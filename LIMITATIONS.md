# LIMITATIONS — what `@posteria/ledger` and Posteria do NOT do

This document is the explicit non-claims surface for `@posteria/ledger` (the
open-source subset) and for Posteria more broadly. It exists so that adopters,
reviewers, and downstream agents can rely on a bounded, honest description of
scope. Where marketing copy and this file disagree, **this file governs.**

## What Posteria governs

Posteria governs the **I/O boundary of agent actions** — the point where an
agent's proposed action crosses into the outside world — via mandates and
Verifiable Digital Credentials (VDCs) in AP2 vocabulary. The boundary crossing
is structured, recordable, and (in the commercial engine) policy-evaluable and
attestable.

## What Posteria does NOT govern

Posteria does not govern, inspect, or make claims about:

- **Model cognition** — the agent's internal reasoning, chain-of-thought, or
  intermediate computation.
- **Hidden intent or deception** — Posteria does not detect lying, scheming,
  motivated reasoning, or concealed goals. It observes effects at the boundary,
  not minds.
- **Prompt content semantics** — it does not interpret what a prompt "means."
- **Agent internal state** — memory, scratchpads, and in-sandbox compute are
  outside the boundary and outside scope.

If an agent does something harmful entirely within its own reasoning or its
sandbox, without crossing the I/O boundary, Posteria neither sees nor governs it.

## The "agent debt" slice Posteria addresses

"Agent debt" (per practitioner usage) spans prompt conflict, memory pollution,
tool overlap, and audit-trail gaps. **Posteria addresses ONLY the audit-trail
slice** — boundary-enforced policy decisions, mandate issuance, and the VDC
chain. It does **not** address prompt conflict, memory pollution, or tool
overlap, and must not be described as doing so.

## `@posteria/ledger` (OSS subset) — specific non-claims

Ledger is a read-only boundary recorder. Specifically, Ledger:

- **Evaluates no policy.** Its decision function is the identity function. Every
  intercepted call short-circuits to `allow` — a structural signal that the
  boundary recorded the crossing, **not** a policy verdict.
- **Blocks, redacts, or modifies nothing.** It never alters the request payload
  or any downstream response.
- **Is not an observability or monitoring product.** It does **not** detect,
  classify, score, trend, or alert on agent failures (loops, hallucinations,
  tool errors, refusals, drift), and it ships no dashboard. It records the
  boundary crossing; judging it is an observability concern Ledger leaves to
  monitoring tools.
- **Detects no deception, no model cognition, no hidden intent.**
- **Is not a policy engine, constitution interpreter, mandate issuer, or
  AP2/VDC attestation provider.** The VDC envelope in v0.1 is advisory: mandate
  / issuer / subject / claims are caller-supplied and emitted byte-for-byte.
  v0.1 does not sign, attest, or anchor anything.
- **Is local-first and append-only.** It does not exfiltrate, transmit, or
  remote-store records by default. The opt-in telemetry stub is a no-op in v0.1.
- **Is not a Posteria server replacement.** Adopting Ledger grants no rights to,
  and no interoperability with, the closed Posteria policy engine, AP2/VDC
  primitives, or commercial server.

## Non-claims about regulatory / compliance posture

Posteria leads with engineering, not regulatory claims. At this stage Posteria
makes **no claim** of regulatory certification, formal compliance audit, or
legal sufficiency for any regime. Any future certification will be
substantiated and dated, not asserted. Do not represent Ledger or Posteria as
satisfying a compliance obligation it has not demonstrably met.

## A note on the name

This package was previously named `@posteria/observer`. It was renamed to
`@posteria/ledger` to make the scope honest: it produces an open, append-only
**record** of boundary crossings — it is not an "observability" product. The
v0.1 record-shape fields `observer_version` and the `decision_reason` value
`"observer_short_circuit"` retain their original names for record-reader
stability; everything else uses the `ledger` name.
