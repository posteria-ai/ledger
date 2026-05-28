import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
