import { join } from "node:path";
import { ClamAVScanner } from "../../src/upload-scanning.js";
// Synthetic fixtures never inherit a developer's issuer registry, scanner,
// encryption-key paths or required-MFA deployment configuration.
export function isolatedAppOptions(dir) {
  return {
    dir,
    ocr: null,
    policies: [],
    procedures: [],
    procedureConfirmations: [],
    mfaRequiredRoles: [],
    cookieSecure: false,
    uploadScanner: new ClamAVScanner(),
    uploadScanRequired: false,
    auditKeyFile: join(dir, "security", "audit.key"),
    auditCheckpointFile: join(dir, "security", "audit-checkpoint.json"),
    mfaKeyFile: join(dir, "security", "mfa.key"),
  };
}
