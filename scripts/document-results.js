import { readFileSync, writeFileSync } from "node:fs";
const r = JSON.parse(readFileSync("docs/evaluation/results.json")),
  ocr = JSON.parse(readFileSync("docs/evaluation/ocr-results.json")),
  sys = JSON.parse(readFileSync("docs/evaluation/system-results.json")),
  pct = (n) => (n * 100).toFixed(1) + "%";
writeFileSync(
  "docs/evaluation/results.md",
  `# Measured local results
Dataset: ${r.datasetVersion}; Node ${r.node}; Windows; reference date 26 October 2026.
Machine-specific measurements are committed in adjacent JSON files.

| Measurement | Result |
|---|---|
| Text-import exact match (including absent fields) | ${pct(r.textImport.fieldExactMatch)} over ${r.textImport.fields} slots |
| Text present-field accuracy | ${pct(r.textImport.presentFieldAccuracy)} |
| Text field coverage | ${pct(r.textImport.coverage)} |
| Reconciliation precision / recall | ${pct(r.reconciliation.precision)} / ${pct(r.reconciliation.recall)} |
| Reconciliation false-positive rate | ${pct(r.reconciliation.falsePositiveRate)} |
| Real raster OCR field exact match | ${pct(ocr.fieldExactMatch)} |
| Raster OCR reference exact match | ${pct(ocr.criticalReferenceExactMatch)} |
| Raster OCR field coverage | ${pct(ocr.coverage)} |
| Raster OCR processing failure rate | ${pct(ocr.failureRate)} |
| Mean raster document processing | ${ocr.meanDocumentProcessingMs.toFixed(1)} ms |
| Authenticated API GET /cases p50 / p95 | ${sys.latencyMs.p50.toFixed(2)} / ${sys.latencyMs.p95.toFixed(2)} ms |

OCR's 0% process-failure rate does not mean all fields were correct. IFSC character recognition remains a known weakness. Rotation retry recovered the rotated fixture. Field confidence is not calibrated. These are 20 synthetic documents; no real-bank generalization or production SLA is claimed.

Reconciliation expected outcomes are manually specified scenario expectations; perfect synthetic scores do not validate banking authenticity or regulatory correctness. Policy tests use synthetic rules and check unsupported/date/scope/exemption safety. No verified AICTE rules have been benchmarked.

Executed test evidence is summarized in implementation-report.md and actual test artifacts. UTF-8 parser and image OCR results are deliberately separate.
`,
);
