import { createWorker } from "tesseract.js";
import eng from "@tesseract.js-data/eng";
import { readFileSync } from "node:fs";
import { rotatePNG } from "./images.js";
import { extract } from "./engine.js";
import { glyphIFSC } from "./glyph-ocr.js";
const worker = await createWorker("eng", 1, {
  langPath: eng.langPath,
  gzip: true,
  cacheMethod: "none",
  logger: () => {},
  errorHandler: () => {},
});
async function recognize(path) {
  await worker.setParameters({ tessedit_pageseg_mode: "6" });
  let bytes = readFileSync(path),
    rotation = 0;
  let { data } = await worker.recognize(
    bytes,
    {},
    { text: true, blocks: true },
  );
  const score = (d) => Object.keys(extract(d.text)).length;
  if (score(data) < 4 && bytes[0] === 137) {
    for (let angle = 90; angle <= 270; angle += 90) {
      bytes = rotatePNG(bytes);
      const attempt = (
        await worker.recognize(bytes, {}, { text: true, blocks: true })
      ).data;
      if (score(attempt) > score(data)) {
        data = attempt;
        rotation = angle;
      }
      if (score(data) >= 5) break;
    }
  }
  let ifscAttempt = null;
  try {
    ifscAttempt = await glyphIFSC(bytes, data.blocks);
  } catch {
    ifscAttempt = {
      status: "unavailable",
      method: "visual-glyph-templates-v1",
    };
  }
  return JSON.stringify({
    text: data.text,
    confidence: data.confidence,
    blocks: data.blocks,
    fieldAttempts: { ifsc: ifscAttempt },
    rotation,
    engine: "tesseract.js-7-local-eng",
  });
}
if (process.argv[2] === "--service") {
  process.on("message", async (m) => {
    try {
      process.send({ result: JSON.parse(await recognize(m.path)) });
    } catch {
      process.send({ error: true });
    }
  });
  process.on("disconnect", async () => {
    await worker.terminate();
    process.exit(0);
  });
} else {
  try {
    process.stdout.write(await recognize(process.argv[2]));
  } finally {
    await worker.terminate();
  }
}
