import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createObserver } from "../src/index.js";

describe("createObserver", () => {
  it("exposes the v0.1 public API stub", () => {
    assert.throws(
      () => createObserver(),
      /not implemented/i,
    );
  });
});
