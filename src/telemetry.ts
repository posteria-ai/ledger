/** Sentinel returned by the v0.1 no-op telemetry stub. */
export const TELEMETRY_NOOP = "telemetry_noop" as const;

/**
 * v0.1 no-op telemetry stub.
 *
 * This function exists solely to make the *shape* of a future telemetry hook
 * reachable behind `enable_anon_telemetry: true`; in v0.1 it does nothing.
 *
 * Per the Telemetry Stub Contract (docs/contract/v0.1.md):
 *
 * - The stub is reachable only when `enable_anon_telemetry: true`. When the
 *   flag is `false` (the default) this code path is never taken.
 * - The stub MUST be a no-op in v0.1: it MUST NOT open network connections
 *   (no TCP/UDP/Unix sockets), MUST NOT write to remote endpoints, and MUST
 *   NOT exfiltrate any audit record content.
 * - The stub MUST NOT consume the contents of the audit stream.
 * - A future v0.2 enabling non-no-op telemetry requires a spec amendment and a
 *   major-version bump or explicit migration note. v0.1 MUST NOT be silently
 *   upgraded into a network-emitting build.
 *
 * The body is therefore a pure, synchronous no-op that returns the
 * {@link TELEMETRY_NOOP} sentinel and has no observable side effects.
 */
export function emitTelemetryNoop(): typeof TELEMETRY_NOOP {
  return TELEMETRY_NOOP;
}
