import { assessAICTE, ruleRegister } from "./regulatory.js";
import { lookupIFSC } from "./financial.js";
import { assessPolicy } from "./policy.js";
import { evaluatePolicy, findingSeverity } from "./policy-runtime.js";
export const fields = [
  "reference",
  "amountPaise",
  "bank",
  "ifsc",
  "issued",
  "matures",
];
export const evidenceFields = [
  ...fields,
  "institutionName",
  "depositor",
  "branch",
  "currency",
  "type",
];
export function comparable(field, value) {
  return typeof value === "string"
    ? ["bank", "institutionName", "depositor", "branch"].includes(field)
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
  const result = Object.fromEntries(fields.map((k) => [k, x[k]]));
  for (const k of [
    "type",
    "currency",
    "branch",
    "institutionName",
    "depositor",
  ])
    if (x[k] !== undefined) {
      if (typeof x[k] !== "string" || !x[k].trim() || x[k].length > 150)
        throw Error("Invalid " + k);
      result[k] = x[k].trim();
    }
  if (result.type && !["FDR", "TERM_DEPOSIT"].includes(result.type))
    throw Error("Unsupported instrument type");
  if (result.currency && result.currency !== "INR")
    throw Error("Only INR instruments supported");
  return result;
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
  policies = [],
  policyScope = "aicte",
  verifiedSourceHashes = [],
}) {
  const findings = [];
  const add = (code, status, message, sources) =>
    findings.push({ code, status, message, sources });
  const referenceLookup = ifscReference || lookupIFSC(instrument.ifsc);
  if (external.freshness?.status === "STALE")
    add(
      "external_stale",
      "unresolved",
      "Provider data range is stale under the local review window; retrieval time does not refresh the financial record",
      [{ type: "provider", classification: external.status }],
    );
  if (external.partial)
    add(
      "external_partial",
      "unresolved",
      "Only part of the requested financial data was delivered",
      [{ type: "provider", classification: external.status }],
    );
  if (extraction.ifsc?.status === "REQUIRES_REVIEW")
    add(
      "ifsc_extraction_review",
      "unresolved",
      extraction.ifsc.reasons.join("; "),
      [{ type: "document", id: documentId, field: "ifsc" }],
    );
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
  for (const k of evidenceFields) {
    if (k !== "ifsc" && extraction[k]?.status === "REQUIRES_REVIEW")
      add(
        "ocr_extraction_review_" + k,
        "unresolved",
        (extraction[k].reasons || ["Extracted source needs review"]).join("; "),
        [{ type: "document", id: documentId, field: k }],
      );
    const v = extraction[k]?.value;
    if (instrument[k] === undefined)
      add(
        "missing_declaration_" + k,
        "unresolved",
        "Institution declaration lacks " + k,
        [{ type: "declaration", field: k }],
      );
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
      instrument[k] !== undefined &&
      external.freshness?.status !== "STALE" &&
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
  for (const id of new Set(regulatory.checks.map((c) => c.id))) {
    const checks = regulatory.checks.filter((c) => c.id === id);
    const check = checks.at(-1);
    findings.push({
      code: "regulatory_" + check.id,
      status: checks.some((c) => c.status === "unresolved")
        ? "unresolved"
        : check.status === "review"
          ? "review"
          : "unresolved",
      message: checks.map((c) => c.explanation).join(" "),
      sources: [
        { type: "policy", version: regulatory.version, ...check.source },
      ],
      details: { ...check, checks },
    });
  }
  for (const finding of findings) {
    finding.severity = findingSeverity(finding.code, finding.status);
    finding.reason = finding.message;
    finding.evaluationVersion = 1;
    finding.evaluationStatus = "human_review_required";
    finding.policyRule = finding.code.startsWith("regulatory_")
      ? finding.code.slice(11)
      : null;
    finding.values = finding.sources.map((s) => ({
      source: s.type,
      field: s.field ?? null,
      value:
        s.type === "declaration"
          ? s.field
            ? instrument[s.field]
            : instrument
          : s.type === "document"
            ? (extraction[s.field]?.value ?? null)
            : s.type === "obligation"
              ? obligation.amountPaise
              : s.type === "ifsc-reference"
                ? (referenceLookup.bank ?? null)
                : s.field
                  ? (external.values?.[s.field] ?? null)
                  : null,
      classification:
        s.classification ??
        (s.type === "document"
          ? "document_extraction_not_authentication"
          : s.type === "ifsc-reference"
            ? "branch_reference_only"
            : s.type),
    }));
    finding.missingEvidence = finding.code.startsWith("missing_")
      ? [finding.code.slice(8)]
      : finding.code === "bank_confirmation" || finding.code === "mock_only"
        ? ["authorized_independent_bank_confirmation"]
        : [];
    if (finding.code === "policy_unverified" || finding.policyRule) {
      finding.missingEvidence.push("issuer_verified_policy_source");
      const rule = ruleRegister.rules.find((r) => r.id === finding.policyRule);
      if (rule)
        finding.missingEvidence.push(
          ...rule.requiredEvidence.filter(
            (type) =>
              !proofs.some(
                (p) =>
                  p.type === type && p.decision === "accepted" && p.documentId,
              ),
          ),
        );
    }
    if (finding.code === "bank_confirmation" || finding.code === "mock_only")
      finding.missingEvidence.push(
        ...fields
          .filter((k) => external.values?.[k] === undefined)
          .map((k) => "provider_" + k),
      );
    finding.suggestedAction =
      finding.code.startsWith("regulatory_") ||
      finding.code === "policy_unverified"
        ? "Review source edition, applicability and referenced proof; no automatic release"
        : finding.code === "bank_confirmation" || finding.code === "mock_only"
          ? "Obtain authorized independent bank evidence"
          : "Compare referenced evidence and record a reasoned correction or reviewer observation";
  }
  return {
    operationalPolicy: evaluatePolicy(
      { ...instrument, ...regulatoryContext, proofs },
      { policies, scope: policyScope, asOf, verifiedSourceHashes },
    ),
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
