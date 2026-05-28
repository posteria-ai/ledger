# @posteria/observer

An open-source, identity-function boundary observer for AI agents. Observer
intercepts agent I/O at the call boundary, writes a VDC-shaped audit record
to a local append-only file, and returns the call unchanged. It does not
evaluate policy. It does not block, redact, or modify anything.

**Status:** pre-v0.1.0. Runtime ships with v0.1.0.

**License:** MIT.

## What Observer is

Observer is the open-source subset of Posteria. It records what agents do at
the call boundary, in a record shape that is forward-compatible with
Posteria's commercial policy engine but does not require it.

- **Decision function:** identity. Every intercepted call → `allow` + a
  recorded audit record. No payload mutation, ever.
- **Audit stream:** local, append-only, newline-delimited JSON.
- **VDC envelope:** advisory in v0.1. Mandate / issuer / subject / claims
  are caller-supplied and emitted byte-for-byte. v0.1 does not attest, sign,
  or anchor anything.
- **Self-hosted:** Observer runs entirely in your process. No network calls.
  No remote dependencies at runtime.

## What Observer is not

Observer is deliberately not a policy engine. It does not:

- Evaluate constitutions, mandates, or rules.
- Block, refuse, redact, or modify calls.
- Mint, sign, or attest VDCs.
- Open network sockets or transmit any audit content off-host.
- Grant interoperability with, or licensed use of, Posteria's commercial
  policy engine, mandate issuance surface, constitution interpreter, or
  server.

For the explicit non-claims list, see `LIMITATIONS.md` (ships with v0.1.0).

## Install

Not yet published. Once v0.1.0 ships:

```sh
npm install @posteria/observer
```

Published under the `@posteria` npm scope. Runtime targets Node.js (current
LTS at v0.1 cut). Browser / edge runtimes are out of scope for v0.1.

## Configuration

Configuration precedence (later wins):

1. Programmatic constructor options (library use).
2. Environment variables prefixed `POSTERIA_OBSERVER_*`.
3. CLI flags (CLI use).

| Knob | Type | Default | Notes |
| --- | --- | --- | --- |
| `audit_stream_path` | string (path) | `./posteria-observer-audit.jsonl` | Local append-only file. Parent directory must exist; Observer does NOT auto-create. |
| `enable_anon_telemetry` | boolean | `false` | When `true`, engages the no-op telemetry stub (see below). |
| `host_metadata` | object | `{}` | Optional per-installation labels. |

Unknown configuration keys produce a startup warning but do not prevent
startup.

## Telemetry

**Design choice: no-op opt-in stub, default-off.** Observer ships into a
buyer reflex that assumes any new agent-safety library calls home. The only
design that gets installed is one that doesn't. The flag is default-off,
opt-in by an explicit configuration value, and even when set the v0.1 stub
transmits nothing. Shipping the opt-in flag and the future-fields
documentation in v0.1 — rather than introducing telemetry later as a "new"
feature — means a future v0.2 enabling telemetry is a documented
continuation of an opt-in surface operators already saw at install time,
not a surprise addition.

**v0.1 transmits nothing.** The telemetry stub is a no-op in v0.1
regardless of the `enable_anon_telemetry` flag. The flag exists to surface
the future behavior to users at install time.

When a future v0.2+ enables non-no-op telemetry, it will require a spec
amendment and either a major-version bump or an explicit migration note.
v0.1 will not be silently upgraded into a network-emitting build.

### Future v0.2 transmitted-field list (informational, v0.1 transmits NONE)

If a future v0.2 enables non-no-op telemetry, the following fields are the
*candidate* surface — documented now so users can audit it before opting in:

- `observer_version` — the `@posteria/observer` package version.
- `record_count_since_last_ping` — count of records written since the
  previous telemetry ping.
- `host_metadata` — exactly the operator-supplied object from
  configuration; no augmentation.
- `runtime` — coarse runtime identifier (e.g. `"node-20"`).
- `os_family` — coarse OS family identifier (e.g. `"darwin"`, `"linux"`).

Explicit non-fields — v0.2 telemetry will NOT transmit:

- Any audit record body content.
- Any caller-supplied VDC field (`mandate_id`, `issuer`, `subject`,
  `claims`).
- Any `action_signature` value.
- Any host PII, user identifiers, IP addresses, or hostnames.
- Any reserved `posteria_*` or namespaced `x-<orgslug>-*` extension fields.

If v0.2 ships, this list is binding. If v0.2 needs to add a field, that
addition requires a spec amendment.

## Audit record shape (v0.1)

Each record is a single JSON object with the following required fields:

| Field | Type | Notes |
| --- | --- | --- |
| `record_version` | string | Strict SemVer. v0.1 emits `"0.1.0"`. |
| `record_id` | string | Unique within the audit stream. |
| `recorded_at` | string (RFC 3339) | UTC timestamp. |
| `action_kind` | string | Short label (e.g. `"tool_call"`). |
| `action_signature` | string | Stable normalized representation. MUST NOT contain user secrets. |
| `vdc` | object | Advisory in v0.1. Four fields: `mandate_id`, `issuer`, `subject`, `claims`. |
| `decision` | string | Always `"allow"` in v0.1. |
| `decision_reason` | string | Always `"observer_short_circuit"` in v0.1. |
| `observer_version` | string | Package version that wrote the record. |
| `host_metadata` | object (optional) | Per-installation labels. MUST NOT contain PII. |

The full record-shape contract, including extension hooks, reserved
namespaces, and producer/reader/validator role obligations, ships with the
v0.1.0 release.

## Contributing

See `CONTRIBUTING.md`.

## Relationship to commercial Posteria

Observer is the open carve-out of Posteria. The commercial surface — policy
engine, constitution interpreter, mandate issuance, VDC attestation, server —
is not open-sourced and is not licensed via this repository. Audit records
produced by Observer are MIT-licensed; consuming them with the commercial
Posteria server is a separate commercial relationship.
