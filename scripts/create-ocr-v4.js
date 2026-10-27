import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lookupIFSC } from "../src/ifsc.js";
import { PNG } from "pngjs";
import { rotatePNG } from "../src/images.js";
const root = "datasets/v4",
  hash = (b) => createHash("sha256").update(b).digest("hex");
if (existsSync(root + "/manifest.json"))
  throw Error("Frozen corpus exists; never overwrite");
const fonts = [
  "arial.ttf",
  "cour.ttf",
  "times.ttf",
  "tahoma.ttf",
  "georgia.ttf",
  "verdana.ttf",
  "segoeui.ttf",
].map((file, i) => {
  const path = "C:/Windows/Fonts/" + file;
  if (!existsSync(path))
    throw Error("Required reference font unavailable: " + file);
  const family = "SentinelFrozen" + i;
  if (!GlobalFonts.registerFromPath(path, family))
    throw Error("Font registration failed");
  return { file, family, sha256: hash(readFileSync(path)) };
});
const labels = {
  reference: "FDR Number",
  amountPaise: "Deposit Amount",
  bank: "Bank Name",
  ifsc: "IFSC Code",
  issued: "Issue Date",
  matures: "Maturity Date",
  institutionName: "Institution Name",
  depositor: "Depositor Name",
  branch: "Branch Name",
  currency: "Currency",
  type: "Instrument Type",
};
const layouts = [
  { id: "M-single", split: "development", font: 0, columns: 1 },
  { id: "N-ledger", split: "development", font: 1, columns: 2 },
  { id: "O-bordered", split: "development", font: 2, columns: 1 },
  { id: "P-two-panels", split: "validation", font: 3, columns: 2 },
  { id: "Q-spaced", split: "validation", font: 4, columns: 1 },
  { id: "R-compact", split: "held-out", font: 5, columns: 2 },
  { id: "S-reverse-ledger", split: "held-out", font: 6, columns: 1 },
];
const codes = [
  "HDFC0001234",
  "ICIC0001234",
  "SBIN0012345",
  "KKBK0000958",
].filter((code) => lookupIFSC(code).status === "reference_match");
if (codes.length < 2)
  throw Error("At least two pinned IFSC references are required");
mkdirSync(root + "/documents", { recursive: true });
const cases = [];
for (const [layoutIndex, layout] of layouts.entries())
  for (let variation = 0; variation < 6; variation++) {
    const n = cases.length + 1,
      reference = lookupIFSC(codes[(n - 1) % codes.length]);
    const values = {
      reference: "SYN4-" + String(n).padStart(4, "0"),
      amountPaise: 12500000 + n * 12300,
      bank: reference.bank,
      ifsc: reference.code,
      issued: "2026-02-01",
      matures: "2031-02-01",
      institutionName: "Fictional Academy " + n,
      depositor: "Fictional Education Trust " + n,
      branch: reference.branch,
      currency: "INR",
      type: n % 2 ? "FDR" : "TERM_DEPOSIT",
    };
    const expected = { ...values },
      scenario = [
        "clean",
        "low-contrast",
        "right-angle-rotation",
        "light-noise",
        "missing-fields",
        "conflicting-IFSC",
      ][variation];
    if (variation === 4) {
      delete expected.currency;
      delete expected.depositor;
    }
    if (variation === 5) delete expected.ifsc;
    const canvas = createCanvas(1900, 1500),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '22px "' + fonts[layout.font].family + '"';
    ctx.fillStyle = "#222";
    ctx.fillText(
      "SYNTHETIC TEST ONLY - NOT A BANK DOCUMENT OR VERIFIED DEPOSIT",
      55,
      55,
    );
    ctx.fillText(
      "FDR SENTINEL OCR CORPUS V4 - FICTIONAL INSTITUTION AND HOLDER",
      55,
      90,
    );
    ctx.fillStyle = variation === 1 ? "#777" : "#111";
    const entries = Object.entries(values).filter(
      ([field]) =>
        variation !== 4 || !["currency", "depositor"].includes(field),
    );
    if (layout.id === "S-reverse-ledger") entries.reverse();
    const boxes = {},
      size = layout.columns === 2 ? 24 : 32;
    ctx.font = size + 'px "' + fonts[layout.font].family + '"';
    for (const [index, [field, value]] of entries.entries()) {
      const column = layout.columns === 2 ? index % 2 : 0,
        row = layout.columns === 2 ? Math.floor(index / 2) : index;
      const x =
          55 + column * 935 + (layout.id === "Q-spaced" ? (index % 3) * 35 : 0),
        y = 170 + row * (layout.columns === 2 ? 185 : 106);
      const printed =
        field === "amountPaise"
          ? "INR " +
            (value / 100).toLocaleString("en-IN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          : field === "type" && value === "TERM_DEPOSIT"
            ? "Term Deposit"
            : String(value);
      const text =
        labels[field] +
        " : " +
        (field === "ifsc" && variation === 5
          ? values.ifsc + " / " + codes.find((c) => c !== values.ifsc)
          : printed);
      const maxWidth = layout.columns === 2 ? 875 : 1770 - (x - 55),
        measured = ctx.measureText(text),
        width = Math.min(measured.width, maxWidth);
      if (layout.id.includes("border") || layout.id.includes("panel")) {
        ctx.strokeStyle = "#ccc";
        ctx.strokeRect(x - 10, y - size - 8, maxWidth + 10, size + 24);
      }
      ctx.fillText(text, x, y, maxWidth);
      boxes[field] = { x0: x, y0: y - size - 3, x1: x + width, y1: y + 8 };
    }
    let bytes = canvas.toBuffer("image/png"),
      rotation = 0;
    if (variation === 3) {
      const png = PNG.sync.read(bytes);
      for (let k = 0; k < 1700; k++) {
        const x = (k * 127 + 19) % png.width,
          y = (k * 89 + 23) % png.height,
          p = (y * png.width + x) * 4;
        png.data[p] = png.data[p + 1] = png.data[p + 2] = 210;
      }
      bytes = PNG.sync.write(png);
    }
    if (variation === 2) {
      rotation = layoutIndex % 2 ? 180 : 90;
      for (let turn = 0; turn < rotation / 90; turn++) bytes = rotatePNG(bytes);
    }
    const id = "ocr-v4-" + String(n).padStart(2, "0"),
      path = root + "/documents/" + id + ".png";
    writeFileSync(path, bytes);
    cases.push({
      id,
      split: layout.split,
      layout: layout.id,
      scenario,
      sha256: hash(bytes),
      font: fonts[layout.font].file,
      rotation,
      dimensions:
        rotation === 90
          ? { width: 1500, height: 1900 }
          : { width: 1900, height: 1500 },
      groundTruth: {
        extracted: expected,
        originalUnrotatedLineBoxes: boxes,
        coordinateNote:
          "Boxes describe original renderer coordinates; rotate using declared canvas dimensions to compare with stored image.",
      },
      expectedReview: variation === 5 ? ["ifsc"] : [],
      referenceSource: {
        version: reference.version,
        source: reference.source,
        releaseDate: reference.releaseDate,
        datasetSHA256: reference.datasetSHA256,
        code: reference.code,
        role: "Branch-reference consistency only; not deposit authenticity",
      },
    });
  }
const protocol = {
  classification: "SYNTHETIC_TEST_ONLY",
  version: "synthetic-v4",
  frozenBeforeRecognitionChanges: true,
  baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  generatedAt: new Date().toISOString(),
  partitions: { development: 18, validation: 12, "held-out": 12 },
  rule: "Tune only development/validation. First held-out recognition runs only after recognition code is frozen; do not tune on held-out results. Original V1/V2/V3 remain regression corpora.",
  fields: Object.keys(labels),
  fonts,
  layouts,
  cases,
};
writeFileSync(
  root + "/manifest.json",
  JSON.stringify(protocol, null, 2) + "\n",
);
writeFileSync(
  root + "/manifest.sha256",
  hash(readFileSync(root + "/manifest.json")) + "\n",
);
console.log(
  JSON.stringify({
    cases: cases.length,
    partitions: protocol.partitions,
    manifestSHA256: hash(readFileSync(root + "/manifest.json")),
    classification: protocol.classification,
  }),
);
