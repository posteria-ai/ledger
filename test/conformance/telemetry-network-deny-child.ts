import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createObserver, type AuditAction } from "../../src/index.js";

const action = (): AuditAction => ({
  action_kind: "tool_call",
  action_signature: "search(q)",
});

async function runRealTelemetryNoop(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "posteria-observer-network-deny-"));
  try {
    const observer = createObserver({
      audit_stream_path: join(dir, "audit.jsonl"),
      enable_anon_telemetry: true,
    });
    for (let i = 0; i < 50; i++) observer.observe(action());
    await observer.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runCapturedDnsNegativeControl(): Promise<void> {
  const { resolveWithCapturedNamedImport } = await import(
    "./telemetry-captured-dns.fixture.js"
  );
  await resolveWithCapturedNamedImport();
}

async function runSwallowedCapturedDnsNegativeControl(): Promise<void> {
  try {
    await runCapturedDnsNegativeControl();
  } catch {
    // Best-effort telemetry implementations often swallow network failures.
    // The preload hook must still force a failing process exit in that case.
  }
}

const mode = process.argv[2];

if (mode === "real-telemetry-noop") {
  await runRealTelemetryNoop();
} else if (mode === "captured-dns-negative-control") {
  await runCapturedDnsNegativeControl();
} else if (mode === "swallowed-captured-dns-negative-control") {
  await runSwallowedCapturedDnsNegativeControl();
} else {
  throw new Error(`unknown telemetry network-deny child mode: ${mode ?? ""}`);
}
