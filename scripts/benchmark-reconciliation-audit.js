import { readFileSync, writeFileSync } from "node:fs";
import { evaluate, extract } from "../src/engine.js";
const d = JSON.parse(readFileSync("datasets/v1/cases.json")),
  rows = [];
let tp = 0,
  fp = 0,
  fn = 0;
for (const c of d.cases) {
  const expected = new Set([
      ...c.groundTruth.expectedCodes,
      "ifsc_unavailable",
      "regulatory_programme_amount",
    ]),
    result = evaluate({
      ...c,
      extraction: extract(c.text),
      asOf: "2026-10-26",
    }),
    actual = new Set(result.findings.map((f) => f.code));
  for (const code of expected) actual.has(code) ? tp++ : fn++;
  for (const code of actual) if (!expected.has(code)) fp++;
  rows.push({
    id: c.id,
    expected: [...expected],
    actual: [...actual],
    outcome: result.outcome,
    pass:
      expected.size === actual.size &&
      [...expected].every((k) => actual.has(k)),
  });
}
const report = {
  datasetVersion: d.version,
  asOf: "2026-10-26",
  configuration:
    "Original v1 ground truth retained; add explicit unavailable fictional IFSC and missing regulatory applicability findings after replacing fictional directory",
  precision: tp / (tp + fp),
  recall: tp / (tp + fn),
  tp,
  fp,
  fn,
  rows,
};
writeFileSync(
  "docs/evaluation/reconciliation-audit-results.json",
  JSON.stringify(report, null, 2),
);
console.log({
  cases: rows.length,
  precision: report.precision,
  recall: report.recall,
  failed: rows.filter((r) => !r.pass).length,
});
if (rows.some((r) => !r.pass)) process.exitCode = 1;
