import { resolve } from "node:path";
import { createBackup, verifyBackup, restoreBackup } from "../src/backup.js";
const [action, ...rest] = process.argv.slice(2),
  args = {};
for (const item of rest) {
  const match = item.match(/^--(source|archive|output)=(.+)$/);
  if (!match || args[match[1]])
    throw Error("Use explicit --source=, --archive= and --output= paths");
  args[match[1]] = match[2];
}
try {
  const keys = {
    auditKeyFile: process.env.AUDIT_KEY_FILE,
    mfaKeyFile: process.env.MFA_KEY_FILE,
  };
  let result;
  if (action === "create")
    result = await createBackup({
      dir: resolve(args.source || process.env.DATA_DIR || "data"),
      output: args.output,
      ...keys,
      auditCheckpointFile: process.env.AUDIT_CHECKPOINT_FILE,
    });
  else if (action === "verify") {
    const verified = await verifyBackup({ archive: args.archive, ...keys });
    result = {
      valid: true,
      id: verified.manifest.id,
      counts: verified.manifest.counts,
      keysIncluded: false,
    };
  } else if (action === "restore")
    result = await restoreBackup({
      archive: args.archive,
      output: args.output,
      ...keys,
    });
  else
    throw Error(
      "Choose create, verify or restore; restore never overwrites an existing destination",
    );
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  process.stderr.write(
    "Backup operation failed: " +
      (error.status
        ? error.message
        : "Invalid path, configuration or unavailable archive") +
      "\n",
  );
  process.exitCode = 1;
}
