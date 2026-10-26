import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { lookupIFSC } from "../src/ifsc.js";
const root = "datasets/v3";
if (existsSync(root + "/cases.json"))
  throw Error("Held-out dataset already frozen; do not overwrite");
mkdirSync(root + "/documents", { recursive: true });
const codes = [
    "HDFC0001234",
    "ICIC0001234",
    "SBIN0012345",
    "KKBK0000958",
  ].filter((code) => lookupIFSC(code).status === "reference_match"),
  cases = [];
for (let i = 0; i < 12; i++) {
  const ref = lookupIFSC(codes[i % codes.length]);
  if (ref.status !== "reference_match") throw Error("Reference missing");
  const values = {
    reference: "TEST-V3-" + String(i + 1).padStart(3, "0"),
    amountPaise: 350000000 + i * 100,
    bank: ref.bank,
    ifsc: ref.code,
    issued: "2026-02-01",
    matures: "2036-02-01",
    institutionName: "Synthetic Institution " + (i + 1),
    depositor: "Synthetic Education Trust " + (i + 1),
    branch: ref.branch,
    currency: "INR",
  };
  const label = {
      reference: "FDR Reference",
      amountPaise: "amountPaise",
      bank: "Bank Name",
      ifsc: "IFSC Code",
      issued: "Issue Date",
      matures: "Maturity Date",
      institutionName: "Institution Name",
      depositor: "Depositor Name",
      branch: "Branch Name",
      currency: "Currency",
    },
    fonts = ["Consolas", "Calibri", "Georgia"],
    font = fonts[i % 3],
    layout = ["J", "K", "L"][i % 3];
  const canvas = createCanvas(1700, 1300),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 1700, 1300);
  ctx.fillStyle = i === 10 ? "#777" : "#111";
  ctx.font = '30px "' + font + '"';
  const lines = [
    "SYNTHETIC TEST - NOT A BANK DOCUMENT",
    ...Object.entries(values).map(([k, v]) => label[k] + " : " + v),
  ];
  let y = 80;
  for (const line of i % 2 ? [lines[0], ...lines.slice(1).reverse()] : lines) {
    ctx.fillText(line, 40 + (i % 3) * 60, y);
    y += 95;
  }
  if (i === 9) {
    ctx.fillStyle = "#ddd";
    for (let n = 0; n < 800; n++) {
      const x = (n * 127) % 1700,
        y = (n * 79) % 1300;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  let bytes = canvas.toBuffer("image/png");
  if (i === 11) {
    const { rotatePNG } = await import("../src/images.js");
    bytes = rotatePNG(bytes);
  }
  const id = "ocr-v3-" + String(i + 1).padStart(2, "0");
  writeFileSync(root + "/documents/" + id + ".png", bytes);
  cases.push({
    id,
    split: "held-out",
    layout,
    font,
    scenario:
      i === 9
        ? "speckle"
        : i === 10
          ? "low-contrast"
          : i === 11
            ? "rotated"
            : "clean",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    groundTruth: { extracted: values },
  });
}
writeFileSync(
  root + "/cases.json",
  JSON.stringify(
    {
      version: "synthetic-v3-ten-field-heldout",
      freezePolicy:
        "All J/K/L layouts held out; glyph template asset and thresholds frozen before recognition; no post-evaluation tuning",
      cases,
    },
    null,
    2,
  ),
);
console.log("Frozen 12 held-out raster documents");
