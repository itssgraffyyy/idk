import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { readFileSync, writeFileSync } from "node:fs";
for (const name of ["embedded-synthetic", "scanned-synthetic"]) {
  const task = getDocument({
      data: new Uint8Array(readFileSync("datasets/v2/pdf/" + name + ".pdf")),
      isEvalSupported: false,
      useSystemFonts: true,
    }),
    doc = await task.promise,
    page = await doc.getPage(1),
    viewport = page.getViewport({ scale: 1.5 }),
    canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
  await page.render({ canvasContext: canvas.getContext("2d"), viewport })
    .promise;
  writeFileSync(
    "docs/evaluation/final-gap/" + name + ".png",
    canvas.toBuffer("image/png"),
  );
  await task.destroy();
}
