import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extract, fields } from "../src/engine.js";
const exec = promisify(execFile),
  dataset = JSON.parse(readFileSync("datasets/v1/cases.json")),
  rows = [];
let total = 0,
  correct = 0,
  covered = 0,
  failures = 0;
for (const c of dataset.cases) {
  const start = performance.now();
  try {
    const r = await exec(
        process.execPath,
        ["src/ocr-worker.js", "datasets/v1/documents/" + c.id + ".png"],
        { timeout: 60000, maxBuffer: 4194304, windowsHide: true },
      ),
      raw = JSON.parse(r.stdout),
      x = extract(raw.text);
    let matched = 0;
    for (const f of fields) {
      total++;
      if (x[f]) covered++;
      if ((x[f]?.value ?? null) === (c.groundTruth.extracted[f] ?? null)) {
        correct++;
        matched++;
      }
    }
    rows.push({
      id: c.id,
      split: c.split,
      layout: c.layout,
      scenario: c.scenario,
      matched,
      total: fields.length,
      documentConfidence: raw.confidence,
      durationMs: performance.now() - start,
      extracted: x,
    });
    console.log(c.id + ": " + matched + "/" + fields.length);
  } catch (e) {
    failures++;
    total += fields.length;
    rows.push({
      id: c.id,
      status: "failed",
      error: e.message,
      durationMs: performance.now() - start,
    });
  }
}
const result = {
  datasetVersion: dataset.version,
  engine: "tesseract.js 7, locally packaged English model",
  node: process.version,
  cases: rows.length,
  fieldExactMatch: correct / total,
  coverage: covered / total,
  failureRate: failures / rows.length,
  criticalReferenceExactMatch:
    rows.filter(
      (r) =>
        r.extracted?.reference?.value ===
        dataset.cases.find((c) => c.id === r.id).groundTruth.extracted
          .reference,
    ).length / rows.length,
  meanDocumentProcessingMs:
    rows.reduce((a, r) => a + r.durationMs, 0) / rows.length,
  rows,
};
writeFileSync(
  "docs/evaluation/ocr-results.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
