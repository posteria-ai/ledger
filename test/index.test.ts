import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type AuditRecord,
  type VdcEnvelope,
  createObserver,
  DEFAULT_AUDIT_STREAM_PATH,
  OBSERVER_DECISION,
  OBSERVER_DECISION_REASON,
  RECORD_VERSION,
} from "../src/index.js";

describe("createObserver", () => {
  it("exposes the v0.1 public API stub", () => {
    assert.throws(
      () => createObserver(),
      /not implemented/i,
    );
  });
});

describe("v0.1 contract constants", () => {
  it("pins record_version to 0.1.0", () => {
    assert.equal(RECORD_VERSION, "0.1.0");
  });

  it("pins decision to allow", () => {
    assert.equal(OBSERVER_DECISION, "allow");
  });

  it("pins decision_reason to observer_short_circuit", () => {
    assert.equal(OBSERVER_DECISION_REASON, "observer_short_circuit");
  });

  it("pins the default audit-stream path", () => {
    assert.equal(
      DEFAULT_AUDIT_STREAM_PATH,
      "./posteria-observer-audit.jsonl",
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
      decision_reason: "observer_short_circuit",
      observer_version: "0.0.0",
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
