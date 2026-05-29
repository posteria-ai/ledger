import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAuditSink } from "./audit-sink.js";
import { resolveConfig } from "./config.js";

export const RECORD_VERSION = "0.1.0" as const;
export const OBSERVER_DECISION = "allow" as const;
export const OBSERVER_DECISION_REASON = "observer_short_circuit" as const;
export const DEFAULT_AUDIT_STREAM_PATH =
  "./posteria-observer-audit.jsonl" as const;

export interface ObserverConfig {
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
  decision: typeof OBSERVER_DECISION;
  decision_reason: typeof OBSERVER_DECISION_REASON;
  observer_version: string;
  host_metadata?: Record<string, unknown>;
  [extensionKey: `x-${string}-${string}`]: unknown;
}

export interface ObserverDecision {
  decision: typeof OBSERVER_DECISION;
  decision_reason: typeof OBSERVER_DECISION_REASON;
}

export interface Observer {
  /** Synchronous identity-function decision. Records an audit entry as a side effect (fire-and-forget; flushed on close()). */
  observe(action: AuditAction): ObserverDecision;

  /** Drain pending audit writes and close the underlying sink. Resolves when records are durably on disk. Idempotent. */
  close(): Promise<void>;

  /** Resolved configuration (read-only). */
  readonly config: Readonly<ObserverConfig>;
}

const SHORT_CIRCUIT: ObserverDecision = Object.freeze({
  decision: OBSERVER_DECISION,
  decision_reason: OBSERVER_DECISION_REASON,
});

// `x-<orgslug>-<rest>`: a non-empty orgslug, then at least one more segment.
// This admits third-party namespaced extensions while excluding reserved
// `posteria_*` and any non-namespaced field — neither matches.
const EXTENSION_KEY = /^x-[^-]+-.+/;

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
function readObserverVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (pkg.name === "@posteria/observer" && pkg.version) return pkg.version;
    } catch {
      // not here; keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}

const OBSERVER_VERSION = readObserverVersion();

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

export function createObserver(config?: Partial<ObserverConfig>): Observer {
  const resolved = resolveConfig({ programmatic: config });
  const sink = createAuditSink({ path: resolved.audit_stream_path });
  const hasHostMetadata = Object.keys(resolved.host_metadata).length > 0;

  return {
    config: resolved,

    observe(action: AuditAction): ObserverDecision {
      const record: AuditRecord = {
        record_version: RECORD_VERSION,
        record_id: randomUUID(),
        recorded_at: new Date().toISOString(),
        action_kind: action.action_kind,
        action_signature: action.action_signature,
        vdc: normalizeVdc(action.vdc),
        decision: OBSERVER_DECISION,
        decision_reason: OBSERVER_DECISION_REASON,
        observer_version: OBSERVER_VERSION,
      };
      if (hasHostMetadata) record.host_metadata = resolved.host_metadata;
      copyExtensions(
        action as unknown as Record<string, unknown>,
        record as unknown as Record<string, unknown>,
      );

      // Fire-and-forget per Option C: the decision is always `allow`, so the
      // audit write stays off the hot path. The sink coalesces queued records
      // and flushes them on its own cadence; close() is the deterministic
      // drain primitive for graceful shutdown. A hard crash between observe()
      // and the next flush can lose the in-flight record — the documented v0.1
      // durability trade-off.
      sink.write(record);

      return SHORT_CIRCUIT;
    },

    close(): Promise<void> {
      return sink.close();
    },
  };
}
