# Conformance Suite

This directory holds the v0.1 conformance acceptance suite for
`@posteria/ledger`. The suite has landed.

It is the canonical validator of the producer-side obligations in
`docs/contract/v0.1.md` (see §"Conformance Test Expectations"). Each contract
clause maps to one named test, so a failing test name states the violated
clause directly.

## Running

```
npm run conformance
```

Conformance files use the `.conformance.ts` suffix (not `.test.ts`), so they
run separately from `npm test`: the unit-test glob
(`find .test-dist/test -name '*.test.js'`) does not pick them up, and CI runs
`npm run conformance` as a distinct step on Node 20 and 22.

## Scenarios

`v0.1.conformance.ts` covers the six clauses:

1. **Identity-function decision behavior** — every well-formed input returns
   `allow` + `ledger_short_circuit`, with zero caller-payload mutation, and
   exactly N records recorded.
2. **Audit-stream record shape** — every emitted record carries the required
   fields with pinned literals, a four-field `vdc` envelope (plus `x-*` only),
   and no reserved field at any depth.
3. **Producer-side reserved/unrecognized-field rejection** — each reserved
   `posteria_*` top-level field, each reserved `vdc.*` field, any unrecognized
   non-namespaced field (top level or `vdc`), and a malformed pseudo-namespace
   (`x-acmeco` with no suffix) all make `record()` throw and emit no record; a
   valid `x-<orgslug>-*` extension is accepted (positive control).
4. **Telemetry-stub no-op** — with `enable_anon_telemetry: true` and the real
   stub, no network primitive is invoked, including DNS named imports captured
   before the conformance test module loads.
5. **Append-only semantics under SIGHUP** — after external rotation and a real
   SIGHUP-driven re-open, the rotated file and the recreated path together hold
   all records, on distinct inodes.
6. **Unknown configuration key** — an unrecognized key warns, it does not fail.
