import assert from "node:assert/strict";
import dns from "node:dns";
import fs, { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { createObserver, type AuditAction } from "../src/index.js";
import { emitTelemetryNoop, TELEMETRY_NOOP } from "../src/telemetry.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "posteria-observer-telemetry-"));
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

describe("telemetry — default-off reachability", () => {
  it("never invokes the telemetry seam when enable_anon_telemetry is false (default)", async () => {
    const path = join(dir, "audit.jsonl");
    const spy = mock.fn();
    const observer = createObserver(
      { audit_stream_path: path },
      { telemetry: spy },
    );
    for (let i = 0; i < 25; i++) observer.observe(action());
    await observer.close();
    assert.equal(spy.mock.callCount(), 0);
  });
});

describe("telemetry — opt-in reachability (direct)", () => {
  it("emitTelemetryNoop returns the sentinel synchronously", () => {
    const result = emitTelemetryNoop();
    assert.equal(result, TELEMETRY_NOOP);
    // Synchronous: the return value is the literal sentinel string, not a
    // thenable/Promise that would defer side effects.
    assert.equal(typeof result, "string");
  });
});

describe("telemetry — opt-in reachability (wired)", () => {
  it("invokes the telemetry seam exactly once per observe() when enabled", async () => {
    const path = join(dir, "audit.jsonl");
    const spy = mock.fn();
    const observer = createObserver(
      { audit_stream_path: path, enable_anon_telemetry: true },
      { telemetry: spy },
    );
    const n = 7;
    for (let i = 0; i < n; i++) observer.observe(action());
    await observer.close();
    assert.equal(spy.mock.callCount(), n);
  });
});

describe("telemetry — no network side effects with the real stub", () => {
  it("opens no sockets and issues no DNS/HTTP/HTTPS requests across observe()+close()", async () => {
    const netSpy = mock.method(net, "createConnection");
    const httpSpy = mock.method(http, "request");
    const httpsSpy = mock.method(https, "request");
    const dnsSpy = mock.method(dns, "lookup");

    const path = join(dir, "audit.jsonl");
    // Real stub: no internals supplied.
    const observer = createObserver({
      audit_stream_path: path,
      enable_anon_telemetry: true,
    });
    observer.observe(action());
    await observer.close();

    assert.equal(netSpy.mock.callCount(), 0);
    assert.equal(httpSpy.mock.callCount(), 0);
    assert.equal(httpsSpy.mock.callCount(), 0);
    assert.equal(dnsSpy.mock.callCount(), 0);
  });
});

describe("telemetry — no audit-stream read with the real stub", () => {
  it("does not read the audit-stream path via readFile/createReadStream", async () => {
    const readFileSpy = mock.method(fs, "readFile");
    const readStreamSpy = mock.method(fs, "createReadStream");

    const path = join(dir, "audit.jsonl");
    const observer = createObserver({
      audit_stream_path: path,
      enable_anon_telemetry: true,
    });
    observer.observe(action());
    await observer.close();

    // Writes by the sink are fine; assert specifically that the audit path is
    // never opened for reading by the telemetry stub.
    const readAudit = (spy: {
      mock: { calls: ReadonlyArray<{ arguments: unknown[] }> };
    }): boolean => spy.mock.calls.some((call) => call.arguments[0] === path);

    assert.equal(readAudit(readFileSpy), false);
    assert.equal(readAudit(readStreamSpy), false);
  });
});
