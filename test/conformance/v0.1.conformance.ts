import assert from "node:assert/strict";
import dgram from "node:dgram";
import dns from "node:dns";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

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

/**
 * Assert the emit-no-record obligation strictly: a missing or empty file is the
 * only passing state. Any non-empty content fails — including a partial or
 * malformed line written before observe() threw, which must NOT be silently
 * treated as "zero records".
 */
function assertNoRecordEmitted(path: string): void {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  assert.equal(
    raw.length,
    0,
    `expected no audit output, but the file is non-empty: ${JSON.stringify(raw.slice(0, 200))}`,
  );
}

/**
 * Reserved-field check scoped to the contract's malformed-field surface: the
 * top-level record envelope and the direct `vdc` envelope only. `vdc.claims` is
 * opaque per the contract and is deliberately NOT scanned — a caller may place
 * any key (even one that collides with a reserved name) inside claims.
 */
function assertNoReservedEnvelopeFields(rec: Record<string, unknown>): void {
  for (const key of Object.keys(rec)) {
    assert.equal(
      (RESERVED_TOP_LEVEL as readonly string[]).includes(key),
      false,
      `reserved top-level field ${key} leaked into the record envelope`,
    );
  }
  const vdc = rec.vdc as Record<string, unknown>;
  for (const key of Object.keys(vdc)) {
    assert.equal(
      (RESERVED_VDC as readonly string[]).includes(key),
      false,
      `reserved vdc field ${key} leaked into the vdc envelope`,
    );
  }
}

// RFC 3339 / ISO 8601 instant, e.g. 2026-05-28T12:34:56.789Z.
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Poll `predicate` until true, failing with a clear message if it never settles. */
async function waitUntil(
  predicate: () => boolean,
  label: string,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
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

  it("every emitted record carries required fields with pinned literals, a four-field vdc envelope, and no reserved envelope field", async () => {
    const path = join(dir, "audit.jsonl");
    const observer = createObserver({ audit_stream_path: path });

    // A mix of vdc shapes so the validator also exercises the documented
    // defaults for omitted fields, not only fully-populated envelopes.
    const inputs: AuditAction[] = [
      // [0] fully-populated vdc + extensions; claims carries a reserved-sounding
      // key, which is legal because claims is opaque and must be preserved.
      action({
        action_signature: "full(0)",
        "x-acmeco-trace_id": "t-0",
        vdc: {
          mandate_id: "m-0",
          issuer: "iss",
          subject: "sub",
          claims: { role: "admin", signature: "opaque-not-a-vdc-field" },
          "x-acmeco-purpose": "audit",
        },
      }),
      // [1] no vdc at all → all four fields must default.
      action({ action_signature: "no-vdc(1)" }),
      // [2] partial vdc (only mandate_id) → the other three must default.
      action({ action_signature: "partial(2)", vdc: { mandate_id: "only" } }),
    ];
    const bulk = 256;
    for (let i = 0; i < bulk; i++) {
      inputs.push(
        action({
          action_signature: `bulk(${i})`,
          vdc: { mandate_id: `m-${i}`, issuer: "iss", subject: "sub" },
        }),
      );
    }

    for (const input of inputs) observer.observe(input);
    await observer.close();

    const records = readRecords(path);
    assert.equal(records.length, inputs.length);

    for (const rec of records) {
      for (const field of REQUIRED_FIELDS) {
        assert.ok(field in rec, `required field ${field} missing`);
      }
      assert.equal(rec.record_version, "0.1.0");
      assert.equal(rec.decision, "allow");
      assert.equal(rec.decision_reason, "observer_short_circuit");

      // Semantic checks, not just presence: a constant id, a non-RFC3339
      // timestamp, or a non-string version must all fail here.
      assert.equal(typeof rec.record_id, "string");
      assert.ok((rec.record_id as string).length > 0, "record_id is non-empty");
      assert.match(rec.recorded_at as string, RFC3339);
      assert.ok(
        !Number.isNaN(Date.parse(rec.recorded_at as string)),
        "recorded_at parses as a date",
      );
      assert.equal(typeof rec.observer_version, "string");
      assert.ok(
        (rec.observer_version as string).length > 0,
        "observer_version is non-empty",
      );

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

      assertNoReservedEnvelopeFields(rec);
    }

    // record_id uniqueness across the whole sample.
    const ids = records.map((r) => r.record_id);
    assert.equal(new Set(ids).size, records.length, "record_ids are unique");

    // Documented defaults for the omitted/partial vdc cases.
    const noVdc = (records[1]!.vdc as Record<string, unknown>);
    assert.deepEqual(noVdc, {
      mandate_id: null,
      issuer: null,
      subject: null,
      claims: {},
    });
    const partial = (records[2]!.vdc as Record<string, unknown>);
    assert.deepEqual(partial, {
      mandate_id: "only",
      issuer: null,
      subject: null,
      claims: {},
    });

    // Opaque claims preserved verbatim, including a reserved-sounding key.
    const fullClaims = (records[0]!.vdc as Record<string, unknown>).claims;
    assert.deepEqual(fullClaims, {
      role: "admin",
      signature: "opaque-not-a-vdc-field",
    });
  });
});

describe("contract: producer-side reserved/unrecognized-field rejection", () => {
  for (const field of RESERVED_TOP_LEVEL) {
    it(`observe() throws and emits no record for reserved top-level field ${field}`, async () => {
      const path = join(dir, `top-${field}.jsonl`);
      const observer = createObserver({ audit_stream_path: path });
      assert.throws(
        () => observer.observe({ ...action(), [field]: {} } as AuditAction),
        /non-v0.1 field/,
      );
      await observer.close();
      assertNoRecordEmitted(path);
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
      assertNoRecordEmitted(path);
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
    assertNoRecordEmitted(path);
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
    assertNoRecordEmitted(path);
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
    assertNoRecordEmitted(topPath);

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
    assertNoRecordEmitted(vdcPath);
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
  it("opens no socket and issues no DNS/HTTP/HTTPS/HTTP2/UDP/TLS/fetch traffic with the real stub even when enable_anon_telemetry is true", async () => {
    // Spy the full surface a telemetry implementation could plausibly use, plus
    // the low-level Socket.prototype.connect that every TCP path funnels
    // through — so a stub that bypasses the high-level aliases is still caught.
    const spies: { label: string; calls: () => number }[] = [];
    const spy = (obj: object, method: string, label = method): void => {
      const m = mock.method(obj as never, method as never) as unknown as {
        mock: { callCount(): number };
      };
      spies.push({ label, calls: () => m.mock.callCount() });
    };

    spy(net.Socket.prototype, "connect", "net.Socket#connect");
    spy(net, "createConnection");
    spy(net, "connect", "net.connect");
    spy(http, "request", "http.request");
    spy(http, "get", "http.get");
    spy(https, "request", "https.request");
    spy(https, "get", "https.get");
    spy(http2, "connect", "http2.connect");
    spy(dns, "lookup", "dns.lookup");
    spy(dns, "resolve", "dns.resolve");
    spy(dns.promises, "lookup", "dns.promises.lookup");
    spy(dgram, "createSocket", "dgram.createSocket");
    spy(tls, "connect", "tls.connect");
    if (typeof globalThis.fetch === "function") {
      spy(globalThis, "fetch", "fetch");
    }

    const path = join(dir, "audit.jsonl");
    // Real stub: no internals seam supplied.
    const observer = createObserver({
      audit_stream_path: path,
      enable_anon_telemetry: true,
    });
    const n = 50;
    for (let i = 0; i < n; i++) observer.observe(action());
    await observer.close();

    for (const { label, calls } of spies) {
      assert.equal(calls(), 0, `telemetry no-op invoked ${label}`);
    }
    // mocks restored in afterEach via mock.restoreAll().
  });
});

describe("contract: append-only semantics under SIGHUP", () => {
  it("observe()s K records, rotates + SIGHUPs, observe()s K more, and all 2K survive across distinct inodes", async () => {
    const path = join(dir, "audit.jsonl");
    const rotated = join(dir, "audit.jsonl.1");
    const k = 200;

    // Exercise the PUBLIC Observer path, not the sink directly: createObserver
    // installs the SIGHUP handler by default, so a real signal drives the
    // re-open exactly as a host operator's log-rotation tooling would.
    const observer = createObserver({ audit_stream_path: path });

    try {
      for (let i = 0; i < k; i++) {
        observer.observe(action({ action_signature: `before(${i})` }));
      }
      // close() is the only public drain primitive, but it also closes; instead
      // rely on the re-open's fsync to flush the pre-rotation batch. Capture the
      // inode after the writes are enqueued and before the external rename.
      const originalIno = statSync(path).ino;

      // External rotation: move the live file aside, then signal the rotation.
      // The setInterval poll below keeps libuv's loop alive until the signal is
      // delivered, and is bounded so a missing handler fails fast (not a hang).
      renameSync(path, rotated);
      process.kill(process.pid, "SIGHUP");
      await waitUntil(
        () => existsSync(path) && statSync(path).ino !== originalIno,
        "SIGHUP re-open to recreate the audit file at a new inode",
      );

      for (let i = 0; i < k; i++) {
        observer.observe(action({ action_signature: `after(${i})` }));
      }
      await observer.close();

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
        before.every((r) => (r.action_signature as string).startsWith("before")),
        "rotated file holds only pre-rotation records",
      );
      assert.ok(
        after.every((r) => (r.action_signature as string).startsWith("after")),
        "recreated path holds only post-rotation records",
      );

      // The recreated path is a distinct inode, proving a real re-open.
      assert.notEqual(
        statSync(path).ino,
        originalIno,
        "recreated file inode differs from the pre-rotation inode",
      );
    } finally {
      // close() removes the SIGHUP handler; ensure it ran even on failure so
      // the handler does not leak into other tests. Idempotent.
      await observer.close();
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

    // The public path (createObserver) has no warn injection point, so it
    // defaults to stderr. Capture stderr to prove the warning is actually
    // surfaced there — and still that construction does not throw.
    const stderrSpy = mock.method(process.stderr, "write", () => true);
    const path = join(dir, "audit.jsonl");
    let observer!: ReturnType<typeof createObserver>;
    assert.doesNotThrow(() => {
      observer = createObserver({
        audit_stream_path: path,
        unrecognized_key: true,
      } as Parameters<typeof createObserver>[0]);
    });
    const stderrOutput = stderrSpy.mock.calls
      .map((c) => String(c.arguments[0]))
      .join("");
    stderrSpy.mock.restore();
    assert.match(stderrOutput, /unknown configuration key/);

    await observer.close();
  });
});
