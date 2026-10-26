import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extract, evaluate, fields } from "../src/engine.js";
const dataset = JSON.parse(readFileSync("datasets/v1/cases.json")),
  start = performance.now(),
  failures = [],
  times = [];
let exact = 0,
  total = 0,
  covered = 0,
  tp = 0,
  fp = 0,
  fn = 0,
  tn = 0,
  policy = 0,
  missing = 0,
  present = 0,
  presentCorrect = 0;
const universe = new Set([
  "amount_shortfall",
  "date_order",
  "expired",
  "bank_confirmation",
  "mock_only",
  "policy_unverified",
  "duplicate_reference",
  ...fields.flatMap((k) => ["missing_" + k, "mismatch_" + k, "external_" + k]),
]);
for (const c of dataset.cases) {
  const s = performance.now(),
    x = extract(c.text);
  for (const f of fields) {
    total++;
    if (x[f]) covered++;
    if (c.groundTruth.extracted[f] !== undefined) {
      present++;
      if (x[f]?.value === c.groundTruth.extracted[f]) presentCorrect++;
    }
    if ((x[f]?.value ?? null) === (c.groundTruth.extracted[f] ?? null)) exact++;
  }
  const r = evaluate({ ...c, extraction: x, asOf: "2026-10-26" }),
    actual = new Set(r.findings.map((f) => f.code)),
    expected = new Set(c.groundTruth.expectedCodes);
  for (const k of universe) {
    if (expected.has(k)) {
      if (actual.has(k)) tp++;
      else {
        fn++;
        failures.push(c.id + ": missing " + k);
      }
    } else if (actual.has(k)) {
      fp++;
      failures.push(c.id + ": unexpected " + k);
    } else tn++;
  }
  if (r.policyVersion === c.groundTruth.policyVersion) policy++;
  if (c.external.status === "unavailable" && actual.has("bank_confirmation"))
    missing++;
  times.push(performance.now() - s);
}
const result = {
  datasetVersion: dataset.version,
  node: process.version,
  configuration: {
    asOf: "2026-10-26",
    input: "UTF-8 text fixtures; this is NOT an OCR benchmark",
    cases: dataset.cases.length,
    heldOut: dataset.cases.filter((c) => c.split === "held-out").length,
  },
  textImport: {
    fieldExactMatch: exact / total,
    presentFieldAccuracy: presentCorrect / present,
    coverage: covered / total,
    fields: total,
    processingMs: performance.now() - start,
  },
  reconciliation: {
    precision: tp / (tp + fp),
    recall: tp / (tp + fn),
    falsePositiveRate: fp / (fp + tn),
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    trueNegative: tn,
    unavailableHandled: missing,
  },
  unverifiedPolicyIdentifierCorrect: policy / dataset.cases.length,
  localEngineLatencyMs: {
    mean: times.reduce((a, b) => a + b, 0) / times.length,
    max: Math.max(...times),
  },
  failures,
};
mkdirSync("docs/evaluation", { recursive: true });
writeFileSync("docs/evaluation/results.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
