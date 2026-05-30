import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { describe, it } from "node:test";

import {
  type AuditRecord,
  type VdcEnvelope,
  createLedger,
  DEFAULT_AUDIT_STREAM_PATH,
  LEDGER_DECISION,
  LEDGER_DECISION_REASON,
  RECORD_VERSION,
} from "../src/index.js";

describe("createLedger", () => {
  it("returns a working Ledger without throwing", async () => {
    const ledger = createLedger();
    assert.equal(typeof ledger.record, "function");
    assert.equal(typeof ledger.close, "function");
    assert.equal(ledger.config.audit_stream_path, DEFAULT_AUDIT_STREAM_PATH);
    await ledger.close();
    rmSync(DEFAULT_AUDIT_STREAM_PATH, { force: true });
  });
});

describe("v0.1 contract constants", () => {
  it("pins record_version to 0.1.0", () => {
    assert.equal(RECORD_VERSION, "0.1.0");
  });

  it("pins decision to allow", () => {
    assert.equal(LEDGER_DECISION, "allow");
  });

  it("pins decision_reason to ledger_short_circuit", () => {
    assert.equal(LEDGER_DECISION_REASON, "ledger_short_circuit");
  });

  it("pins the default audit-stream path", () => {
    assert.equal(
      DEFAULT_AUDIT_STREAM_PATH,
      "./posteria-ledger-audit.jsonl",
    );
  });
});

describe("x-<orgslug>-* extension namespace", () => {
  it("accepts third-party namespaced fields at the record top level", () => {
    const record: AuditRecord = {
      record_version: "0.1.0",
      record_id: "00000000-0000-4000-8000-000000000000",
      recorded_at: "2026-05-28T00:00:00Z",
      action_kind: "tool_call",
      action_signature: "noop",
      vdc: {
        mandate_id: null,
        issuer: null,
        subject: null,
        claims: {},
      },
      decision: "allow",
      decision_reason: "ledger_short_circuit",
      ledger_version: "0.0.0",
      "x-acmeco-trace_id": "abc123",
    };
    assert.equal(record["x-acmeco-trace_id"], "abc123");
  });

  it("accepts third-party namespaced fields inside the VDC envelope", () => {
    const vdc: VdcEnvelope = {
      mandate_id: null,
      issuer: null,
      subject: null,
      claims: {},
      "x-acmeco-purpose": "audit",
    };
    assert.equal(vdc["x-acmeco-purpose"], "audit");
  });
});
