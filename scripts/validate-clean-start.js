import { mkdtempSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile),
  dir = mkdtempSync(join(tmpdir(), "sentinel-clean-"));
const runtimeEnv = { ...process.env };
const pathKey =
  Object.keys(runtimeEnv).find((k) => k.toLowerCase() === "path") || "PATH";
runtimeEnv[pathKey] =
  dirname(process.execPath) + delimiter + (runtimeEnv[pathKey] || "");
try {
  for (const p of [
    "package.json",
    "package-lock.json",
    "src",
    "public",
    "resources",
  ])
    cpSync(p, join(dir, p), { recursive: true });
  mkdirSync(join(dir, "scripts"));
  for (const p of ["setup.js", "clean-probe.js"])
    cpSync("scripts/" + p, join(dir, "scripts", p));
  const install =
    process.platform === "win32"
      ? [
          process.env.ComSpec || "cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            "npm ci --omit=dev --ignore-scripts --no-audit --fund=false",
          ],
        ]
      : [
          "npm",
          [
            "ci",
            "--omit=dev",
            "--ignore-scripts",
            "--no-audit",
            "--fund=false",
          ],
        ];
  await exec(install[0], install[1], {
    cwd: dir,
    env: runtimeEnv,
    timeout: 240000,
    maxBuffer: 1048576,
    windowsHide: true,
  });
  const env = {
    ...runtimeEnv,
    DATA_DIR: join(dir, "data"),
    AUDIT_KEY_FILE: join(dir, "data", "security", "audit.key"),
    AUDIT_CHECKPOINT_FILE: join(
      dir,
      "data",
      "security",
      "audit-checkpoint.json",
    ),
    MFA_KEY_FILE: join(dir, "data", "security", "mfa.key"),
    MFA_REQUIRED_ROLES: "",
    POLICY_FILE: "",
    PROCEDURE_FILE: "",
    PROCEDURE_CONFIRMATIONS_FILE: "",
    CLAMAV_HOST: "",
    UPLOAD_SCAN_REQUIRED: "false",
    COOKIE_SECURE: "false",
    TESSERACT_PATH: "",
  };
  const setup = await exec(process.execPath, ["scripts/setup.js"], {
    cwd: dir,
    env,
    windowsHide: true,
  });
  const credential = setup.stdout
    .split(/\r?\n/)
    .find((s) => s.startsWith("institution@sentinel.local "))
    ?.trim()
    .split(/\s+/);
  if (!credential) throw Error("Clean provisioning failed");
  const second = await exec(process.execPath, ["scripts/setup.js"], {
    cwd: dir,
    env,
    windowsHide: true,
  });
  if (second.stdout.trim()) throw Error("Setup unexpectedly reset accounts");
  const result = await exec(process.execPath, ["scripts/clean-probe.js"], {
    cwd: dir,
    env: { ...env, PROBE_EMAIL: credential[0], PROBE_PASSWORD: credential[1] },
    timeout: 90000,
    maxBuffer: 1048576,
    windowsHide: true,
  });
  const report = {
    command: "node scripts/validate-clean-start.js",
    cleanNpmCi: true,
    provisioningIdempotent: true,
    ...JSON.parse(result.stdout),
  };
  mkdirSync("docs/evaluation", { recursive: true });
  writeFileSync(
    "docs/evaluation/clean-start.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
