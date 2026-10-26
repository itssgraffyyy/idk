import { IFSCProvider } from "../src/ifsc.js";
import { writeFileSync } from "node:fs";
const r = await new IFSCProvider({ timeoutMs: 10000 }).lookup("HDFC0000001");
writeFileSync(
  "docs/evaluation/ifsc-live-check.json",
  JSON.stringify(r, null, 2),
);
console.log(
  JSON.stringify({
    status: r.status,
    mode: r.mode,
    version: r.version,
    bank: r.bank,
    branch: r.branch,
    realBankValidation: r.realBankValidation,
    independentDepositConfirmation: r.independentDepositConfirmation,
    retrievedAt: r.retrievedAt,
  }),
);
if (r.mode !== "public_service") process.exitCode = 1;
