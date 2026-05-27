# Conformance Suite

This directory holds the v0.1 conformance acceptance suite for
`@posteria/observer`. The full suite lands with task **OM003** (runtime
implementation + v0.1.0 publish).

Per `specs/007-observer-mode-and-positioning/contracts/observer-api.md` §"Conformance Test Expectations",
a conforming v0.1 implementation MUST pass tests covering:

- Identity-function decision behavior (every input → `allow` + recorded
  record; no payload mutation).
- Audit-stream record shape validation against the v0.1 contract.
- Reserved-field enforcement (a v0.1 producer that emits any reserved
  `posteria_*` field is non-conforming).
- Telemetry-stub no-op verification (no network sockets opened, even with
  `enable_anon_telemetry: true`).
- Append-only semantics under SIGHUP / equivalent rotation events.
- Unknown configuration key → warning, not failure.

This README is a placeholder so the directory exists in the scaffolding
commit (OM002). The implementations land under OM003.
