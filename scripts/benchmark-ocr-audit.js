import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extract } from "../src/extraction.js";
const exec = promisify(execFile),
  dataset = JSON.parse(readFileSync("datasets/v1/cases.json")),
  baseline = JSON.parse(readFileSync("docs/evaluation/ocr-results.json")),
  fields = ["reference", "amountPaise", "bank", "ifsc", "issued", "matures"],
  rows = [];
function metrics(selected) {
  const stats = Object.fromEntries(
    fields.map((f) => [
      f,
      {
        present: 0,
        correctPresent: 0,
        extracted: 0,
        absent: 0,
        falseExtractions: 0,
        exactIncludingAbsent: 0,
      },
    ]),
  );
  for (const c of selected) {
    const row = rows.find((x) => x.id === c.id),
      x = row?.fields || {};
    for (const f of fields) {
      const m = stats[f],
        expected = c.groundTruth.extracted[f],
        actual = x[f]?.value;
      if (expected !== undefined) {
        m.present++;
        if (actual === expected) m.correctPresent++;
      } else {
        m.absent++;
        if (actual !== undefined) m.falseExtractions++;
      }
      if (actual !== undefined) m.extracted++;
      if ((actual ?? null) === (expected ?? null)) m.exactIncludingAbsent++;
    }
  }
  return Object.fromEntries(
    Object.entries(stats).map(([f, m]) => [
      f,
      {
        ...m,
        presentFieldExactMatch: m.correctPresent / m.present,
        coverageOfPresent: m.extracted / (m.present || 1),
        slotExactMatch: m.exactIncludingAbsent / selected.length,
      },
    ]),
  );
}
for (const c of dataset.cases) {
  const start = performance.now();
  try {
    const { stdout } = await exec(
      process.execPath,
      ["src/ocr-worker.js", "datasets/v1/documents/" + c.id + ".png"],
      { timeout: 60000, maxBuffer: 4194304, windowsHide: true },
    );
    const raw = JSON.parse(stdout);
    rows.push({
      id: c.id,
      split: c.split,
      layout: c.layout,
      fields: extract(raw.text, { blocks: raw.blocks }),
      durationMs: performance.now() - start,
      rawText: raw.text,
      rotation: raw.rotation,
      documentConfidence: raw.confidence,
      status: "completed",
    });
    console.log(c.id + " processed");
  } catch (e) {
    rows.push({
      id: c.id,
      split: c.split,
      layout: c.layout,
      status: "failed",
      durationMs: performance.now() - start,
      error: e.message,
    });
  }
}
const result = {
  datasetVersion: dataset.version,
  engine: "tesseract.js 7 local English; label-parser-v2",
  node: process.version,
  configuration: {
    heldOutLayout: "C",
    heldOutCases: 4,
    sourceDocumentsUnchanged: true,
    tuning:
      "Development case001 only; no OCR character substitutions or declaration-derived values",
  },
  baselineAggregate: baseline.fieldExactMatch,
  all: metrics(dataset.cases),
  development: metrics(dataset.cases.filter((c) => c.split === "development")),
  heldOut: metrics(dataset.cases.filter((c) => c.split === "held-out")),
  failureRate: rows.filter((r) => r.status === "failed").length / rows.length,
  meanMs: rows.reduce((n, r) => n + r.durationMs, 0) / rows.length,
  rows,
};
writeFileSync(
  "docs/evaluation/ocr-audit-results.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
if (result.failureRate) process.exitCode = 1;
