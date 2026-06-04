# @posteria/ledger

An open-source, **append-only record of what crosses an AI agent's I/O
boundary**. Ledger sits at the call boundary, writes a VDC-shaped audit
record to a local append-only file, and returns the call unchanged — the
identity function. It does not evaluate policy, and it does not block,
redact, or modify anything.

Ledger is **not** an observability or monitoring product. It does not detect
failures, analyze, trend, score, or alert, and it ships no dashboard. It is
the open, portable **record format** — and a reference implementation of
boundary observation as a *practice* — that Posteria's commercial policy
engine builds enforcement and attestation on top of. If you want detection,
analytics, or alerting, use a monitoring tool; Ledger is the record, not the
monitor.

**Status:** v0.1.0.

**License:** MIT.

## What Ledger is

Ledger is the open-source subset of Posteria. It emits a verifiable, portable
record at the I/O boundary — in the shape Posteria's commercial policy engine
consumes — without requiring that engine. Three roles:

1. **The record format** — an open, append-only VDC-shaped audit stream you own.
2. **The practice** — a reference implementation of observing the I/O boundary
   (the open methodology), distinct from the closed engine that enforces on it.
3. **The on-ramp** — the record an enforce-and-attest layer plugs into later.
   What it records today is forward-compatible with that engine; adopting Ledger
   grants no rights to or interoperability with it.

- **Decision function:** identity. Every intercepted call → `allow` + a
  recorded audit record. No payload mutation, ever.
- **Audit stream:** local, append-only, newline-delimited JSON.
- **VDC envelope:** advisory in v0.1. Mandate / issuer / subject / claims
  are caller-supplied and emitted byte-for-byte. v0.1 does not attest, sign,
  or anchor anything.
- **Self-hosted:** Ledger runs entirely in your process. No network calls.
  No remote dependencies at runtime.

## What Ledger is not

Ledger is deliberately not a policy engine, and not an observability product.
It does not:

- Evaluate constitutions, mandates, or rules.
- Block, refuse, redact, or modify calls.
- Mint, sign, or attest VDCs.
- **Detect, classify, score, or alert on agent failures** (loops, hallucinations,
  tool errors, refusals, drift). It records the boundary crossing; it does not
  judge it. Detection and analytics are an observability concern Ledger leaves to
  monitoring tools.
- Open network sockets or transmit any audit content off-host.
- Grant interoperability with, or licensed use of, Posteria's commercial
  policy engine, mandate issuance surface, constitution interpreter, or
  server.

For the explicit non-claims list, see `LIMITATIONS.md`.

## Install

```sh
npm install @posteria/ledger
```

Published under the `@posteria` npm scope. Runtime targets Node.js 20+ LTS,
ESM-only. Browser / edge runtimes are out of scope for v0.1.

## Quick start

The default configuration writes to `./posteria-ledger-audit.jsonl`, whose
parent directory is the current working directory and already exists in a
normal project.

```ts
import {
  createLedger,
  type AuditAction,
  type LedgerDecision,
} from "@posteria/ledger";

const ledger = createLedger();

const action: AuditAction = {
  action_kind: "tool_call",
  action_signature: "tool:get_weather(location_type)",
  vdc: {
    mandate_id: "support-agent-v1",
    issuer: "posteria-demo",
    subject: "weather-tool",
    claims: {
      tool_name: "get_weather",
      location_type: "city",
    },
  },
};

const decision: LedgerDecision = ledger.record(action);
console.log(decision);

await ledger.close();

/*
Expected decision:
{ decision: "allow", decision_reason: "ledger_short_circuit" }

Example posteria-ledger-audit.jsonl line:
record_id and recorded_at are illustrative; each run produces new values.
{"record_version":"0.1.0","record_id":"7f9d0f35-1a1c-4ef4-97e4-0f4b2b7e8f54","recorded_at":"2026-06-04T18:24:11.000Z","action_kind":"tool_call","action_signature":"tool:get_weather(location_type)","vdc":{"mandate_id":"support-agent-v1","issuer":"posteria-demo","subject":"weather-tool","claims":{"tool_name":"get_weather","location_type":"city"}},"decision":"allow","decision_reason":"ledger_short_circuit","ledger_version":"0.1.1"}
*/
```

For JavaScript-only projects, omit the type imports:

```js
import { createLedger } from "@posteria/ledger";

const ledger = createLedger();

const decision = ledger.record({
  action_kind: "tool_call",
  action_signature: "tool:send_support_reply(template_id)",
  vdc: {
    mandate_id: "support-agent-v1",
    issuer: "posteria-demo",
    subject: "support-reply-tool",
    claims: {
      tool_name: "send_support_reply",
      template_id: "shipping-delay",
    },
  },
});

console.log(decision);
await ledger.close();
```

`action_signature` must be a stable, normalized representation of the action
and must not contain user secrets. `record()` accepts only documented v0.1
fields plus `x-<orgslug>-*` extensions; if callers build action descriptors
from untrusted input, wrap `record()` because reserved or unrecognized
non-namespaced fields throw and emit no audit record.

Ledger is meant to sit at the call boundary. In practice, record the boundary
event next to the observed tool or model call, not in a separate background
path.

```js
import { mkdir } from "node:fs/promises";

import { createLedger } from "@posteria/ledger";

await mkdir("./audit", { recursive: true });

const ledger = createLedger({
  audit_stream_path: "./audit/tool-boundary.jsonl",
});

async function callShippingTool({ orderId, destinationRegion }) {
  return {
    orderId,
    destinationRegion,
    etaDays: 3,
  };
}

try {
  ledger.record({
    action_kind: "tool_call",
    action_signature: "tool:get_shipping_eta(destination_region)",
    vdc: {
      mandate_id: "support-agent-v1",
      issuer: "posteria-demo",
      subject: "shipping-tool",
      claims: {
        tool_name: "get_shipping_eta",
        destination_region: "us-midwest",
      },
    },
  });

  const result = await callShippingTool({
    orderId: "order-123",
    destinationRegion: "us-midwest",
  });
  console.log(result);
} finally {
  await ledger.close();
}
```

Call `close()` during graceful shutdown so queued fire-and-forget records are
flushed and fsynced before the process exits.

```js
import { mkdir } from "node:fs/promises";

import { createLedger } from "@posteria/ledger";

await mkdir("./audit", { recursive: true });

const ledger = createLedger({
  audit_stream_path: "./audit/shutdown.jsonl",
});

// Keep the process alive so SIGINT/SIGTERM has something to interrupt.
const keepAlive = setInterval(() => {}, 1000);
let closing = false;

async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(keepAlive);
  await ledger.close();
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("beforeExit", () => {
  void shutdown();
});

ledger.record({
  action_kind: "tool_call",
  action_signature: "tool:prepare_invoice(invoice_shape)",
  vdc: {
    mandate_id: "billing-agent-v1",
    issuer: "posteria-demo",
    subject: "invoice-tool",
    claims: {
      tool_name: "prepare_invoice",
      invoice_shape: "summary",
    },
  },
});
```

## Configuration

Configuration precedence (later wins):

1. Programmatic constructor options (library use).
2. Environment variables prefixed `POSTERIA_LEDGER_*`.
3. CLI flags (CLI use).

<!-- markdownlint-disable MD013 -->

| Knob | Type | Default | Notes |
| --- | --- | --- | --- |
| `audit_stream_path` | string (path) | `./posteria-ledger-audit.jsonl` | Local append-only file. Parent directory must exist; Ledger does NOT auto-create. |
| `enable_anon_telemetry` | boolean | `false` | When `true`, engages the no-op telemetry stub (see below). |
| `host_metadata` | object | `{}` | Optional per-installation labels. |

<!-- markdownlint-enable MD013 -->

Unknown configuration keys produce a startup warning but do not prevent
startup.

Programmatic configuration can customize all three knobs:

```js
import { mkdir } from "node:fs/promises";

import { createLedger } from "@posteria/ledger";

await mkdir("./audit", { recursive: true });

const ledger = createLedger({
  audit_stream_path: "./audit/programmatic.jsonl",
  enable_anon_telemetry: true,
  host_metadata: {
    service: "support-agent",
    environment: "development",
  },
});

ledger.record({
  action_kind: "tool_call",
  action_signature: "tool:classify_ticket(ticket_shape)",
  vdc: {
    mandate_id: "support-agent-v1",
    issuer: "posteria-demo",
    subject: "classifier-tool",
    claims: {
      tool_name: "classify_ticket",
      ticket_shape: "subject_and_priority",
    },
  },
});

await ledger.close();
```

`enable_anon_telemetry: true` is a no-op in v0.1. It transmits nothing today;
the flag only exposes the future opt-in surface. See [Telemetry](#telemetry)
for the v0.1 design.

The same knobs can be set through `POSTERIA_LEDGER_*` environment variables:

```js
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { createLedger } from "@posteria/ledger";

const auditPath =
  process.env.POSTERIA_LEDGER_AUDIT_STREAM_PATH ??
  "./posteria-ledger-audit.jsonl";

await mkdir(dirname(auditPath), { recursive: true });

// createLedger() reads POSTERIA_LEDGER_* on its own; auditPath is only
// needed here to pre-create the parent directory.
const ledger = createLedger();

ledger.record({
  action_kind: "tool_call",
  action_signature: "tool:route_ticket(queue_shape)",
  vdc: {
    mandate_id: "support-agent-v1",
    issuer: "posteria-demo",
    subject: "router-tool",
    claims: {
      tool_name: "route_ticket",
      queue_shape: "region_and_priority",
    },
  },
});

await ledger.close();
```

```sh
POSTERIA_LEDGER_AUDIT_STREAM_PATH=./audit/from-env.jsonl \
POSTERIA_LEDGER_ENABLE_ANON_TELEMETRY=true \
POSTERIA_LEDGER_HOST_METADATA='{"service":"support","env":"dev"}' \
node configured-from-env.js
```

## Telemetry

**Design choice: no-op opt-in stub, default-off.** Ledger ships into a
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

- `ledger_version` — the `@posteria/ledger` package version.
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

<!-- markdownlint-disable MD013 -->

| Field | Type | Notes |
| --- | --- | --- |
| `record_version` | string | Strict SemVer. v0.1 emits `"0.1.0"`. |
| `record_id` | string | Unique within the audit stream. |
| `recorded_at` | string (RFC 3339) | UTC timestamp. |
| `action_kind` | string | Short label (e.g. `"tool_call"`). |
| `action_signature` | string | Stable normalized representation. MUST NOT contain user secrets. |
| `vdc` | object | Advisory in v0.1. Four fields: `mandate_id`, `issuer`, `subject`, `claims`. |
| `decision` | string | Always `"allow"` in v0.1. |
| `decision_reason` | string | Always `"ledger_short_circuit"` in v0.1. |
| `ledger_version` | string | Package version that wrote the record. |
| `host_metadata` | object (optional) | Per-installation labels. MUST NOT contain PII. |

<!-- markdownlint-enable MD013 -->

The full record-shape contract, including extension hooks, reserved
namespaces, and producer/reader/validator role obligations, ships with the
v0.1.0 release.

### Reserved fields

`record()` accepts only documented v0.1 fields plus `x-<orgslug>-*`
extensions. If runtime input contains reserved or unrecognized non-namespaced
fields, `record()` **throws and emits no audit record**. This applies to:

- the six reserved top-level `posteria_*` fields (`posteria_attestation`,
  `posteria_signature`, `posteria_signed_at`, `posteria_policy_digest`,
  `posteria_linkage`, `posteria_extension_profiles`);
- the five reserved `vdc.*` fields (`attestation`, `signature`,
  `signature_algorithm`, `attested_at`, `verifier_id`);
- any unrecognized non-namespaced field (e.g. `arbitrary_key`); and
- malformed pseudo-namespaces such as `x-acmeco` with no suffix.

Stripping such fields would keep the emitted record conforming, but it would
silently hide a caller bug and lose data. The runtime guard instead surfaces
that the caller tried to produce a non-v0.1 record. This is not policy
blocking — Ledger rejects malformed input *before* it produces an audit
record. For valid inputs, `record()` remains the identity function and
returns `allow`. Well-formed `x-<orgslug>-*` extensions are passed through
unchanged.

## Reliability & durability

`record()` returns its decision synchronously and enqueues the audit
record for writing **fire-and-forget** — file I/O never sits on the hot path
of an observed call. The sink serializes queued records into an append-only
NDJSON stream and flushes them on its own cadence: writes are pumped on the
next microtask tick and consecutive queued records coalesce into a single
append, so a burst of `record()` calls drains in as few syscalls as possible.

**Durability trade-off (v0.1, accepted):** because writes are fire-and-forget,
a hard process crash *between* an `record()` call and the next flush can lose
the in-flight record. `close()` is the deterministic drain primitive — it
flushes the queue and `fsync`s the file, resolving only once every queued
record is durably on disk. Call `close()` on graceful shutdown. Operators who
need stronger per-call durability can wrap `record()` + `close()` themselves;
this is the documented v0.1 trade-off, not a defect.

`close()` is idempotent: a second call is safe and resolves promptly. The sink
also re-opens its file descriptor on `SIGHUP`, so external log-rotation tooling
can rotate the audit stream without losing or misdirecting records.

## Contributing

See `CONTRIBUTING.md`.

## Relationship to commercial Posteria

Ledger is the open carve-out of Posteria. The commercial surface — policy
engine, constitution interpreter, mandate issuance, VDC attestation, server —
is not open-sourced and is not licensed via this repository. Audit records
produced by Ledger are MIT-licensed; consuming them with the commercial
Posteria server is a separate commercial relationship.
