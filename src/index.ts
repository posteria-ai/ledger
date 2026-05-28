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

export function createObserver(_config?: Partial<ObserverConfig>): never {
  throw new Error("@posteria/observer runtime is not implemented yet");
}
