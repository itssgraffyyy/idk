import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { glyphIFSC } from "./glyph-ocr.js";
const log = console.log;
console.log = (...args) => process.stderr.write(args.join(" ") + "\n");
let doc, worker, task;
try {
  const bytes = readFileSync(process.argv[2]);
  if (bytes.length > 4194304 || bytes.subarray(0, 5).toString() !== "%PDF-")
    throw Error("Invalid PDF signature or size");
  task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: !process.argv[3]?.startsWith("preview:"),
    ...(process.argv[3]?.startsWith("preview:")
      ? {
          standardFontDataUrl: fileURLToPath(
            new URL(
              "../node_modules/pdfjs-dist/standard_fonts/",
              import.meta.url,
            ),
          ).replaceAll("\\", "/"),
        }
      : {}),
    stopAtErrors: true,
  });
  doc = await task.promise;
  if (doc.numPages < 1 || doc.numPages > 5 || doc.isPureXfa)
    throw Error("Unsupported PDF page count or XFA");
  if ((await doc.getJSActions()) || (await doc.getAttachments()))
    throw Error("Active or attached PDF content rejected");
  const preview = process.argv[3]?.startsWith("preview:")
    ? Number(process.argv[3].slice(8))
    : null;
  if (
    preview !== null &&
    (!Number.isInteger(preview) || preview < 1 || preview > doc.numPages)
  )
    throw Error("Invalid preview page");
  const pages = [];
  let pixels = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n),
      viewport = page.getViewport({ scale: 2 });
    const area = Math.ceil(viewport.width) * Math.ceil(viewport.height);
    pixels += area;
    if (
      !Number.isFinite(area) ||
      area <= 0 ||
      area > 10000000 ||
      pixels > 20000000
    )
      throw Error("PDF pixel budget exceeded");
    if (process.argv[3] === "validate") continue;
    if (preview !== null) {
      if (n !== preview) continue;
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise;
      process.stdout.write(
        JSON.stringify({
          page: n,
          pages: doc.numPages,
          rendering: { fontMode: "pdf-embedded-or-bundled-standard" },
          viewport: {
            width: Math.ceil(viewport.width),
            height: Math.ceil(viewport.height),
            transform: viewport.transform,
          },
          png: canvas.toBuffer("image/png").toString("base64"),
        }),
      );
      continue;
    }
    const content = await page.getTextContent(),
      embedded = content.items
        .map((i) => (i.str || "") + (i.hasEOL ? "\n" : " "))
        .join("");
    // Require financial labels and adequate text; otherwise actually OCR the raster.
    if (
      embedded.length >= 50 &&
      (embedded.match(/reference|amount|ifsc|maturity|bank/gi) || []).length >=
        3
    ) {
      pages.push({
        page: n,
        method: "embedded-pdf-text",
        text: embedded,
        items: content.items.map((i) => ({
          text: i.str,
          transform: i.transform,
          width: i.width,
          height: i.height,
        })),
      });
    } else {
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise;
      if (!worker) {
        const { createWorker } = await import("tesseract.js"),
          eng = (await import("@tesseract.js-data/eng")).default;
        worker = await createWorker("eng", 1, {
          langPath: eng.langPath,
          gzip: true,
          cacheMethod: "none",
          logger: () => {},
          errorHandler: () => {},
        });
        await worker.setParameters({ tessedit_pageseg_mode: "6" });
      }
      const raster = canvas.toBuffer("image/png");
      const { data } = await worker.recognize(
        raster,
        {},
        { text: true, blocks: true },
      );
      let ifscAttempt = null;
      try {
        ifscAttempt = await glyphIFSC(raster, data.blocks);
      } catch {
        ifscAttempt = { status: "unavailable" };
      }
      pages.push({
        page: n,
        method: "raster-pdf-ocr",
        text: data.text,
        blocks: data.blocks,
        confidence: data.confidence,
        renderScale: 2,
        fieldAttempts: { ifsc: ifscAttempt },
      });
    }
    page.cleanup();
  }
  if (preview === null)
    process.stdout.write(
      JSON.stringify(
        process.argv[3] === "validate"
          ? { valid: true, pages: doc.numPages }
          : {
              text: pages.map((p) => p.text).join("\n"),
              pages,
              blocks: pages.flatMap((p) => p.blocks || []),
              engine: "pdfjs6-bounded-text-or-tesseract7",
              untrustedEmbeddedText: true,
            },
      ),
    );
} catch (e) {
  process.stderr.write(String(e.message));
  process.exitCode = 1;
} finally {
  if (worker) await worker.terminate();
  if (task) await task.destroy();
  console.log = log;
}
