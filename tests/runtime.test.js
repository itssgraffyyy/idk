import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSupportedRuntime } from "../src/runtime.js";
test("CLI security baseline rejects vulnerable and unqualified runtimes while allowing patched Node22", () => {
  for (const version of [
    "22.13.0",
    "22.14.0",
    "22.23.3",
    "20.19.0",
    "24.22.1",
    "22.23.4-rc.1",
    "invalid",
  ])
    assert.throws(
      () => assertSupportedRuntime(version),
      /requires patched Node/,
    );
  for (const version of ["22.23.4", "22.23.5", "22.24.0"])
    assert.doesNotThrow(() => assertSupportedRuntime(version));
});
