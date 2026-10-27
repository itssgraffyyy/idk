import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { workerEnvironment } from "../src/worker-environment.js";
test("real document child process receives required paths but no provider credentials, security-key paths or unrelated environment", () => {
  const env = workerEnvironment(
    { DISABLE_SYSTEM_FONTS_LOAD: "1", SENTINEL_TEST_SECRET: "never inherited" },
    {
      ...process.env,
      SENTINEL_TEST_SECRET: "synthetic canary",
      AUDIT_KEY_FILE: "synthetic key path",
      MFA_KEY_FILE: "synthetic MFA path",
      SETU_CLIENT_SECRET: "synthetic provider secret",
    },
  );
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      ["tests/fixtures/worker-environment-probe.js"],
      { env, encoding: "utf8", windowsHide: true },
    ),
  );
  assert.equal(result.canaryPresent, false);
  assert.equal(result.auditKeyPathPresent, false);
  assert.equal(result.mfaKeyPathPresent, false);
  assert.equal(result.providerSecretPresent, false);
  assert.equal(result.fontMode, "1");
  if (process.platform === "win32") assert.equal(result.hasSystemRoot, true);
  assert.ok(!Object.hasOwn(env, "DATA_DIR"));
});
