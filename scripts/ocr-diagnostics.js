import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync("datasets/v1/cases.json")).cases,
  r = JSON.parse(readFileSync("docs/evaluation/ocr-results.json"));
for (const k of [
  "reference",
  "amountPaise",
  "bank",
  "ifsc",
  "issued",
  "matures",
]) {
  let present = 0,
    correct = 0;
  const errors = [];
  for (const c of data) {
    const expected = c.groundTruth.extracted[k],
      actual = r.rows.find((x) => x.id === c.id)?.extracted?.[k]?.value;
    if (expected !== undefined) {
      present++;
      if (actual === expected) correct++;
      else errors.push({ id: c.id, expected, actual });
    }
  }
  console.log(k, { present, correct, errors });
}
