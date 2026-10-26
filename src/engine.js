import { assessAICTE } from "./regulatory.js";
import { lookupIFSC } from "./financial.js";
import { assessPolicy } from "./policy.js";
export const fields = [
  "reference",
  "amountPaise",
  "bank",
  "ifsc",
  "issued",
  "matures",
];
export function comparable(field, value) {
  return typeof value === "string"
    ? field === "bank"
      ? value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()
      : field === "ifsc"
        ? value.trim().toUpperCase()
        : value.trim()
    : value;
}
export function validate(x) {
  if (!x || !Number.isSafeInteger(x.amountPaise) || x.amountPaise <= 0)
    throw Error("Positive integer amountPaise required");
  for (const k of ["reference", "bank", "ifsc", "issued", "matures"])
    if (typeof x[k] !== "string" || !x[k].trim() || x[k].length > 150)
      throw Error("Invalid " + k);
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(x.ifsc))
    throw Error("Invalid IFSC format");
  for (const k of ["issued", "matures"])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(x[k]) ||
      !Number.isFinite(Date.parse(x[k])) ||
      new Date(x[k]).toISOString().slice(0, 10) !== x[k]
    )
      throw Error("Invalid date");
  return Object.fromEntries(fields.map((k) => [k, x[k]]));
}
export { extract } from "./extraction.js";
export function evaluate({
  instrument,
  obligation,
  extraction = {},
  external = { status: "unavailable" },
  documentId,
  duplicates = [],
  regulatoryContext = {},
  proofs = [],
  ifscReference,
  asOf = new Date().toISOString().slice(0, 10),
}) {
  const findings = [];
  const add = (code, status, message, sources) =>
    findings.push({ code, status, message, sources });
  const referenceLookup = ifscReference || lookupIFSC(instrument.ifsc);
  if (referenceLookup.status !== "reference_match")
    add(
      "ifsc_unavailable",
      "unresolved",
      "IFSC reference source is unavailable for this identifier",
      [{ type: "ifsc-reference", source: referenceLookup.source }],
    );
  else if (
    comparable("bank", referenceLookup.bank) !==
    comparable("bank", instrument.bank)
  )
    add(
      "ifsc_bank_mismatch",
      "review",
      "Declared bank differs from versioned IFSC reference",
      [
        { type: "ifsc-reference", source: referenceLookup.source },
        { type: "declaration", field: "bank" },
      ],
    );
  if (duplicates.length)
    add(
      "duplicate_reference",
      "review",
      "Reference also appears in other accessible cases",
      duplicates.map((id) => ({ type: "case", id })),
    );
  for (const k of fields) {
    const v = extraction[k]?.value;
    if (
      extraction[k]?.engineConfidence !== null &&
      extraction[k]?.engineConfidence !== undefined &&
      extraction[k].engineConfidence < 70
    )
      add(
        "low_confidence_" + k,
        "unresolved",
        "OCR value has low uncalibrated engine confidence; inspect the source",
        [{ type: "document", id: documentId, field: k }],
      );
    if (v === undefined)
      add("missing_" + k, "unresolved", "No extracted " + k, [
        { type: "document", id: documentId, field: k },
      ]);
    else if (comparable(k, v) !== comparable(k, instrument[k]))
      add(
        "mismatch_" + k,
        "review",
        "Declared and extracted " + k + " differ",
        [
          { type: "declaration", field: k },
          { type: "document", id: documentId, field: k },
        ],
      );
    if (
      ["mock_confirmed", "sandbox_evidence"].includes(external.status) &&
      external.values?.[k] !== undefined &&
      comparable(k, external.values[k]) !== comparable(k, instrument[k])
    )
      add(
        "external_" + k,
        "review",
        "Provider evidence contradicts declaration (classification retained in source)",
        [
          {
            type: external.provider || "mock-provider",
            classification: external.status,
            field: k,
          },
          { type: "declaration", field: k },
        ],
      );
  }
  if (external.status !== "mock_confirmed")
    add(
      "bank_confirmation",
      "unresolved",
      "Bank confirmation unavailable; no authentication of deposit",
      [{ type: "provider", status: external.status }],
    );
  else
    add(
      "mock_only",
      "unresolved",
      "Development evidence is not bank verification",
      [{ type: "mock-provider" }],
    );
  if (instrument.amountPaise < obligation.amountPaise)
    add(
      "amount_shortfall",
      "review",
      "Declared amount below registered obligation; not an asserted regulatory minimum",
      [{ type: "obligation" }, { type: "declaration", field: "amountPaise" }],
    );
  if (instrument.matures <= instrument.issued)
    add("date_order", "review", "Maturity must follow issue date", [
      { type: "declaration", field: "matures" },
    ]);
  if (instrument.matures < asOf)
    add("expired", "review", "Declared instrument has matured", [
      { type: "declaration", field: "matures" },
    ]);
  add(
    "policy_unverified",
    "unresolved",
    "No verified AICTE policy supplied. Regulatory compliance requires authorized policy review.",
    [{ type: "policy", version: "unverified-1" }],
  );
  const regulatory = assessAICTE(instrument, regulatoryContext, proofs, asOf);
  for (const check of regulatory.checks)
    findings.push({
      code: "regulatory_" + check.id,
      status: check.status === "review" ? "review" : "unresolved",
      message: check.explanation,
      sources: [
        { type: "policy", version: regulatory.version, ...check.source },
      ],
      details: check,
    });
  return {
    referenceLookup,
    regulatory,
    policyAssessment: assessPolicy(
      { amountPaise: instrument.amountPaise },
      { asOf },
    ),
    version: 1,
    policyVersion: regulatoryContext.academicYear
      ? regulatory.version
      : "unverified-1",
    asOf,
    outcome: "human_review_required",
    findings,
    sources: { instrument, obligation, extraction, external, documentId },
    actions: [
      "Review discrepancies",
      "Obtain independent bank evidence",
      "Confirm applicable policy",
    ],
  };
}
