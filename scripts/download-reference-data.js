import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const sources = [
  [
    "resources/ifsc/by-bank-v2.0.62.tar.gz",
    "https://github.com/razorpay/ifsc/releases/download/v2.0.62/by-bank.tar.gz",
  ],
  [
    "resources/regulatory/aph-2024-27.pdf",
    "https://www.pvpitsangli.edu.in/wp-content/uploads/AICTE-APPROVAL-PROCESS-HANDBOOK-2024-25-2025-26-2026-27.pdf",
  ],
  [
    "resources/regulatory/addendum-2025-26.pdf",
    "https://edu-ecosys.com/AICTE-APH-26-27.pdf",
  ],
  [
    "resources/regulatory/addendum-2026-27.pdf",
    "https://avantiscdnprodstorage.blob.core.windows.net/legalupdatedocs/52940/AICTE-issued-the-Corrigendum-regarding-the-Approval-Process-2026-27-February202026.pdf",
  ],
];
const records = await Promise.all(
  sources.map(async ([path, url]) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw Error("HTTP " + r.status);
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length > 80000000) throw Error("Size bound");
      if (path.endsWith(".pdf") && b.subarray(0, 4).toString() !== "%PDF")
        throw Error("Not PDF");
      mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      writeFileSync(path, b);
      return {
        path,
        url,
        sha256: createHash("sha256").update(b).digest("hex"),
        bytes: b.length,
        retrievedAt: new Date().toISOString(),
        authority: path.includes("/ifsc/")
          ? "public-domain-reference"
          : "AICTE-authored-document-mirror; issuer-host-under-maintenance",
      };
    } catch (e) {
      return { path, url, error: e.message };
    }
  }),
);
mkdirSync("resources", { recursive: true });
writeFileSync(
  "resources/source-manifest.json",
  JSON.stringify(records, null, 2),
);
console.log(JSON.stringify(records, null, 2));
