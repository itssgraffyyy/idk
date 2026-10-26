import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { extract } from "../src/engine.js";
export function generate(count = 20) {
  const names = [
    "consistent",
    "amount-mismatch",
    "missing-reference",
    "duplicate-reference",
    "bank-mismatch",
    "ifsc-mismatch",
    "unreadable",
    "rotated",
    "missing-dates",
    "date-order",
    "unsupported-exemption",
    "synthetic-exemption",
    "external-conflict",
    "external-unavailable",
    "shortfall",
    "expired",
    "missing-amount",
    "missing-ifsc",
    "missing-bank",
    "multiple-conflicts",
  ];
  const cases = [];
  for (let i = 0; i < count; i++) {
    const scenario = names[i % 20],
      instrument = {
        reference: "SYN-" + String(i + 1).padStart(4, "0"),
        amountPaise: 10000000 + i * 100,
        bank: "Synthetic Bank",
        ifsc: "SYNB0000001",
        issued: "2026-01-01",
        matures: "2030-01-01",
      },
      values = { ...instrument },
      expected = [],
      obligation = { amountPaise: instrument.amountPaise },
      external = {
        status: "mock_confirmed",
        provider: "fictional-term-deposit-v1",
        realBankEvidence: false,
        values: { ...instrument },
      };
    let duplicates = [],
      exemption = null;
    switch (scenario) {
      case "amount-mismatch":
        values.amountPaise -= 100;
        expected.push("mismatch_amountPaise");
        break;
      case "missing-reference":
        delete values.reference;
        expected.push("missing_reference");
        break;
      case "duplicate-reference":
        duplicates = ["fictional-other-case"];
        expected.push("duplicate_reference");
        break;
      case "bank-mismatch":
        values.bank = "Imaginary Other Bank";
        expected.push("mismatch_bank");
        break;
      case "ifsc-mismatch":
        values.ifsc = "OTHR0000001";
        expected.push("mismatch_ifsc");
        break;
      case "unreadable":
        for (const k of Object.keys(values)) {
          delete values[k];
          expected.push("missing_" + k);
        }
        break;
      case "missing-dates":
        delete values.issued;
        delete values.matures;
        expected.push("missing_issued", "missing_matures");
        break;
      case "date-order":
        instrument.matures = "2025-01-01";
        values.matures = instrument.matures;
        external.values.matures = instrument.matures;
        expected.push("date_order", "expired");
        break;
      case "unsupported-exemption":
        exemption = { claim: "Government institution", verified: false };
        break;
      case "synthetic-exemption":
        exemption = {
          claim: "SYNTHETIC-TEST-ONLY",
          verified: true,
          scope: "development-fixture-not-AICTE",
        };
        break;
      case "external-conflict":
        external.values.amountPaise += 10000;
        expected.push("external_amountPaise");
        break;
      case "external-unavailable":
        external.status = "unavailable";
        external.values = null;
        break;
      case "shortfall":
        obligation.amountPaise += 10000;
        expected.push("amount_shortfall");
        break;
      case "expired":
        instrument.matures = "2026-02-01";
        values.matures = instrument.matures;
        external.values.matures = instrument.matures;
        expected.push("expired");
        break;
      case "missing-amount":
        delete values.amountPaise;
        expected.push("missing_amountPaise");
        break;
      case "missing-ifsc":
        delete values.ifsc;
        expected.push("missing_ifsc");
        break;
      case "missing-bank":
        delete values.bank;
        expected.push("missing_bank");
        break;
      case "multiple-conflicts":
        values.bank = "Imaginary Other Bank";
        values.amountPaise = 10;
        external.values.reference = "CONFLICT";
        expected.push(
          "mismatch_bank",
          "mismatch_amountPaise",
          "external_reference",
        );
    }
    expected.push(
      external.status === "unavailable" ? "bank_confirmation" : "mock_only",
      "policy_unverified",
    );
    const split = i % 5 === 4 ? "held-out" : "development",
      layout = split === "held-out" ? "C" : i % 2 ? "B" : "A",
      entries = Object.entries(values),
      text =
        "SYNTHETIC FIXTURE — NOT A BANK DOCUMENT\nFictional Institute " +
        (i + 1) +
        "\n" +
        (layout === "B" ? entries.reverse() : entries)
          .map(([k, v]) => k + (layout === "C" ? " = " : " : ") + v)
          .join("\n");
    cases.push({
      id: "case-" + String(i + 1).padStart(3, "0"),
      scenario,
      split,
      layout,
      instrument,
      obligation,
      external,
      duplicates,
      exemption,
      text,
      rotation: scenario === "rotated" ? 90 : 0,
      groundTruth: {
        extracted: values,
        confidence: "unknown/null; no calibrated field confidence",
        expectedCodes: expected.sort(),
        policyVersion: "unverified-1",
        evidenceStatus: external.status,
        reviewOutcome: "human_review_required",
        regulatoryCondition:
          "No verified AICTE rule; exemptions must remain unconfirmed",
      },
    });
  }
  return cases;
}
const n = Number(process.argv[2] || 20);
if (!Number.isInteger(n) || n < 20 || n > 10000)
  throw Error("Count must be 20..10000");
const cases = generate(n);
mkdirSync("datasets/v1/documents", { recursive: true });
for (const c of cases)
  writeFileSync("datasets/v1/documents/" + c.id + ".txt", c.text);
writeFileSync(
  "datasets/v1/cases.json",
  JSON.stringify(
    { version: "synthetic-v1", seed: "deterministic-1", cases },
    null,
    2,
  ),
);
console.log(
  "Generated " +
    cases.length +
    " cases; use render-fixtures.ps1 for raster documents.",
);

for (const split of ["development", "held-out"])
  writeFileSync(
    "datasets/v1/" + split + ".json",
    JSON.stringify(
      {
        version: "synthetic-v1",
        seed: "deterministic-1",
        cases: cases.filter((c) => c.split === split),
      },
      null,
      2,
    ),
  );
