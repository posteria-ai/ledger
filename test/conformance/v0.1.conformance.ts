import assert from "node:assert/strict";
import dns from "node:dns";
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { createAuditSink } from "../../src/audit-sink.js";
import { resolveConfig } from "../../src/config.js";
import { createObserver, type AuditAction } from "../../src/index.js";

// The six reserved field sets the producer obligation forbids (see
// docs/contract/v0.1.md "Extension Hooks" and "Reserved VDC envelope
// extension fields").
const RESERVED_TOP_LEVEL = [
  "posteria_attestation",
  "posteria_signature",
  "posteria_signed_at",
  "posteria_policy_digest",
  "posteria_linkage",
  "posteria_extension_profiles",
] as const;

const RESERVED_VDC = [
  "attestation",
  "signature",
  "signature_algorithm",
  "attested_at",
  "verifier_id",
] as const;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "posteria-observer-conformance-"));
});

afterEach(() => {
  mock.restoreAll();
  rmSync(dir, { recursive: true, force: true });
});

const action = (overrides: Partial<AuditAction> = {}): AuditAction => ({
  action_kind: "tool_call",
  action_signature: "search(q)",
  ...overrides,
});

function readRecords(path: string): Record<string, unknown>[] {
  const raw = readFileSync(path, "utf8");
  return raw.length === 0
    ? []
    : raw
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Collect every property name appearing at any depth in a JSON value. */
function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      collectKeys(child, into);
    }
  }
}

describe("contract: identity-function decision behavior", () => {
  it("returns allow + observer_short_circuit for every well-formed input, mutates no payload, and records exactly N", async () => {
    const path = join(dir, "audit.jsonl");
    const observer = createObserver({ audit_stream_path: path });
    const n = 1024;

    for (let i = 0; i < n; i++) {
      const input: AuditAction = action({
        action_signature: `search(q${i})`,
        "x-acmeco-trace_id": `t-${i}`,
        vdc: {
          mandate_id: `m-${i}`,
          issuer: "iss",
          subject: "sub",
          claims: { role: "admin", attempt: i, nested: { ok: true } },
          "x-acmeco-purpose": "audit",
        },
      });
      const clone = structuredClone(input);

      const decision = observer.observe(input);
      assert.deepEqual(decision, {
        decision: "allow",
        decision_reason: "observer_short_circuit",
      });
      // Zero caller-payload mutation: the input is byte-identical to its clone.
      assert.deepEqual(input, clone);
    }

    await observer.close();
    assert.equal(readRecords(path).length, n);
  });
});

describe("contract: audit-stream record shape", () => {
  const REQUIRED_FIELDS = [
    "record_version",
    "record_id",
    "recorded_at",
    "action_kind",
    "action_signature",
    "vdc",
    "decision",
    "decision_reason",
    "observer_version",
  ] as const;
  const VDC_FIELDS = ["mandate_id", "issuer", "subject", "claims"] as const;

  it("every emitted record carries required fields with pinned literals, a four-field vdc envelope, and no reserved field at any depth", async () => {
    const path = join(dir, "audit.jsonl");
    const observer = createObserver({ audit_stream_path: path });
    const n = 256;

    for (let i = 0; i < n; i++) {
      observer.observe(
        action({
          action_signature: `search(q${i})`,
          "x-acmeco-trace_id": `t-${i}`,
          vdc: {
            mandate_id: `m-${i}`,
            issuer: "iss",
            subject: "sub",
            claims: { role: "admin", attempt: i },
            "x-acmeco-purpose": "audit",
          },
        }),
      );
    }
    await observer.close();

    const records = readRecords(path);
    assert.equal(records.length, n);

    const reserved = new Set<string>([...RESERVED_TOP_LEVEL, ...RESERVED_VDC]);

    for (const rec of records) {
      for (const field of REQUIRED_FIELDS) {
        assert.ok(field in rec, `required field ${field} missing`);
      }
      assert.equal(rec.record_version, "0.1.0");
      assert.equal(rec.decision, "allow");
      assert.equal(rec.decision_reason, "observer_short_circuit");

      const vdc = rec.vdc as Record<string, unknown>;
      // The vdc envelope has exactly the four documented fields plus only
      // x-* extensions — no other top-level vdc key is permitted.
      for (const field of VDC_FIELDS) {
        assert.ok(field in vdc, `vdc field ${field} missing`);
      }
      for (const key of Object.keys(vdc)) {
        const isDocumented = (VDC_FIELDS as readonly string[]).includes(key);
        const isExtension = /^x-[^-]+-.+/.test(key);
        assert.ok(
          isDocumented || isExtension,
          `vdc envelope carries non-documented, non-extension field ${key}`,
        );
      }

      // No reserved field appears at any depth (claims contents included).
      const keys = new Set<string>();
      collectKeys(rec, keys);
      for (const name of reserved) {
        assert.equal(
          keys.has(name),
          false,
          `reserved field ${name} leaked into an emitted record`,
        );
      }
    }
  });
});

describe("contract: producer-side reserved/unrecognized-field rejection", () => {
  function recordCount(path: string): number {
    try {
      return readRecords(path).length;
    } catch {
      return 0;
    }
  }

  for (const field of RESERVED_TOP_LEVEL) {
    it(`observe() throws and emits no record for reserved top-level field ${field}`, async () => {
      const path = join(dir, `top-${field}.jsonl`);
      const observer = createObserver({ audit_stream_path: path });
      assert.throws(
        () => observer.observe({ ...action(), [field]: {} } as AuditAction),
        /non-v0.1 field/,
      );
      await observer.close();
      assert.equal(recordCount(path), 0);
    });
  }

  for (const field of RESERVED_VDC) {
    it(`observe() throws and emits no record for reserved vdc field ${field}`, async () => {
      const path = join(dir, `vdc-${field}.jsonl`);
      const observer = createObserver({ audit_stream_path: path });
      assert.throws(
        () =>
          observer.observe(
            action({
              vdc: { mandate_id: "m", [field]: {} },
            } as Partial<AuditAction>),
          ),
        /non-v0.1 field/,
      );
      await observer.close();
      assert.equal(recordCount(path), 0);
    });
  }

  it("observe() throws and emits no record for an unrecognized non-namespaced top-level field", async () => {
    const path = join(dir, "unrecognized-top.jsonl");
    const observer = createObserver({ audit_stream_path: path });
    assert.throws(
      () => observer.observe({ ...action(), bogus_key: "nope" } as AuditAction),
      /non-v0.1 field/,
    );
    await observer.close();
    assert.equal(recordCount(path), 0);
  });

  it("observe() throws and emits no record for an unrecognized non-namespaced field inside vdc", async () => {
    const path = join(dir, "unrecognized-vdc.jsonl");
    const observer = createObserver({ audit_stream_path: path });
    assert.throws(
      () =>
        observer.observe(
          action({
            vdc: { mandate_id: "m", bogus_key: "nope" },
          } as Partial<AuditAction>),
        ),
      /non-v0.1 field/,
    );
    await observer.close();
    assert.equal(recordCount(path), 0);
  });

  it("observe() throws and emits no record for a malformed pseudo-namespace (x-acmeco with no suffix) at top level and in vdc", async () => {
    const topPath = join(dir, "malformed-top.jsonl");
    const topObserver = createObserver({ audit_stream_path: topPath });
    assert.throws(
      () =>
        topObserver.observe({ ...action(), "x-acmeco": "no-suffix" } as AuditAction),
      /non-v0.1 field/,
    );
    await topObserver.close();
    assert.equal(recordCount(topPath), 0);

    const vdcPath = join(dir, "malformed-vdc.jsonl");
    const vdcObserver = createObserver({ audit_stream_path: vdcPath });
    assert.throws(
      () =>
        vdcObserver.observe(
          action({
            vdc: { mandate_id: "m", "x-acmeco": "no-suffix" },
          } as Partial<AuditAction>),
        ),
      /non-v0.1 field/,
    );
    await vdcObserver.close();
    assert.equal(recordCount(vdcPath), 0);
  });

  it("accepts a valid x-<orgslug>-* extension at top level and in vdc (positive control)", async () => {
    const path = join(dir, "positive-control.jsonl");
    const observer = createObserver({ audit_stream_path: path });
    observer.observe(
      action({
        "x-acmeco-trace_id": "abc",
        vdc: { mandate_id: "m", "x-acmeco-purpose": "audit" },
      }),
    );
    await observer.close();
    const [rec] = readRecords(path);
    assert.equal(rec!["x-acmeco-trace_id"], "abc");
    assert.equal(
      (rec!.vdc as Record<string, unknown>)["x-acmeco-purpose"],
      "audit",
    );
  });
});

describe("contract: telemetry-stub no-op", () => {
  it("opens no network sockets and issues no DNS/HTTP/HTTPS requests with the real stub even when enable_anon_telemetry is true", async () => {
    const netSpy = mock.method(net, "createConnection");
    const httpSpy = mock.method(http, "request");
    const httpsSpy = mock.method(https, "request");
    const dnsSpy = mock.method(dns, "lookup");

    const path = join(dir, "audit.jsonl");
    // Real stub: no internals seam supplied.
    const observer = createObserver({
      audit_stream_path: path,
      enable_anon_telemetry: true,
    });
    const n = 50;
    for (let i = 0; i < n; i++) observer.observe(action());
    await observer.close();

    assert.equal(netSpy.mock.callCount(), 0);
    assert.equal(httpSpy.mock.callCount(), 0);
    assert.equal(httpsSpy.mock.callCount(), 0);
    assert.equal(dnsSpy.mock.callCount(), 0);
    // mocks restored in afterEach via mock.restoreAll().
  });
});

describe("contract: append-only semantics under SIGHUP", () => {
  it("re-opens on SIGHUP so the rotated file and the recreated path together hold all records on distinct inodes", async () => {
    const path = join(dir, "audit.jsonl");
    const rotated = join(dir, "audit.jsonl.1");
    const k = 200;

    // Drive the Observer's append-only engine directly for deterministic
    // synchronization with the re-open.
    let resolveReopen!: () => void;
    const reopened = new Promise<void>((resolve) => {
      resolveReopen = resolve;
    });

    const sink = createAuditSink({
      path,
      onReopen: () => resolveReopen(),
    });

    // A pending Promise does not by itself keep libuv's loop alive, so a bare
    // `await reopened` can let Node exit before the SIGHUP is delivered. A
    // small keepalive timer keeps the loop ticking until the re-open fires.
    const keepalive = setInterval(() => {}, 10);

    try {
      for (let i = 0; i < k; i++) sink.write({ phase: "before", i });
      await sink.flush();
      const originalIno = statSync(path).ino;

      // External rotation: move the live file aside, then signal the rotation.
      renameSync(path, rotated);
      process.kill(process.pid, "SIGHUP");
      await reopened;
      clearInterval(keepalive);

      for (let i = 0; i < k; i++) sink.write({ phase: "after", i });
      await sink.close();

      const before = readRecords(rotated);
      const after = readRecords(path);

      assert.equal(before.length, k, "rotated file holds the first K records");
      assert.equal(after.length, k, "recreated path holds the second K records");
      assert.equal(
        before.length + after.length,
        2 * k,
        "2K records total, all parseable",
      );
      assert.ok(
        before.every((r) => r.phase === "before"),
        "rotated file holds only pre-rotation records",
      );
      assert.ok(
        after.every((r) => r.phase === "after"),
        "recreated path holds only post-rotation records",
      );

      // The recreated path is a distinct inode, proving a real re-open.
      assert.notEqual(
        statSync(path).ino,
        originalIno,
        "recreated file inode differs from the pre-rotation inode",
      );
    } finally {
      clearInterval(keepalive);
      // close() removes the SIGHUP handler; ensure it ran even on failure so
      // the handler does not leak into other tests.
      await sink.close();
    }
  });
});

describe("contract: unknown configuration key warns, it does not fail", () => {
  it("resolveConfig warns on an unrecognized key and does not throw, and createObserver tolerates it", async () => {
    const warnings: string[] = [];
    assert.doesNotThrow(() => {
      resolveConfig({
        programmatic: { unrecognized_key: true },
        warn: (m) => warnings.push(m),
      });
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /unknown configuration key/);

    const path = join(dir, "audit.jsonl");
    let observer!: ReturnType<typeof createObserver>;
    assert.doesNotThrow(() => {
      observer = createObserver({
        audit_stream_path: path,
        unrecognized_key: true,
      } as Parameters<typeof createObserver>[0]);
    });
    await observer.close();
  });
});
