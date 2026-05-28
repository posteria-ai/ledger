import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createAuditSink } from "../src/audit-sink.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "posteria-sink-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readLines(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  return raw.length === 0 ? [] : raw.split("\n").filter((l) => l.length > 0);
}

describe("audit sink — NDJSON write semantics", () => {
  it("writes exactly N parseable JSON objects, one per line", async () => {
    const path = join(dir, "audit.jsonl");
    const sink = createAuditSink({ path, handleSighup: false });
    const n = 50;
    for (let i = 0; i < n; i++) sink.write({ i, kind: "tool_call" });
    await sink.close();

    const lines = readLines(path);
    assert.equal(lines.length, n);
    lines.forEach((line, i) => {
      const obj = JSON.parse(line);
      assert.equal(obj.i, i);
    });
  });

  it("emits no embedded raw newlines and no trailing whitespace per line", async () => {
    const path = join(dir, "audit.jsonl");
    const sink = createAuditSink({ path, handleSighup: false });
    sink.write({ note: "value with\nembedded newline and trailing space   " });
    await sink.close();

    const raw = readFileSync(path, "utf8");
    assert.equal(raw.endsWith("\n"), true);
    const lines = readLines(path);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], lines[0]!.trimEnd());
    assert.equal(JSON.parse(lines[0]!).note.includes("\n"), true); // escaped, not raw
  });

  it("appends rather than truncating across sink instances", async () => {
    const path = join(dir, "audit.jsonl");
    const a = createAuditSink({ path, handleSighup: false });
    a.write({ phase: "first" });
    await a.close();

    const b = createAuditSink({ path, handleSighup: false });
    b.write({ phase: "second" });
    await b.close();

    const lines = readLines(path);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]!).phase, "first");
    assert.equal(JSON.parse(lines[1]!).phase, "second");
  });
});

describe("audit sink — concurrent writes serialize", () => {
  it("never produces partial or concatenated lines under many concurrent writes", async () => {
    const path = join(dir, "audit.jsonl");
    const sink = createAuditSink({ path, handleSighup: false });
    const n = 2000;
    for (let i = 0; i < n; i++) {
      sink.write({ seq: i, payload: "x".repeat(100) });
    }
    await sink.close();

    const lines = readLines(path);
    assert.equal(lines.length, n);
    const seqs = new Set<number>();
    for (const line of lines) {
      const obj = JSON.parse(line); // throws if a line is partial/concatenated
      seqs.add(obj.seq);
    }
    assert.equal(seqs.size, n);
  });
});

describe("audit sink — durability via close/flush", () => {
  it("all records are durable on disk after close() resolves", async () => {
    const path = join(dir, "audit.jsonl");
    const sink = createAuditSink({ path, handleSighup: false });
    const n = 100;
    for (let i = 0; i < n; i++) sink.write({ i });
    await sink.close();
    assert.equal(readLines(path).length, n);
  });

  it("flush() drains pending writes without closing", async () => {
    const path = join(dir, "audit.jsonl");
    const sink = createAuditSink({ path, handleSighup: false });
    sink.write({ a: 1 });
    await sink.flush();
    assert.equal(readLines(path).length, 1);
    sink.write({ a: 2 });
    await sink.close();
    assert.equal(readLines(path).length, 2);
  });
});

describe("audit sink — missing parent directory", () => {
  it("throws at construction naming the missing directory", () => {
    const missing = join(dir, "nonexistent-dir");
    const path = join(missing, "foo.jsonl");
    assert.throws(
      () => createAuditSink({ path, handleSighup: false }),
      (err: Error) => err.message.includes(missing),
    );
  });

  it("does NOT silently create the parent directory", () => {
    const missing = join(dir, "nonexistent-dir");
    const path = join(missing, "foo.jsonl");
    try {
      createAuditSink({ path, handleSighup: false });
    } catch {
      // expected
    }
    assert.equal(existsSync(missing), false);
  });
});

describe("audit sink — SIGHUP re-open", () => {
  it("changes the file descriptor on SIGHUP and keeps writing to the same path", async () => {
    const path = join(dir, "audit.jsonl");
    const reopened = new Promise<{ previousFd: number; fd: number }>(
      (resolve) => {
        const sink = createAuditSink({
          path,
          onReopen: (info) => {
            resolve(info);
            void sink.close();
          },
        });
        sink.write({ before: true });
        process.kill(process.pid, "SIGHUP");
      },
    );

    const info = await reopened;
    assert.notEqual(info.fd, info.previousFd);
    // The record written before SIGHUP survived the rotation flush.
    assert.equal(readLines(path).length, 1);
  });

  it("reopen() acquires a new fd at the same path", async () => {
    const path = join(dir, "audit.jsonl");
    const sink = createAuditSink({ path, handleSighup: false });
    const before = sink.fd;
    sink.write({ n: 1 });
    await sink.reopen();
    assert.notEqual(sink.fd, before);
    sink.write({ n: 2 });
    await sink.close();
    assert.equal(readLines(path).length, 2);
  });
});

describe("audit sink — close idempotency", () => {
  it("close() twice is safe and the second resolves promptly", async () => {
    const path = join(dir, "audit.jsonl");
    const sink = createAuditSink({ path, handleSighup: false });
    sink.write({ a: 1 });
    await sink.close();
    const start = process.hrtime.bigint();
    await sink.close();
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(elapsedMs < 5, `second close took ${elapsedMs}ms`);
  });

  it("write after close throws", async () => {
    const path = join(dir, "audit.jsonl");
    const sink = createAuditSink({ path, handleSighup: false });
    await sink.close();
    assert.throws(() => sink.write({ a: 1 }), /closed/);
  });
});
