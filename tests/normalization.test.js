import { test } from "node:test";
import assert from "node:assert/strict";
import { comparable, evaluate } from "../src/engine.js";
test("safe normalization handles bank whitespace and IFSC case without guessing identifier characters", () => {
  assert.equal(
    comparable("bank", " Synthetic   Bank "),
    comparable("bank", "synthetic bank"),
  );
  assert.equal(comparable("ifsc", "synb0000001"), "SYNB0000001");
  assert.notEqual(
    comparable("ifsc", "SYNBO000001"),
    comparable("ifsc", "SYNB0000001"),
  );
  assert.notEqual(
    comparable("reference", "AbC"),
    comparable("reference", "ABC"),
  );
});
