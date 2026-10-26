import { readFileSync, writeFileSync } from "node:fs";
const path = "docs/evaluation/final-gap/ocr-results.json",
  report = JSON.parse(readFileSync(path));
for (const dataset of report.datasets) {
  for (const row of dataset.rows) {
    row.errorCategory =
      row.status !== "completed"
        ? "processing_failure"
        : row.expected.ifsc === undefined
          ? row.fields.ifsc?.candidates?.length > 1
            ? "ambiguity_correctly_withheld"
            : "correctly_absent"
          : row.fields.ifsc?.value === row.expected.ifsc
            ? row.fields.ifsc.status === "REQUIRES_REVIEW"
              ? "exact_value_still_requires_review"
              : "exact"
            : row.fields.ifsc?.candidates?.length > 1
              ? "ambiguous"
              : !row.fields.ifsc
                ? "label_missing"
                : row.fields.ifsc.value === undefined
                  ? "invalid_syntax_review"
                  : "glyph_confusion_or_unknown";
  }
  dataset.errorCategories = Object.fromEntries(
    [...new Set(dataset.rows.map((r) => r.errorCategory))].map((k) => [
      k,
      dataset.rows.filter((r) => r.errorCategory === k).length,
    ]),
  );
}
report.categorySummaryCommand = "node scripts/summarize-final-ocr.js";
report.categorySummaryNote =
  "Categories recomputed from retained real OCR observations; recognized text, fields, metrics and ground truth unchanged. Correctly absent fields and ambiguous withheld values are not counted as present-field exact recognition.";
writeFileSync(path, JSON.stringify(report, null, 2));
console.log(
  report.datasets.map((d) => ({
    version: d.version,
    errorCategories: d.errorCategories,
  })),
);
