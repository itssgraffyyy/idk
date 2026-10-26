import { createApp, seed } from "../src/server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
app.server.listen(3107, "127.0.0.1");
async function stop() {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
