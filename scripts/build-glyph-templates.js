import { buildGlyphTemplates } from "../src/glyph-ocr.js";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const templates = buildGlyphTemplates(),
  bytes = gzipSync(JSON.stringify(templates), { level: 9 });
mkdirSync("resources/glyph", { recursive: true });
writeFileSync("resources/glyph/templates-v1.json.gz", bytes);
writeFileSync(
  "resources/glyph/manifest.json",
  JSON.stringify(
    {
      version: "visual-glyph-templates-v1",
      method:
        "Rendered known alphabet glyphs, no case declarations or directory used",
      alphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      families: [...new Set(templates.map((t) => t.family))],
      grid: [24, 32],
      thresholds: {
        minimumIntersectionOverUnion: 0.65,
        minimumDistinctCharacterMargin: 0.025,
      },
      sha256: createHash("sha256").update(bytes).digest("hex"),
      training:
        "Fixed fonts and characters; inspected only v1 development case001 before freezing; no held-out tuning",
      platform: process.platform,
    },
    null,
    2,
  ),
);
console.log({ templates: templates.length, bytes: bytes.length });
