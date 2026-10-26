import { writeFileSync, mkdirSync } from "node:fs";
const urls = [
  "https://www.aicte.gov.in/",
  "https://www.aicte.gov.in/sites/default/files/APH%20Final.pdf",
  "https://www.aicte.gov.in/sites/default/files/approval/APH%20Final.pdf",
  "https://aicte-india.org/",
];
const results = [];
for (const url of urls) {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    const reader = r.body?.getReader();
    const first = reader ? await reader.read() : null;
    await reader?.cancel();
    results.push({
      url,
      status: r.status,
      contentType: r.headers.get("content-type"),
      prefix: new TextDecoder().decode(
        first?.value?.subarray(0, 200) || new Uint8Array(),
      ),
      issuerPDFConfirmed: false,
    });
  } catch (e) {
    results.push({
      url,
      status: "fetch_failed",
      reason: e.name,
      issuerPDFConfirmed: false,
    });
  }
}
mkdirSync("docs/evaluation/final-gap", { recursive: true });
writeFileSync(
  "docs/evaluation/final-gap/official-source-access.json",
  JSON.stringify(
    {
      command: "node scripts/probe-official-sources.js",
      checkedAt: new Date().toISOString(),
      results,
      limitations:
        "Access checks only. Search results are not issuer-document validation. No regulatory activation permitted from these results.",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(results, null, 2));
