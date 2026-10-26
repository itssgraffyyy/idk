// Secondary visual OCR, never a declaration/directory-driven identifier repair.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  families = [
    "Consolas",
    "Arial",
    "Georgia",
    "Verdana",
    "Tahoma",
    "Times New Roman",
  ];
function mask(image, x0 = 0, y0 = 0, w = image.width, h = image.height) {
  const a = [],
    columns = new Array(w).fill(0);
  let left = w,
    right = 0,
    top = h,
    bottom = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y + y0) * image.width + x + x0) * 4,
        ink =
          image.data[i] + image.data[i + 1] + image.data[i + 2] < 500 &&
          image.data[i + 3] > 100;
      a[y * w + x] = ink ? 1 : 0;
      if (ink) {
        columns[x]++;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  return { a, w, h, columns, left, right, top, bottom };
}
function normalized(m, left = m.left, right = m.right) {
  let top = m.h,
    bottom = 0;
  for (let y = 0; y < m.h; y++)
    for (let x = left; x <= right; x++)
      if (m.a[y * m.w + x]) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (top > bottom) return null;
  const out = [];
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 24; x++)
      out.push(
        m.a[
          Math.min(
            bottom,
            top + Math.floor(((y + 0.5) * (bottom - top + 1)) / 32),
          ) *
            m.w +
            Math.min(
              right,
              left + Math.floor(((x + 0.5) * (right - left + 1)) / 24),
            )
        ],
      );
  return out;
}
let templates, templateDigest;
export function buildGlyphTemplates() {
  if (templates) return templates;
  templates = [];
  for (const family of families)
    for (const char of alphabet) {
      const canvas = createCanvas(100, 90),
        ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 100, 90);
      ctx.font = '48px "' + family + '"';
      ctx.fillStyle = "black";
      ctx.fillText(char, 10, 65);
      templates.push({
        char,
        family,
        mask: normalized(mask(ctx.getImageData(0, 0, 100, 90))),
      });
    }
  return templates;
}
function trained() {
  if (templates) return templates;
  const root = new URL("../resources/glyph/", import.meta.url),
    m = JSON.parse(readFileSync(new URL("manifest.json", root))),
    bytes = readFileSync(new URL("templates-v1.json.gz", root));
  if (createHash("sha256").update(bytes).digest("hex") !== m.sha256)
    throw Error("Glyph template integrity failure");
  templateDigest = m.sha256;
  templates = JSON.parse(gunzipSync(bytes, { maxOutputLength: 2000000 }));
  return templates;
}
export async function glyphIFSC(bytes, blocks) {
  const lines = (blocks || []).flatMap((b) =>
    (b.paragraphs || []).flatMap((p) => p.lines || []),
  );
  const line = lines.find((l) => /^\s*ifsc(?:\s+code)?\s*[:=]/i.test(l.text));
  if (!line) return null;
  const words = (line.words || []).filter(
    (w) => !/^ifsc$|^code$|^[:=]$/i.test(w.text),
  );
  const valueWords = words.filter((w) => /[A-Z0-9]{4}/i.test(w.text));
  if (!valueWords.length) return null;
  const bbox = {
    x0: Math.min(...valueWords.map((w) => w.bbox.x0)),
    y0: Math.min(...valueWords.map((w) => w.bbox.y0)),
    x1: Math.max(...valueWords.map((w) => w.bbox.x1)),
    y1: Math.max(...valueWords.map((w) => w.bbox.y1)),
  };
  const image = await loadImage(bytes),
    canvas = createCanvas(image.width, image.height),
    ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const x = Math.max(0, bbox.x0 - 1),
    y = Math.max(0, bbox.y0 - 1),
    width = Math.min(image.width - x, bbox.x1 - x + 2),
    height = Math.min(image.height - y, bbox.y1 - y + 2);
  if (width * height > 200000 || height < 8) return null;
  const m = mask(ctx.getImageData(x, y, width, height)),
    segments = [];
  let start = null;
  for (let i = 0; i <= width; i++) {
    if (m.columns[i] && start === null) start = i;
    if (!m.columns[i] && start !== null) {
      segments.push([start, i - 1]);
      start = null;
    }
  }
  if (segments.length !== 11) return null;
  const glyphs = segments.map(([left, right]) => {
    const pixels = normalized(m, left, right),
      scores = trained()
        .map((t) => {
          let union = 0,
            intersection = 0;
          for (let j = 0; j < pixels.length; j++) {
            if (pixels[j] || t.mask[j]) union++;
            if (pixels[j] && t.mask[j]) intersection++;
          }
          return {
            char: t.char,
            family: t.family,
            score: intersection / (union || 1),
          };
        })
        .sort((a, b) => b.score - a.score);
    const best = scores[0],
      second = scores.find((s) => s.char !== best.char);
    return { ...best, margin: best.score - second.score };
  });
  const value = glyphs.map((g) => g.char).join(""),
    reliable =
      glyphs.every((g) => g.score >= 0.65 && g.margin >= 0.025) &&
      /^[A-Z]{4}0[A-Z0-9]{6}$/.test(value);
  return {
    value: reliable ? value : null,
    candidate: value,
    reliable,
    glyphs,
    bbox,
    method: "visual-glyph-templates-v1",
    confidence: null,
    confidenceCalibration: "uncalibrated",
    templateSpecification: {
      alphabet,
      families,
      grid: [24, 32],
      version: 1,
      sha256: templateDigest,
    },
    requiresReview: true,
  };
}
