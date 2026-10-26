import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
mkdirSync("resources/regulatory/review", { recursive: true });
for (const name of ["aph-2024-27", "addendum-2025-26", "addendum-2026-27"]) {
  const doc = await getDocument({
    data: new Uint8Array(readFileSync("resources/regulatory/" + name + ".pdf")),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i),
      content = await page.getTextContent(),
      text = content.items.map((x) => x.str).join(" ");
    if (/security deposit|1\.12|4\.10|6\.27/i.test(text)) {
      pages.push({ page: i, text });
      if (name !== "addendum-2025-26" || i > 230) {
        const viewport = page.getViewport({ scale: 1.3 }),
          canvas = createCanvas(
            Math.ceil(viewport.width),
            Math.ceil(viewport.height),
          );
        await page.render({ canvasContext: canvas.getContext("2d"), viewport })
          .promise;
        writeFileSync(
          "resources/regulatory/review/" + name + "-p" + i + ".png",
          canvas.toBuffer("image/png"),
        );
      }
    }
  }
  writeFileSync(
    "resources/regulatory/review/" + name + ".json",
    JSON.stringify({ pages: doc.numPages, relevant: pages }, null, 2),
  );
  console.log(
    name,
    doc.numPages,
    pages.map((p) => p.page),
  );
}
