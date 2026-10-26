import { createApp, seed } from "../src/server.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const dir = mkdtempSync(join(tmpdir(), "sentinel-browser-")),
  app = createApp({ dir });
seed(app.db, [
  {
    id: "admin",
    email: "admin@test.local",
    password: "test-admin-password",
    role: "institution_admin",
    tenant: "fictional",
  },
  {
    id: "supervisor",
    email: "supervisor@test.local",
    password: "test-supervisor-password",
    role: "supervisor",
    tenant: "authority",
  },
  {
    id: "auditor",
    email: "auditor@test.local",
    password: "test-auditor-password",
    role: "audit_reviewer",
    tenant: "authority",
  },
  {
    id: "a",
    email: "institution@test.local",
    password: "test-institution-password",
    role: "institution",
    tenant: "fictional",
  },
  {
    id: "o",
    email: "officer@test.local",
    password: "test-officer-password",
    role: "officer",
    tenant: "authority",
  },
]);
try {
  await new Promise((ok, no) =>
    app.server.once("error", no).listen(3107, "127.0.0.1", ok),
  );
  const child = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test"],
    {
      env: { ...process.env, EXTERNAL_SERVER: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
  const code = await new Promise((ok, no) => {
    child.once("error", no);
    child.once("exit", ok);
  });
  process.exitCode = code ?? 1;
  writeFileSync(
    process.env.BROWSER_REPORT_PATH || "docs/evaluation/current-browser.txt",
    output,
  );
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
