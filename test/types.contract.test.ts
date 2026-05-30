import { describe, it } from "node:test";

import type {
  AuditAction,
  AuditRecord,
  LedgerConfig,
  LedgerDecision,
  VdcEnvelope,
  VdcInput,
} from "../src/index.js";

describe("v0.1 contract type compatibility — positive cases", () => {
  it("compiles a minimal AuditRecord with required fields only", () => {
    const _record: AuditRecord = {
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
    };
    void _record;
  });

  it("compiles an AuditRecord with optional host_metadata", () => {
    const _record: AuditRecord = {
      record_version: "0.1.0",
      record_id: "id",
      recorded_at: "2026-05-28T00:00:00Z",
      action_kind: "tool_call",
      action_signature: "sig",
      vdc: { mandate_id: null, issuer: null, subject: null, claims: {} },
      decision: "allow",
      decision_reason: "ledger_short_circuit",
      ledger_version: "0.0.0",
      host_metadata: { region: "us-east-1" },
    };
    void _record;
  });

  it("compiles an AuditRecord with x-<orgslug>-* extension fields", () => {
    const _record: AuditRecord = {
      record_version: "0.1.0",
      record_id: "id",
      recorded_at: "2026-05-28T00:00:00Z",
      action_kind: "tool_call",
      action_signature: "sig",
      vdc: { mandate_id: null, issuer: null, subject: null, claims: {} },
      decision: "allow",
      decision_reason: "ledger_short_circuit",
      ledger_version: "0.0.0",
      "x-acmeco-trace_id": "abc",
      "x-acmeco-correlation_id": 42,
    };
    void _record;
  });

  it("compiles a VdcEnvelope with x-<orgslug>-* extensions", () => {
    const _vdc: VdcEnvelope = {
      mandate_id: null,
      issuer: null,
      subject: null,
      claims: {},
      "x-acmeco-purpose": "audit",
    };
    void _vdc;
  });

  it("compiles an empty VdcInput (all fields optional)", () => {
    const _input: VdcInput = {};
    void _input;
  });

  it("compiles a VdcInput with caller-supplied fields and extensions", () => {
    const _input: VdcInput = {
      mandate_id: "m-1",
      issuer: "iss-1",
      subject: "sub-1",
      claims: { role: "admin" },
      "x-acmeco-purpose": "audit",
    };
    void _input;
  });

  it("compiles an AuditAction with optional vdc and extensions", () => {
    const _action: AuditAction = {
      action_kind: "tool_call",
      action_signature: "sig",
      vdc: { mandate_id: "m" },
      "x-acmeco-trace_id": "abc",
    };
    void _action;
  });

  it("compiles a literal-typed LedgerDecision", () => {
    const _decision: LedgerDecision = {
      decision: "allow",
      decision_reason: "ledger_short_circuit",
    };
    void _decision;
  });

  it("compiles a full LedgerConfig", () => {
    const _config: LedgerConfig = {
      audit_stream_path: "./posteria-ledger-audit.jsonl",
      enable_anon_telemetry: false,
      host_metadata: {},
    };
    void _config;
  });
});

describe("v0.1 contract type compatibility — negative cases", () => {
  it("rejects reserved posteria_* top-level fields", () => {
    const _record: AuditRecord = {
      record_version: "0.1.0",
      record_id: "id",
      recorded_at: "2026-05-28T00:00:00Z",
      action_kind: "tool_call",
      action_signature: "sig",
      vdc: { mandate_id: null, issuer: null, subject: null, claims: {} },
      decision: "allow",
      decision_reason: "ledger_short_circuit",
      ledger_version: "0.0.0",
      // @ts-expect-error posteria_* is reserved for v0.2+; v0.1 producer MUST NOT emit
      posteria_attestation: {},
    };
    void _record;
  });

  it("rejects reserved VDC attestation fields inside vdc", () => {
    const _vdc: VdcEnvelope = {
      mandate_id: null,
      issuer: null,
      subject: null,
      claims: {},
      // @ts-expect-error `attestation` is reserved for v0.2+ inside vdc
      attestation: {},
    };
    void _vdc;
  });

  it("rejects reserved VDC signature_algorithm field", () => {
    const _vdc: VdcEnvelope = {
      mandate_id: null,
      issuer: null,
      subject: null,
      claims: {},
      // @ts-expect-error `signature_algorithm` is reserved for v0.2+ inside vdc
      signature_algorithm: "ed25519",
    };
    void _vdc;
  });

  it("rejects unrecognized non-namespaced top-level fields", () => {
    const _record: AuditRecord = {
      record_version: "0.1.0",
      record_id: "id",
      recorded_at: "2026-05-28T00:00:00Z",
      action_kind: "tool_call",
      action_signature: "sig",
      vdc: { mandate_id: null, issuer: null, subject: null, claims: {} },
      decision: "allow",
      decision_reason: "ledger_short_circuit",
      ledger_version: "0.0.0",
      // @ts-expect-error non-namespaced extra fields are not part of the v0.1 contract
      arbitrary_field: "nope",
    };
    void _record;
  });

  it("rejects malformed x- keys missing the orgslug segment", () => {
    const _vdc: VdcEnvelope = {
      mandate_id: null,
      issuer: null,
      subject: null,
      claims: {},
      // @ts-expect-error template requires x-<orgslug>-<rest>, single-segment keys are not valid
      "x-acmeco": "missing-suffix",
    };
    void _vdc;
  });

  it("rejects literal mismatch on decision", () => {
    const _bad: LedgerDecision = {
      // @ts-expect-error v0.1 emits only "allow"
      decision: "deny",
      decision_reason: "ledger_short_circuit",
    };
    void _bad;
  });

  it("rejects literal mismatch on decision_reason", () => {
    const _bad: LedgerDecision = {
      decision: "allow",
      // @ts-expect-error v0.1 emits only "ledger_short_circuit"
      decision_reason: "policy_match",
    };
    void _bad;
  });

  it("rejects literal mismatch on record_version", () => {
    const _bad: AuditRecord = {
      // @ts-expect-error v0.1 record_version is pinned to "0.1.0"
      record_version: "0.2.0",
      record_id: "id",
      recorded_at: "2026-05-28T00:00:00Z",
      action_kind: "tool_call",
      action_signature: "sig",
      vdc: { mandate_id: null, issuer: null, subject: null, claims: {} },
      decision: "allow",
      decision_reason: "ledger_short_circuit",
      ledger_version: "0.0.0",
    };
    void _bad;
  });
});
