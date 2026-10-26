import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { extract } from "../src/extraction.js";
import { extract as baselineExtract } from "../docs/evaluation/final-gap-baseline/extraction-v2.js";
const exec = promisify(execFile),
  fields = ["reference", "amountPaise", "bank", "ifsc", "issued", "matures"],
  datasets = [];
for (const version of ["v1", "v2"]) {
  const data = JSON.parse(readFileSync("datasets/" + version + "/cases.json")),
    rows = [];
  for (const c of data.cases) {
    const path = "datasets/" + version + "/documents/" + c.id + ".png",
      sha256 = createHash("sha256").update(readFileSync(path)).digest("hex"),
      start = performance.now();
    if (c.sha256 && sha256 !== c.sha256)
      throw Error("Fixture integrity failure");
    try {
      const { stdout } = await exec(
        process.execPath,
        ["src/ocr-worker.js", path],
        { timeout: 60000, maxBuffer: 4194304, windowsHide: true },
      );
      const raw = JSON.parse(stdout),
        result = extract(raw.text, { blocks: raw.blocks }),
        before = baselineExtract(raw.text, { blocks: raw.blocks });
      rows.push({
        id: c.id,
        split: c.split,
        layout: c.layout,
        scenario: c.scenario,
        sha256,
        status: "completed",
        durationMs: performance.now() - start,
        rawText: raw.text,
        documentConfidence: raw.confidence,
        fields: result,
        baselineFields: before,
        expected: c.groundTruth.extracted,
        errorCategory:
          result.ifsc?.value === c.groundTruth.extracted.ifsc
            ? "exact"
            : result.ifsc?.candidates?.length > 1
              ? "ambiguous"
              : !result.ifsc
                ? "label_missing"
                : result.ifsc.value === undefined
                  ? "invalid_syntax_review"
                  : "glyph_confusion_or_unknown",
      });
      console.log(version + " " + c.id + " processed");
    } catch (e) {
      rows.push({
        id: c.id,
        split: c.split,
        status: "failed",
        durationMs: performance.now() - start,
        error: e.message,
        expected: c.groundTruth.extracted,
      });
    }
  }
  function metrics(selected, key) {
    return Object.fromEntries(
      fields.map((f) => {
        const present = selected.filter((r) => r.expected[f] !== undefined),
          absent = selected.filter((r) => r.expected[f] === undefined);
        const exact = present.filter(
          (r) => r[key]?.[f]?.value === r.expected[f],
        ).length;
        const extracted = present.filter(
          (r) => r[key]?.[f]?.value !== undefined,
        ).length;
        return [
          f,
          {
            present: present.length,
            exact,
            accuracy: present.length ? exact / present.length : null,
            extracted,
            coverage: present.length ? extracted / present.length : null,
            falseExtractions: absent.filter(
              (r) => r[key]?.[f]?.value !== undefined,
            ).length,
          },
        ];
      }),
    );
  }
  const held = rows.filter((r) => r.split === "held-out");
  datasets.push({
    version: data.version,
    baseline: metrics(rows, "baselineFields"),
    after: metrics(rows, "fields"),
    heldOut: {
      baseline: metrics(held, "baselineFields"),
      after: metrics(held, "fields"),
    },
    failures: rows.filter((r) => r.status === "failed").length,
    meanMs: rows.reduce((n, r) => n + r.durationMs, 0) / rows.length,
    errorCategories: Object.fromEntries(
      [...new Set(rows.map((r) => r.errorCategory))].map((k) => [
        k,
        rows.filter((r) => r.errorCategory === k).length,
      ]),
    ),
    rows,
  });
}
mkdirSync("docs/evaluation/final-gap", { recursive: true });
writeFileSync(
  "docs/evaluation/final-gap/ocr-results.json",
  JSON.stringify(
    {
      command: "node scripts/benchmark-final-ocr.js",
      engine: "Tesseract.js7 local eng, PSM6 + existing rotation fallback",
      parser:
        "ifsc-candidates-v1; no automatic financial identifier substitution",
      baselineParserCommit: "2846d76",
      heldOutPolicy:
        "v1 C previously exposed; new v2 G/H not used for tuning; no tuning after first final evaluation",
      datasets,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    datasets.map(({ rows, ...d }) => d),
    null,
    2,
  ),
);
if (datasets.some((d) => d.failures)) process.exitCode = 1;
