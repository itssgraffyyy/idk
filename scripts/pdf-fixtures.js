import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
export function buildPDF({
  text = "SYNTHETIC TEST - NOT A BANK DOCUMENT\nreference: PDF-TEST\namountPaise: 10000000\nbank: HDFC Bank\nifsc: HDFC0001234\nissued: 2026-01-01\nmatures: 2030-01-01",
  jpeg,
  active = false,
  width = 650,
  height = 425,
} = {}) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R" +
      (active
        ? " /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>"
        : "") +
      " >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
      width +
      " " +
      height +
      "] /Resources << /Font << /F1 5 0 R >>" +
      (jpeg ? " /XObject << /Im0 6 0 R >>" : "") +
      " >> /Contents 4 0 R >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = jpeg
    ? Buffer.from("q 650 0 0 425 0 0 cm /Im0 Do Q")
    : Buffer.from(
        "BT /F1 16 Tf 35 380 Td " +
          text
            .split("\n")
            .map(
              (line, i) =>
                (i ? "0 -42 Td " : "") +
                "(" +
                line.replace(/[\\()]/g, "\\$&") +
                ") Tj",
            )
            .join("\n") +
          " ET",
      );
  objects[3] = Buffer.concat([
    Buffer.from("<< /Length " + stream.length + " >>\nstream\n"),
    stream,
    Buffer.from("\nendstream"),
  ]);
  if (jpeg)
    objects.push(
      Buffer.concat([
        Buffer.from(
          "<< /Type /XObject /Subtype /Image /Width 1300 /Height 850 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
            jpeg.length +
            " >>\nstream\n",
        ),
        jpeg,
        Buffer.from("\nendstream"),
      ]),
    );
  let bytes = Buffer.from("%PDF-1.7\n"),
    offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(bytes.length);
    bytes = Buffer.concat([
      bytes,
      Buffer.from(i + 1 + " 0 obj\n"),
      Buffer.isBuffer(objects[i]) ? objects[i] : Buffer.from(objects[i]),
      Buffer.from("\nendobj\n"),
    ]);
  }
  const xref = bytes.length;
  return Buffer.concat([
    bytes,
    Buffer.from(
      "xref\n0 " +
        offsets.length +
        "\n0000000000 65535 f \n" +
        offsets
          .slice(1)
          .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
          .join("") +
        "trailer\n<< /Size " +
        offsets.length +
        " /Root 1 0 R >>\nstartxref\n" +
        xref +
        "\n%%EOF\n",
    ),
  ]);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync("datasets/v2/pdf", { recursive: true });
  writeFileSync("datasets/v2/pdf/embedded-synthetic.pdf", buildPDF());
  const image = await loadImage(
      readFileSync("datasets/v1/documents/case-001.png"),
    ),
    canvas = createCanvas(1300, 850);
  canvas.getContext("2d").drawImage(image, 0, 0);
  writeFileSync(
    "datasets/v2/pdf/scanned-synthetic.pdf",
    buildPDF({ jpeg: canvas.toBuffer("image/jpeg", 95) }),
  );
  console.log("Created two synthetic PDF test fixtures");
}
