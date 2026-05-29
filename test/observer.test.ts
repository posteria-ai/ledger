import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readFileSync as read, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createObserver, type AuditAction } from "../src/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "posteria-observer-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function newObserver() {
  const path = join(dir, "audit.jsonl");
  return { observer: createObserver({ audit_stream_path: path }), path };
}

function readRecords(path: string): Record<string, unknown>[] {
  const raw = readFileSync(path, "utf8");
  return raw.length === 0
    ? []
    : raw
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l));
}

const action = (overrides: Partial<AuditAction> = {}): AuditAction => ({
  action_kind: "tool_call",
  action_signature: "search(q)",
  ...overrides,
});

describe("observe — decision", () => {
  it("returns exactly the short-circuit decision, synchronously", async () => {
    const { observer } = newObserver();
    const decision = observer.observe(action());
    assert.deepEqual(decision, {
      decision: "allow",
      decision_reason: "observer_short_circuit",
    });
    await observer.close();
  });
});

describe("observe — no payload mutation", () => {
  it("does not mutate the caller-supplied action", async () => {
    const { observer } = newObserver();
    const claims = { role: "admin" };
    const input: AuditAction = {
      action_kind: "tool_call",
      action_signature: "sig",
      vdc: { mandate_id: "m-1", issuer: "iss", subject: "sub", claims },
    };
    const snapshot = structuredClone(input);
    observer.observe(input);
    assert.deepEqual(input, snapshot);
    await observer.close();
  });
});

describe("observe — one record per call", () => {
  it("writes exactly one record per observe()", async () => {
    const { observer, path } = newObserver();
    const n = 25;
    for (let i = 0; i < n; i++) observer.observe(action());
    await observer.close();
    assert.equal(readRecords(path).length, n);
  });
});

describe("VDC normalization", () => {
  it("passes all four supplied fields through, reference-preserving claims", async () => {
    const { observer, path } = newObserver();
    const claims = { role: "admin", scopes: ["read"] };
    observer.observe(
      action({ vdc: { mandate_id: "m-1", issuer: "iss", subject: "sub", claims } }),
    );
    await observer.close();
    const [rec] = readRecords(path);
    assert.deepEqual(rec!.vdc, {
      mandate_id: "m-1",
      issuer: "iss",
      subject: "sub",
      claims: { role: "admin", scopes: ["read"] },
    });
  });

  it("defaults all four fields when no vdc is supplied", async () => {
    const { observer, path } = newObserver();
    observer.observe(action());
    await observer.close();
    const [rec] = readRecords(path);
    assert.deepEqual(rec!.vdc, {
      mandate_id: null,
      issuer: null,
      subject: null,
      claims: {},
    });
  });

  it("defaults the missing fields when only mandate_id is supplied", async () => {
    const { observer, path } = newObserver();
    observer.observe(action({ vdc: { mandate_id: "only-this" } }));
    await observer.close();
    const [rec] = readRecords(path);
    assert.deepEqual(rec!.vdc, {
      mandate_id: "only-this",
      issuer: null,
      subject: null,
      claims: {},
    });
  });
});

describe("namespaced extension pass-through", () => {
  it("copies x-<orgslug>-* fields from the action to the record top level", async () => {
    const { observer, path } = newObserver();
    observer.observe(action({ "x-acmeco-trace_id": "abc123" }));
    await observer.close();
    const [rec] = readRecords(path);
    assert.equal(rec!["x-acmeco-trace_id"], "abc123");
  });

  it("copies x-<orgslug>-* fields from the supplied vdc into the envelope", async () => {
    const { observer, path } = newObserver();
    observer.observe(
      action({ vdc: { mandate_id: "m-1", "x-acmeco-purpose": "audit" } }),
    );
    await observer.close();
    const [rec] = readRecords(path);
    assert.deepEqual(rec!.vdc, {
      mandate_id: "m-1",
      issuer: null,
      subject: null,
      claims: {},
      "x-acmeco-purpose": "audit",
    });
  });

  it("does not emit reserved or non-namespaced extra fields", async () => {
    const { observer, path } = newObserver();
    const input = {
      ...action(),
      posteria_internal: "reserved",
      arbitrary_field: "nope",
      "x-acmeco": "missing-suffix",
    } as AuditAction;
    observer.observe(input);
    await observer.close();
    const [rec] = readRecords(path);
    assert.equal("posteria_internal" in rec!, false);
    assert.equal("arbitrary_field" in rec!, false);
    assert.equal("x-acmeco" in rec!, false);
  });
});

describe("record envelope", () => {
  it("emits the pinned version/decision constants and a package-matching observer_version", async () => {
    const { observer, path } = newObserver();
    observer.observe(action());
    await observer.close();
    const [rec] = readRecords(path);

    const pkg = JSON.parse(
      read(
        join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"),
        "utf8",
      ),
    ) as { version: string };

    assert.equal(rec!.record_version, "0.1.0");
    assert.equal(rec!.decision, "allow");
    assert.equal(rec!.decision_reason, "observer_short_circuit");
    assert.equal(rec!.observer_version, pkg.version);
    assert.equal(rec!.action_kind, "tool_call");
    assert.equal(rec!.action_signature, "search(q)");
  });

  it("produces unique record_ids across many calls", async () => {
    const { observer, path } = newObserver();
    const n = 10_000;
    for (let i = 0; i < n; i++) observer.observe(action());
    await observer.close();
    const ids = readRecords(path).map((r) => r.record_id);
    assert.equal(new Set(ids).size, n);
  });

  it("stamps recorded_at as RFC 3339 within ±1s of now", async () => {
    const { observer, path } = newObserver();
    const before = Date.now();
    observer.observe(action());
    await observer.close();
    const [rec] = readRecords(path);
    const ts = Date.parse(rec!.recorded_at as string);
    assert.ok(!Number.isNaN(ts), "recorded_at must parse as a date");
    assert.ok(Math.abs(ts - before) < 1000, "recorded_at within ±1s");
  });
});

describe("close semantics", () => {
  it("after close() resolves, exactly N records are durable", async () => {
    const { observer, path } = newObserver();
    const n = 500;
    for (let i = 0; i < n; i++) observer.observe(action());
    await observer.close();
    assert.equal(readRecords(path).length, n);
  });

  it("close() is idempotent and the second call resolves promptly", async () => {
    const { observer } = newObserver();
    observer.observe(action());
    await observer.close();
    const start = process.hrtime.bigint();
    await observer.close();
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(elapsedMs < 5, `second close took ${elapsedMs}ms`);
  });
});

describe("config", () => {
  it("is read-only — mutation throws and the value is unchanged", async () => {
    const { observer, path } = newObserver();
    assert.throws(() => {
      (observer.config as { audit_stream_path: string }).audit_stream_path =
        "/tmp/other";
    });
    assert.equal(observer.config.audit_stream_path, path);
    await observer.close();
  });

  it("includes host_metadata in the record when configured", async () => {
    const path = join(dir, "audit.jsonl");
    const observer = createObserver({
      audit_stream_path: path,
      host_metadata: { region: "us-east-1" },
    });
    observer.observe(action());
    await observer.close();
    const [rec] = readRecords(path);
    assert.deepEqual(rec!.host_metadata, { region: "us-east-1" });
  });

  it("omits host_metadata from the record when it is empty (default)", async () => {
    const { observer, path } = newObserver();
    observer.observe(action());
    await observer.close();
    const [rec] = readRecords(path);
    assert.equal("host_metadata" in rec!, false);
  });
});
