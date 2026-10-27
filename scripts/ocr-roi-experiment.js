import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import eng from "@tesseract.js-data/eng";
import { rotatePNG } from "../src/images.js";
import { extract } from "../src/extraction.js";
import { recognizedSegmentWords, unionOCRBoxes } from "../src/ocr-layout.js";
const manifest = JSON.parse(readFileSync("datasets/v4/manifest.json"));
const rows = readFileSync(
  "docs/evaluation/phase-4a/baseline-dev-validation.jsonl",
  "utf8",
)
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => JSON.parse(line));
const worker = await createWorker("eng", 1, {
  langPath: eng.langPath,
  gzip: true,
  cacheMethod: "none",
  logger: () => {},
});
const output = [];
try {
  for (const [id, field] of [
    ["ocr-v4-28", "ifsc"],
    ["ocr-v4-27", "institutionName"],
  ]) {
    const c = manifest.cases.find((c) => c.id === id);
    if (c.split === "held-out") throw Error("No held-out experiments");
    const row = rows.find((r) => r.id === id),
      parsed = extract(row.raw.text, { blocks: row.raw.blocks });
    const lines = row.raw.blocks.flatMap((b) =>
      b.paragraphs.flatMap((p) => p.lines),
    );
    const line = lines.find((l) =>
      l.text.trim().includes(parsed[field].line.trim()),
    );
    const words = recognizedSegmentWords(
      line,
      parsed[field].line.trim(),
    ).filter(
      (w) =>
        parsed[field].rawValue.includes(w.text) && ![":", "="].includes(w.text),
    );
    const box = unionOCRBoxes(words);
    if (!box) throw Error("No real word region");
    let bytes = readFileSync("datasets/v4/documents/" + id + ".png");
    for (let angle = 0; angle < row.raw.rotation; angle += 90)
      bytes = rotatePNG(bytes);
    const image = await loadImage(bytes);
    for (const scale of [1, 2, 3])
      for (const psm of [7, 8, 13]) {
        const canvas = createCanvas(
            Math.ceil((box.x1 - box.x0 + 24) * scale),
            Math.ceil((box.y1 - box.y0 + 24) * scale),
          ),
          ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
          image,
          box.x0 - 12,
          box.y0 - 12,
          box.x1 - box.x0 + 24,
          box.y1 - box.y0 + 24,
          0,
          0,
          canvas.width,
          canvas.height,
        );
        await worker.setParameters({
          tessedit_pageseg_mode: String(psm),
          tessedit_char_whitelist:
            field === "ifsc" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" : "",
        });
        const started = performance.now(),
          result = await worker.recognize(canvas.toBuffer("image/png"));
        output.push({
          id,
          split: c.split,
          field,
          primaryRaw: parsed[field].rawValue,
          box,
          scale,
          psm,
          rawText: result.data.text,
          uncalibratedConfidence: result.data.confidence,
          elapsedMs: performance.now() - started,
        });
      }
  }
} finally {
  await worker.terminate();
}
writeFileSync(
  "docs/evaluation/phase-4a/roi-development-experiment.json",
  JSON.stringify(
    {
      classification: "SYNTHETIC_DEV_VALIDATION_EXPERIMENT",
      heldOutUsed: false,
      note: "Crops use genuine recognized word boxes; no expected value, bank directory or identifier substitution enters OCR",
      trials: output,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    output.map(({ id, field, scale, psm, rawText }) => ({
      id,
      field,
      scale,
      psm,
      rawText,
    })),
  ),
);
