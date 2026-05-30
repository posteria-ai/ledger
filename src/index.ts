import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAuditSink } from "./audit-sink.js";
import { resolveConfig } from "./config.js";
import { emitTelemetryNoop } from "./telemetry.js";

export const RECORD_VERSION = "0.1.0" as const;
export const LEDGER_DECISION = "allow" as const;
export const LEDGER_DECISION_REASON = "observer_short_circuit" as const;
export const DEFAULT_AUDIT_STREAM_PATH =
  "./posteria-ledger-audit.jsonl" as const;

export interface LedgerConfig {
  audit_stream_path: string;
  enable_anon_telemetry: boolean;
  host_metadata: Record<string, unknown>;
}

export interface VdcInput {
  mandate_id?: string | null;
  issuer?: string | null;
  subject?: string | null;
  claims?: Record<string, unknown>;
  [extensionKey: `x-${string}-${string}`]: unknown;
}

export interface VdcEnvelope {
  mandate_id: string | null;
  issuer: string | null;
  subject: string | null;
  claims: Record<string, unknown>;
  [extensionKey: `x-${string}-${string}`]: unknown;
}

export interface AuditAction {
  action_kind: string;
  action_signature: string;
  vdc?: VdcInput;
  [extensionKey: `x-${string}-${string}`]: unknown;
}

export interface AuditRecord {
  record_version: typeof RECORD_VERSION;
  record_id: string;
  recorded_at: string;
  action_kind: string;
  action_signature: string;
  vdc: VdcEnvelope;
  decision: typeof LEDGER_DECISION;
  decision_reason: typeof LEDGER_DECISION_REASON;
  observer_version: string;
  host_metadata?: Record<string, unknown>;
  [extensionKey: `x-${string}-${string}`]: unknown;
}

export interface LedgerDecision {
  decision: typeof LEDGER_DECISION;
  decision_reason: typeof LEDGER_DECISION_REASON;
}

export interface Ledger {
  /** Synchronous identity-function decision. Records an audit entry as a side effect (fire-and-forget; flushed on close()). */
  record(action: AuditAction): LedgerDecision;

  /** Drain pending audit writes and close the underlying sink. Resolves when records are durably on disk. Idempotent. */
  close(): Promise<void>;

  /** Resolved configuration (read-only). */
  readonly config: Readonly<LedgerConfig>;
}

const SHORT_CIRCUIT: LedgerDecision = Object.freeze({
  decision: LEDGER_DECISION,
  decision_reason: LEDGER_DECISION_REASON,
});

// `x-<orgslug>-<rest>`: a non-empty orgslug, then at least one more segment.
// This admits third-party namespaced extensions while excluding reserved
// `posteria_*` and any non-namespaced field — neither matches.
const EXTENSION_KEY = /^x-[^-]+-.+/;

const ALLOWED_ACTION_KEYS: ReadonlySet<string> = new Set([
  "action_kind",
  "action_signature",
  "vdc",
]);

const ALLOWED_VDC_KEYS: ReadonlySet<string> = new Set([
  "mandate_id",
  "issuer",
  "subject",
  "claims",
]);

/**
 * Reject runtime input that would force Ledger to emit a non-v0.1 record.
 * record() accepts only documented v0.1 fields plus `x-<orgslug>-*`
 * extensions; any reserved `posteria_*` field, reserved `vdc.*` field,
 * unrecognized non-namespaced field, or malformed pseudo-namespace (e.g.
 * `x-acmeco` with no suffix) throws before any audit record is enqueued. This
 * enforces Ledger's producer obligation by rejecting malformed input — it is
 * not policy evaluation, and valid inputs remain the identity function.
 */
function assertOnlyDocumentedFields(
  source: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: "action" | "vdc",
): void {
  for (const key of Object.keys(source)) {
    if (allowed.has(key) || EXTENSION_KEY.test(key)) continue;
    throw new Error(
      `[posteria-ledger] record() rejected non-v0.1 field ${JSON.stringify(key)} on ${location}: only documented v0.1 fields and x-<orgslug>-* extensions are accepted; no audit record was emitted`,
    );
  }
}

/** Reference-preserving copy of caller-supplied `x-<orgslug>-*` extension keys onto `target`. */
function copyExtensions(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): void {
  for (const key of Object.keys(source)) {
    if (EXTENSION_KEY.test(key)) target[key] = source[key];
  }
}

/** Walk up from this module to the package.json that owns it, for observer_version. */
function readLedgerVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (pkg.name === "@posteria/ledger" && pkg.version) return pkg.version;
    } catch {
      // not here; keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}

const LEDGER_VERSION = readLedgerVersion();

/**
 * Structural normalization only — never semantic interpretation. Emits all
 * four advisory VDC fields, passing caller-supplied strings through unchanged
 * and reference-preserving the claims object; absent fields take their
 * documented defaults.
 */
function normalizeVdc(input: VdcInput | undefined): VdcEnvelope {
  const envelope: VdcEnvelope = {
    mandate_id: input?.mandate_id ?? null,
    issuer: input?.issuer ?? null,
    subject: input?.subject ?? null,
    claims: input?.claims ?? {},
  };
  if (input) {
    copyExtensions(
      input as Record<string, unknown>,
      envelope as unknown as Record<string, unknown>,
    );
  }
  return envelope;
}

/**
 * Test seam: lets the unit suite inject a telemetry spy. `@internal` + the
 * project's `stripInternal` keep both this interface and the two-arg overload
 * out of the published `dist/index.d.ts`, so the public signature stays
 * `createLedger(config?)`.
 * @internal
 */
interface LedgerInternals {
  telemetry?: () => unknown;
}

export function createLedger(config?: Partial<LedgerConfig>): Ledger;
/** @internal test seam — stripped from the published types. */
export function createLedger(
  config: Partial<LedgerConfig> | undefined,
  internals: LedgerInternals,
): Ledger;
export function createLedger(
  config?: Partial<LedgerConfig>,
  internals?: LedgerInternals,
): Ledger {
  const resolved = resolveConfig({ programmatic: config });
  const sink = createAuditSink({ path: resolved.audit_stream_path });
  const hasHostMetadata = Object.keys(resolved.host_metadata).length > 0;
  const telemetryEnabled = resolved.enable_anon_telemetry;
  const telemetry = internals?.telemetry ?? emitTelemetryNoop;

  return {
    config: resolved,

    record(action: AuditAction): LedgerDecision {
      // Guard before building or enqueueing anything: a caller that supplies a
      // reserved or unrecognized field is trying to produce a non-v0.1 record,
      // so reject the call rather than silently dropping their data.
      assertOnlyDocumentedFields(
        action as unknown as Record<string, unknown>,
        ALLOWED_ACTION_KEYS,
        "action",
      );
      if (action.vdc) {
        assertOnlyDocumentedFields(
          action.vdc as Record<string, unknown>,
          ALLOWED_VDC_KEYS,
          "vdc",
        );
      }

      const record: AuditRecord = {
        record_version: RECORD_VERSION,
        record_id: randomUUID(),
        recorded_at: new Date().toISOString(),
        action_kind: action.action_kind,
        action_signature: action.action_signature,
        vdc: normalizeVdc(action.vdc),
        decision: LEDGER_DECISION,
        decision_reason: LEDGER_DECISION_REASON,
        observer_version: LEDGER_VERSION,
      };
      if (hasHostMetadata) record.host_metadata = resolved.host_metadata;
      copyExtensions(
        action as unknown as Record<string, unknown>,
        record as unknown as Record<string, unknown>,
      );

      // Fire-and-forget per Option C: the decision is always `allow`, so the
      // audit write stays off the hot path. The sink coalesces queued records
      // and flushes them on its own cadence; close() is the deterministic
      // drain primitive for graceful shutdown. A hard crash between record()
      // and the next flush can lose the in-flight record — the documented v0.1
      // durability trade-off.
      sink.write(record);

      // v0.1 no-op telemetry stub: reachable only when enable_anon_telemetry
      // is true, so with the default-off flag this branch is provably never
      // taken. The stub itself is a pure no-op (see ./telemetry.ts).
      if (telemetryEnabled) telemetry();

      return SHORT_CIRCUIT;
    },

    close(): Promise<void> {
      return sink.close();
    },
  };
}
