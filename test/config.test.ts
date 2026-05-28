import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_AUDIT_STREAM_PATH } from "../src/index.js";
import { resolveConfig } from "../src/config.js";

const silent = () => {};

describe("resolveConfig — defaults", () => {
  it("returns contract defaults with all-empty inputs", () => {
    const config = resolveConfig({ env: {}, argv: [], warn: silent });
    assert.equal(config.audit_stream_path, DEFAULT_AUDIT_STREAM_PATH);
    assert.equal(config.enable_anon_telemetry, false);
    assert.deepEqual(config.host_metadata, {});
  });

  it("returns a fresh host_metadata object per call (no shared default)", () => {
    const a = resolveConfig({ env: {}, argv: [], warn: silent });
    const b = resolveConfig({ env: {}, argv: [], warn: silent });
    assert.notEqual(a.host_metadata, b.host_metadata);
  });
});

describe("resolveConfig — precedence (later wins)", () => {
  it("uses env when no programmatic value is given", () => {
    const config = resolveConfig({
      env: { POSTERIA_OBSERVER_AUDIT_STREAM_PATH: "/tmp/from-env" },
      argv: [],
      warn: silent,
    });
    assert.equal(config.audit_stream_path, "/tmp/from-env");
  });

  it("env overrides programmatic", () => {
    const config = resolveConfig({
      programmatic: { audit_stream_path: "/tmp/a" },
      env: { POSTERIA_OBSERVER_AUDIT_STREAM_PATH: "/tmp/b" },
      argv: [],
      warn: silent,
    });
    assert.equal(config.audit_stream_path, "/tmp/b");
  });

  it("CLI overrides env", () => {
    const config = resolveConfig({
      programmatic: { audit_stream_path: "/tmp/a" },
      env: { POSTERIA_OBSERVER_AUDIT_STREAM_PATH: "/tmp/b" },
      argv: ["--audit-stream-path=/tmp/c"],
      warn: silent,
    });
    assert.equal(config.audit_stream_path, "/tmp/c");
  });

  it("supports space-separated CLI string values", () => {
    const config = resolveConfig({
      argv: ["--audit-stream-path", "/tmp/spaced"],
      env: {},
      warn: silent,
    });
    assert.equal(config.audit_stream_path, "/tmp/spaced");
  });
});

describe("resolveConfig — typed env parsing", () => {
  it("parses boolean env true case-insensitively", () => {
    const config = resolveConfig({
      env: { POSTERIA_OBSERVER_ENABLE_ANON_TELEMETRY: "TRUE" },
      argv: [],
      warn: silent,
    });
    assert.equal(config.enable_anon_telemetry, true);
  });

  it("parses boolean env false", () => {
    const config = resolveConfig({
      env: { POSTERIA_OBSERVER_ENABLE_ANON_TELEMETRY: "false" },
      argv: [],
      warn: silent,
    });
    assert.equal(config.enable_anon_telemetry, false);
  });

  it("parses object env as JSON", () => {
    const config = resolveConfig({
      env: { POSTERIA_OBSERVER_HOST_METADATA: '{"region":"us-east-1"}' },
      argv: [],
      warn: silent,
    });
    assert.deepEqual(config.host_metadata, { region: "us-east-1" });
  });

  it("warns and ignores an invalid boolean env value", () => {
    const warnings: string[] = [];
    const config = resolveConfig({
      env: { POSTERIA_OBSERVER_ENABLE_ANON_TELEMETRY: "yes" },
      argv: [],
      warn: (m) => warnings.push(m),
    });
    assert.equal(config.enable_anon_telemetry, false);
    assert.ok(warnings.some((m) => m.includes("ENABLE_ANON_TELEMETRY")));
  });

  it("warns and ignores invalid JSON for an object env value", () => {
    const warnings: string[] = [];
    const config = resolveConfig({
      env: { POSTERIA_OBSERVER_HOST_METADATA: "{not json}" },
      argv: [],
      warn: (m) => warnings.push(m),
    });
    assert.deepEqual(config.host_metadata, {});
    assert.ok(warnings.some((m) => m.includes("HOST_METADATA")));
  });

  it("parses a CLI boolean flag passed bare as true", () => {
    const config = resolveConfig({
      argv: ["--enable-anon-telemetry"],
      env: {},
      warn: silent,
    });
    assert.equal(config.enable_anon_telemetry, true);
  });
});

describe("resolveConfig — unknown keys", () => {
  it("warns on an unknown programmatic key but still resolves", () => {
    const warnings: string[] = [];
    const config = resolveConfig({
      programmatic: { unknown_key: true } as never,
      env: {},
      argv: [],
      warn: (m) => warnings.push(m),
    });
    assert.ok(warnings.some((m) => m.includes("unknown_key")));
    assert.equal(config.audit_stream_path, DEFAULT_AUDIT_STREAM_PATH);
  });

  it("warns on an unknown POSTERIA_OBSERVER_* env key", () => {
    const warnings: string[] = [];
    resolveConfig({
      env: { POSTERIA_OBSERVER_BOGUS: "x" },
      argv: [],
      warn: (m) => warnings.push(m),
    });
    assert.ok(warnings.some((m) => m.includes("POSTERIA_OBSERVER_BOGUS")));
  });

  it("does not warn on unrelated env vars", () => {
    const warnings: string[] = [];
    resolveConfig({
      env: { PATH: "/usr/bin", HOME: "/home/x" },
      argv: [],
      warn: (m) => warnings.push(m),
    });
    assert.equal(warnings.length, 0);
  });

  it("ignores unrelated CLI flags without warning", () => {
    const warnings: string[] = [];
    resolveConfig({
      argv: ["--some-other-flag=1", "positional"],
      env: {},
      warn: (m) => warnings.push(m),
    });
    assert.equal(warnings.length, 0);
  });
});

describe("resolveConfig — read-only result", () => {
  it("throws on mutation of a resolved key", () => {
    const config = resolveConfig({ env: {}, argv: [], warn: silent });
    assert.throws(() => {
      (config as { audit_stream_path: string }).audit_stream_path = "/tmp/other";
    });
    assert.equal(config.audit_stream_path, DEFAULT_AUDIT_STREAM_PATH);
  });
});
