import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("streaming SQLite statements survive forced GC, preserve ordering and allow early exit/consumer failure", async () => {
  const { stdout } = await exec(
    process.execPath,
    ["--expose-gc", "tests/fixtures/sqlite-gc-probe.js"],
    { timeout: 60000, windowsHide: true },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.rows, 250);
  assert.equal(result.passed, true);
  assert.equal(result.forcedGCCycles, 50);
  assert.equal(result.earlyExitAndConsumerFailure, true);
});
