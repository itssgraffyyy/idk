import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extract } from "../src/extraction.js";
import { analyzeIFSC } from "../src/ifsc-extraction.js";
import { recognizedValueWords } from "../src/ocr-layout.js";
test("ROI word alignment excludes labels even when the value repeats a label word", () => {
  const words = [
    "Institution",
    "Name",
    ":",
    "Synthetic",
    "Institution",
    "12",
  ].map((text, i) => ({
    text,
    bbox: { x0: i * 10, y0: 0, x1: i * 10 + 8, y1: 12 },
  }));
  assert.deepEqual(
    recognizedValueWords(
      { words },
      "Institution Name : Synthetic Institution 12",
      "Synthetic Institution 12",
    ).map((w) => w.text),
    ["Synthetic", "Institution", "12"],
  );
});
test("actual development OCR combined columns are separated with genuine word-box provenance", () => {
  const row = readFileSync(
    "docs/evaluation/phase-4a/baseline-dev-validation.jsonl",
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((r) => r.id === "ocr-v4-07");
  const fields = extract(row.raw.text, {
    blocks: row.raw.blocks,
    fieldAttempts: row.raw.fieldAttempts,
    documentVersionId: "development-source-version",
  });
  for (const field of [
    "reference",
    "amountPaise",
    "bank",
    "ifsc",
    "issued",
    "matures",
    "institutionName",
    "depositor",
    "branch",
    "currency",
    "type",
  ])
    assert.equal(fields[field].value, row.expected[field], field);
  assert(fields.bank.bbox.x1 < fields.ifsc.bbox.x0);
  assert(fields.institutionName.bbox.x1 < fields.depositor.bbox.x0);
  assert.equal(fields.bank.sourceLine.includes("IFSC Code"), true);
  assert.equal(fields.bank.rawValue.includes("IFSC"), false);
  assert.equal(fields.bank.documentVersionId, "development-source-version");
  assert.equal(fields.ifsc.independentDepositConfirmation, false);
});
test("conflicting same-page financial and holder values are retained as observations and withheld", () => {
  const result = extract(
    "Deposit Amount: INR 100.00\nDeposit Amount: INR 200.00\nHolder Name: First Trust\nHolder Name: Other Trust",
  );
  assert.equal(result.amountPaise.value, undefined);
  assert.equal(result.amountPaise.status, "REQUIRES_REVIEW");
  assert.deepEqual(
    result.amountPaise.observations.map((o) => o.value),
    [10000, 20000],
  );
  assert.equal(result.depositor.value, undefined);
  assert.equal(result.depositor.observations.length, 2);
});
test("bounded blank-line IFSC fragments preserve original characters and require source review", () => {
  const result = analyzeIFSC("IFSC : KKBK\n\n0000958\nIssue Date: 2026-01-01");
  assert.equal(result.value, "KKBK0000958");
  assert.equal(result.status, "REQUIRES_REVIEW");
  assert.equal(result.rawValue, "KKBK\n\n0000958");
  assert.equal(result.candidates[0].fragments.length, 2);
  assert.equal(result.candidates[0].fragments[1].lineIndex, 2);
  assert.equal(analyzeIFSC("IFSC: KKBK\n\nAmount: 0000958").value, undefined);
  assert.equal(analyzeIFSC("IFSC: KKBK\n\n\n\n0000958").value, undefined);
  assert.equal(analyzeIFSC("IFSC: HDFCO001234").value, undefined);
});
test("instrument type comes only from an explicit source label and unsupported types require review", () => {
  assert.equal(extract("Instrument Type: FDR").type.value, "FDR");
  assert.equal(
    extract("Deposit Type: Term Deposit").type.value,
    "TERM_DEPOSIT",
  );
  assert.equal(
    extract("FIXED DEPOSIT RECEIPT\nFDR Number: ABC").type,
    undefined,
  );
  assert.equal(
    extract("Instrument Type: Savings Account").type.value,
    undefined,
  );
  assert.equal(
    extract("Instrument Type: Savings Account").type.status,
    "REQUIRES_REVIEW",
  );
});
