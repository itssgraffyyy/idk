import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { lookupIFSC } from "../src/ifsc.js";
const codes = [
  "HDFC0001234",
  "ICIC0001234",
  "SBIN0012345",
  "KKBK0000958",
  "UTIB0001234",
  "BARB0VJANDH",
  "CNRB0001234",
  "PUNB0123400",
];
const refs = codes
  .map(lookupIFSC)
  .filter((r) => r.status === "reference_match");
if (refs.length < 4) throw Error("Expected real pinned reference records");
const out = "datasets/v2";
mkdirSync(out + "/documents", { recursive: true });
const cases = [];
for (let i = 0; i < 16; i++) {
  const r = refs[i % refs.length],
    split = i < 12 ? "development" : "held-out";
  const layout = i < 12 ? ["D", "E", "F"][i % 3] : ["G", "H"][i % 2];
  const fields = {
    reference: "TEST-V2-" + String(i + 1).padStart(3, "0"),
    amountPaise: 12500000 + i * 100,
    bank: r.bank,
    ifsc: r.code,
    issued: "2026-01-15",
    matures: "2031-01-15",
  };
  let ifsc = "IFSC : " + r.code,
    scenario = "normal";
  if (i % 4 === 1) {
    ifsc = "IFSC Code = (" + r.code.slice(0, 4) + "-" + r.code.slice(4) + ")";
    scenario = "punctuation";
  }
  if (i % 4 === 2) {
    ifsc = "IFSC : " + r.code.slice(0, 4) + "\n" + r.code.slice(4);
    scenario = "split-line";
  }
  if (i === 10) {
    ifsc = "IFSC : ZZZZ0123456";
    fields.ifsc = "ZZZZ0123456";
    scenario = "unknown";
  }
  if (i === 11) {
    ifsc = "IFSC : " + r.code + " ; " + refs[(i + 1) % refs.length].code;
    delete fields.ifsc;
    scenario = "ambiguous";
  }
  if (i === 15) scenario += "-low-contrast";
  const text = [
    "SYNTHETIC TEST - NO REAL DEPOSIT",
    "FDR reference : " + fields.reference,
    "amountPaise : " + fields.amountPaise,
    "Bank name : " + fields.bank,
    ifsc,
    "Issue date : " + fields.issued,
    "Maturity date : " + fields.matures,
  ].join("\n");
  const canvas = createCanvas(1500, 900),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1500, 900);
  const fonts = {
    D: "Arial",
    E: "Georgia",
    F: "Consolas",
    G: "Times New Roman",
    H: "Verdana",
  };
  ctx.font = "30px '" + fonts[layout] + "'";
  ctx.fillStyle = i === 15 ? "#999" : "#111";
  let y = 70;
  const x = layout === "G" ? 160 : 55;
  if (layout === "H") {
    ctx.strokeStyle = "#aaa";
    ctx.strokeRect(25, 25, 1450, 820);
  }
  for (const line of text.split("\n")) {
    ctx.fillText(line, x, y);
    y += 75;
  }
  const bytes = canvas.toBuffer("image/png"),
    id = "ocr-v2-" + String(i + 1).padStart(2, "0");
  writeFileSync(out + "/documents/" + id + ".png", bytes);
  writeFileSync(out + "/documents/" + id + ".txt", text);
  cases.push({
    id,
    split,
    layout,
    scenario,
    font: fonts[layout],
    sha256: createHash("sha256").update(bytes).digest("hex"),
    groundTruth: {
      extracted: fields,
      reviewRequired:
        scenario === "ambiguous" || scenario === "unknown" || i === 15,
    },
  });
}
writeFileSync(
  out + "/cases.json",
  JSON.stringify(
    {
      version: "synthetic-v2-ifsc-diversity",
      purpose:
        "Fictional deposits with real public branch identifiers; no bank authenticity evidence",
      freezePolicy:
        "G/H held out from parser tuning; generated before evaluation; v1 retained unchanged",
      cases,
    },
    null,
    2,
  ),
);
console.log(
  "Generated " +
    cases.length +
    " immutable-for-evaluation fixtures, " +
    refs.length +
    " real branch references",
);
