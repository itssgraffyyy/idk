import { createApp, seed } from "../src/server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const dir = mkdtempSync(join(tmpdir(), "sentinel-browser-")),
  app = createApp({ dir });
seed(app.db, [
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
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const code = await new Promise((ok, no) => {
    child.once("error", no);
    child.once("exit", ok);
  });
  process.exitCode = code ?? 1;
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
