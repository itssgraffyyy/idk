import { createWorker } from "tesseract.js";
import eng from "@tesseract.js-data/eng";
import { readFileSync } from "node:fs";
import { rotatePNG } from "./images.js";
import { extract } from "./engine.js";
import { glyphIFSC } from "./glyph-ocr.js";
import {
  boxInSource,
  sourceCoordinateBlocks,
  recognizeValueRegion,
} from "./ocr-regions.js";
import { validIFSC } from "./ifsc-extraction.js";
const worker = await createWorker("eng", 1, {
  langPath: eng.langPath,
  gzip: true,
  cacheMethod: "none",
  logger: () => {},
  errorHandler: () => {},
});
async function recognize(path) {
  await worker.setParameters({
    tessedit_pageseg_mode: "6",
    tessedit_char_whitelist: "",
  });
  let bytes = readFileSync(path),
    rotation = 0;
  const originalBytes = bytes;
  let bestBytes = bytes;
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
        bestBytes = bytes;
      }
      if (score(data) >= 5) break;
    }
  }
  let ifscAttempt = null;
  try {
    ifscAttempt = await glyphIFSC(bestBytes, data.blocks);
  } catch {
    ifscAttempt = {
      status: "unavailable",
      method: "visual-glyph-templates-v1",
    };
  }
  const parsed = extract(data.text, { blocks: data.blocks }),
    roiAttempts = {};
  let roiFailure = null;
  try {
    if (
      parsed.ifsc?.candidates?.length === 1 &&
      !validIFSC(parsed.ifsc.value || "") &&
      parsed.ifsc.rawValue &&
      !parsed.ifsc.sourceFragments
    ) {
      const roi = await recognizeValueRegion(
        worker,
        bestBytes,
        data.blocks,
        parsed.ifsc,
        { identifier: true },
      );
      if (roi && validIFSC(roi.value.replace(/\s+/g, "")))
        roiAttempts.ifsc = { ...roi, value: roi.value.replace(/\s+/g, "") };
    }
    if (rotation)
      for (const field of ["institutionName", "depositor"]) {
        // A heuristic trigger, not a calibrated correctness probability.
        if (
          parsed[field]?.value &&
          Number.isFinite(parsed[field].engineConfidence) &&
          parsed[field].engineConfidence < 90
        ) {
          const roi = await recognizeValueRegion(
            worker,
            bestBytes,
            data.blocks,
            parsed[field],
          );
          if (roi?.value && roi.value !== parsed[field].value)
            roiAttempts[field] = roi;
        }
      }
  } catch {
    roiFailure = {
      status: "unavailable",
      method: "tesseract-roi-psm7",
      reason: "Secondary ROI recognition failed; original OCR retained",
    };
  } finally {
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      tessedit_char_whitelist: "",
    });
  }
  const sourceDimensions =
    originalBytes[0] === 137
      ? {
          width: originalBytes.readUInt32BE(16),
          height: originalBytes.readUInt32BE(20),
        }
      : null;
  const fieldAttempts = { ifsc: ifscAttempt, roi: roiAttempts, roiFailure };
  if (rotation && sourceDimensions) {
    data.blocks = sourceCoordinateBlocks(
      data.blocks,
      rotation,
      sourceDimensions.width,
      sourceDimensions.height,
    );
    for (const attempt of [ifscAttempt, ...Object.values(roiAttempts)])
      if (attempt?.bbox) {
        attempt.recognitionBBox = { ...attempt.bbox };
        attempt.bbox = boxInSource(
          attempt.bbox,
          rotation,
          sourceDimensions.width,
          sourceDimensions.height,
        );
      }
  }
  return JSON.stringify({
    text: data.text,
    confidence: data.confidence,
    blocks: data.blocks,
    fieldAttempts,
    rotation,
    sourceDimensions,
    coordinateSpace: "source-raster-pixels",
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
