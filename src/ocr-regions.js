import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { recognizedValueWords, unionOCRBoxes } from "./ocr-layout.js";
export function boxInSource(box, rotation, width, height) {
  if (
    !box ||
    ![0, 90, 180, 270].includes(rotation) ||
    ![box.x0, box.y0, box.x1, box.y1, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    box.x1 <= box.x0 ||
    box.y1 <= box.y0
  )
    return null;
  const points = [
    [box.x0, box.y0],
    [box.x0, box.y1],
    [box.x1, box.y0],
    [box.x1, box.y1],
  ].map(([x, y]) =>
    rotation === 90
      ? [y, height - x]
      : rotation === 180
        ? [width - x, height - y]
        : rotation === 270
          ? [width - y, x]
          : [x, y],
  );
  return {
    x0: Math.max(0, Math.min(...points.map((p) => p[0]))),
    y0: Math.max(0, Math.min(...points.map((p) => p[1]))),
    x1: Math.min(width, Math.max(...points.map((p) => p[0]))),
    y1: Math.min(height, Math.max(...points.map((p) => p[1]))),
  };
}
export function sourceCoordinateBlocks(blocks, rotation, width, height) {
  const copy = structuredClone(blocks || []);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.bbox) {
      value.recognitionBBox = { ...value.bbox };
      value.bbox = boxInSource(value.bbox, rotation, width, height);
    }
    for (const key of ["paragraphs", "lines", "words", "symbols"])
      for (const child of value[key] || []) visit(child);
  };
  copy.forEach(visit);
  return copy;
}
export async function recognizeValueRegion(
  worker,
  bytes,
  blocks,
  field,
  { identifier = false } = {},
) {
  const lines = (blocks || []).flatMap((b) =>
    (b.paragraphs || []).flatMap((p) => p.lines || []),
  );
  const line = lines.find((line) =>
    line.text?.trim().includes(field.line?.trim()),
  );
  const words = recognizedValueWords(
    line,
    field.line?.trim() || "",
    field.rawValue || "",
  );
  const bbox = unionOCRBoxes(words);
  if (!bbox || bbox.x1 - bbox.x0 > 2500 || bbox.y1 - bbox.y0 > 500) return null;
  const image = await loadImage(bytes),
    padding = 12;
  const crop = {
    x0: Math.max(0, bbox.x0 - padding),
    y0: Math.max(0, bbox.y0 - padding),
    x1: Math.min(image.width, bbox.x1 + padding),
    y1: Math.min(image.height, bbox.y1 + padding),
  };
  if (crop.x1 <= crop.x0 || crop.y1 <= crop.y0) return null;
  const canvas = createCanvas(crop.x1 - crop.x0, crop.y1 - crop.y0),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    image,
    crop.x0,
    crop.y0,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const raster = canvas.toBuffer("image/png");
  await worker.setParameters({
    tessedit_pageseg_mode: "7",
    tessedit_char_whitelist: identifier
      ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
      : "",
  });
  const { data } = await worker.recognize(raster, {}, { text: true });
  return {
    rawText: data.text,
    value: data.text.trim().replace(/\s+/g, " "),
    engineConfidence: data.confidence,
    confidenceCalibration: "uncalibrated",
    method: "tesseract-roi-psm7",
    bbox,
    recognitionCropBBox: crop,
    cropSHA256: createHash("sha256").update(raster).digest("hex"),
    parameters: {
      psm: 7,
      scale: 1,
      alphabet: identifier ? "uppercase-alphanumeric" : "unrestricted",
    },
    requiresHumanReview: true,
  };
}
