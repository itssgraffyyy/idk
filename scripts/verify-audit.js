import { DatabaseSync } from "node:sqlite";
import { resolve, join } from "node:path";
import { auditPaths, verifyAudit } from "../src/audit-integrity.js";
const dir = resolve(process.env.DATA_DIR || "data");
let db;
try {
  db = new DatabaseSync(join(dir, "sentinel.sqlite"), { readOnly: true });
  const result = verifyAudit(
    db,
    auditPaths(dir, {
      keyFile: process.env.AUDIT_KEY_FILE,
      checkpointFile: process.env.AUDIT_CHECKPOINT_FILE,
    }),
  );
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  process.stderr.write(
    "Audit verification failed: " +
      (error.status
        ? error.message
        : "Unavailable database or integrity metadata") +
      "\n",
  );
  process.exitCode = 1;
} finally {
  db?.close();
}
