import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const sourceManifest = JSON.parse(
  readFileSync(new URL("../resources/source-manifest.json", import.meta.url)),
);
const source = (name, page, clause) => {
  const s = sourceManifest.find((x) => x.path.endsWith("/" + name + ".pdf"));
  return {
    url: s.url,
    path: s.path,
    sha256: s.sha256,
    documentVersion:
      name === "aph-2024-27"
        ? "APH 2024-2027"
        : name === "addendum-2025-26"
          ? "Addendum/Corrigendum 2025-26"
          : "Addendum/Corrigendum 2026-27",
    pdfPage: page,
    clause,
    verification: "reviewed_AI CTE_publication_copy".replace("AI CTE", "AICTE"),
    issuerHostConfirmed: false,
  };
};
const base = source("aph-2024-27", 26, "1.12; Table 1.4"),
  am25 = source("addendum-2025-26", 251, "4.10(c), addendum printed p14"),
  am26 = source("addendum-2026-27", 4, "items 10–11; 1.12 Table 1.4");
const amounts = {
  engineering: { diploma: 15, ug: 35, pg: 15 },
  planning: { diploma: 15, ug: 15, pg: 15 },
  applied_arts: { diploma: 15, ug: 15, pg: 15 },
  design: { diploma: 15, ug: 15, pg: 15 },
  hmct: { diploma: 15, ug: 15, pg: 15 },
  computer_applications: { ug: 5, pg: 15 },
  management: { ug: 5, pg: 15 },
};
export const ruleRegister = {
  version: "aicte-aph-2024-27-reviewed-copies-v2",
  authority:
    "AICTE publications; downloaded copies from mirrors; issuer confirmation pending",
  academicYears: ["2024-25", "2025-26", "2026-27"],
  rules: [
    {
      id: "programme_amount",
      source: base,
      applicability:
        "Supported programme and level; new institution or new programme/level",
      amountsLakh: amounts,
    },
    {
      id: "government_exemption",
      source: base,
      applicability:
        "New technical institution; Government or Government-aided; documentary classification reviewed",
    },
    {
      id: "prior_regulator_exemption",
      source: base,
      applicability:
        "Clause 1.3.3 and strictly more than 5 years with respective regulatory body; reviewed proof",
    },
    {
      id: "university_exemption",
      source: source("aph-2024-27", 58, "4.10(a)–(c)"),
      amendments: [am25],
      applicability:
        "Government university or eligible private university strictly more than 10 UGC-recognized years; new programme exception changes from 2025-26",
    },
    {
      id: "prior_release",
      source: base,
      applicability:
        "Prior security deposit released with reviewed NOC; balance/remaining term otherwise requires historical evidence",
    },
    {
      id: "lease_adjustment",
      source: base,
      amendments: [am26],
      applicability:
        "2024-25/2025-26 private lease; 2026-27 any lease; double base amount",
    },
    {
      id: "special_category_concession",
      source: am26,
      applicability:
        "2026-27 new institution/new programme/new level; listed geography, women-only or PwD-only; half table amount; lease interaction requires review",
    },
    {
      id: "holding_period",
      source: source("aph-2024-27", 26, "1.12(iv)–(v)"),
      applicability:
        "10-year Council holding period from actual deposit; not inferred from FDR tenor; extension/forfeiture case-dependent",
    },
    {
      id: "payment_and_affidavit",
      source: source("aph-2024-27", 47, "2.25(f)"),
      amendments: [
        source("addendum-2026-27", 11, "item28; 2.25(f) cross-reference"),
      ],
      applicability:
        "Existing-institution approvals; intimation/payment proof/Affidavit3 and 15-day interval; penalties require calendar and authority review",
    },
    {
      id: "release_clearances",
      source: source("aph-2024-27", 77, "6.46(a)–(f)"),
      amendments: [source("addendum-2026-27", 14, "items36–37; 6.46")],
      applicability:
        "Release requires application, affidavit6, instrument/payment proof, latest LoA/EoA and departmental clearances; no autonomous release",
    },
  ],
};
const evidenceRequirements = {
  programme_amount: ["applicability"],
  government_exemption: ["government_status"],
  prior_regulator_exemption: ["prior_regulator"],
  university_exemption: ["ugc_recognition"],
  prior_release: ["prior_release_noc"],
  lease_adjustment: ["applicability"],
  special_category_concession: ["special_category"],
  holding_period: ["Council deposit-date proof"],
  payment_and_affidavit: ["payment_affidavit3"],
  release_clearances: [
    "application",
    "Affidavit6",
    "instrument/payment proof",
    "current LoA/EoA",
    "departmental clearances",
  ],
};
for (const rule of ruleRegister.rules)
  Object.assign(rule, {
    documentVersion:
      "APH2024-27 with separately pinned 2025-26/2026-27 amendments where listed",
    effectiveAcademicYears:
      rule.id === "special_category_concession"
        ? ["2026-27"]
        : ruleRegister.academicYears,
    exactEffectiveDate: null,
    effectiveDateStatus:
      "Academic-year selection only; issuer notice dates not independently verified",
    officialSource: rule.source.path.endsWith("aph-2024-27.pdf")
      ? "https://www.aicte.gov.in/sites/default/files/APH%20Final.pdf"
      : null,
    officialAmendmentSource: null,
    validationStatus: "UNVERIFIED_POLICY",
    requiredEvidence: evidenceRequirements[rule.id],
    exceptions:
      "Apply only stated conditions and edition; missing evidence/unsupported intersections require human review",
    testReferences: ["tests/regulatory.test.js", "tests/final-gap.test.js"],
  });
export function validateContext(c) {
  if (!c || typeof c !== "object" || Array.isArray(c))
    throw Error("Regulatory context object required");
  const allowed = {
    academicYear: ["2024-25", "2025-26", "2026-27"],
    programme: Object.keys(amounts),
    level: ["diploma", "ug", "pg", "pg_certificate"],
    entity: [
      "technical",
      "private_university",
      "deemed_private",
      "government_university",
    ],
    ownership: ["private", "government", "government_aided"],
    application: [
      "new_institution",
      "new_programme",
      "new_level",
      "clause_1_3_3",
      "conversion",
      "release",
    ],
    property: ["owned", "private_lease", "government_lease"],
    concession: [
      "none",
      "north_east",
      "jammu_kashmir",
      "ladakh",
      "aspirational_district",
      "andaman_nicobar",
      "lakshadweep",
      "women_only",
      "pwd_only",
    ],
  };
  const result = {};
  for (const [k, v] of Object.entries(c)) {
    if (allowed[k]) {
      if (!allowed[k].includes(v)) throw Error("Unsupported " + k);
      result[k] = v;
    } else if (
      [
        "ugcRecognitionDate",
        "regulatorRecognitionDate",
        "applicationDate",
        "depositDate",
        "intimationDate",
        "paymentDate",
      ].includes(k)
    ) {
      if (
        typeof v !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        !Number.isFinite(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v
      )
        throw Error("Invalid " + k);
      result[k] = v;
    } else throw Error("Unsupported context field " + k);
  }
  return result;
}
const afterYears = (date, years, asOf) => {
  if (!date || !asOf) return false;
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return asOf > d.toISOString().slice(0, 10);
};
export function assessAICTE(
  instrument,
  context = {},
  proofs = [],
  asOf = new Date().toISOString().slice(0, 10),
) {
  const checks = [],
    add = (id, status, explanation, extra = {}) => {
      const rule = ruleRegister.rules.find((r) => r.id === id);
      checks.push({
        id,
        status,
        explanation,
        source: rule?.source,
        amendments: rule?.amendments,
        ...extra,
      });
    },
    proof = (type) =>
      proofs.some(
        (p) => p.type === type && p.decision === "accepted" && p.documentId,
      ),
    year = context.academicYear;
  const version = year ? "APH-" + year + "-reviewed-copy-v2" : "unverified-1",
    result = () => ({
      version,
      status: "human_review_required",
      authorityVerified: false,
      requiredAmountPaise: required,
      checks,
      applicability: context,
      proofs,
      registerVersion: ruleRegister.version,
    });
  let required = null;
  if (!ruleRegister.academicYears.includes(year)) {
    add(
      "programme_amount",
      "unresolved",
      "Academic year/applicability not established.",
    );
    return result();
  }
  const missing = [
    "programme",
    "level",
    "entity",
    "ownership",
    "application",
    "property",
    "concession",
    "applicationDate",
  ].filter((k) => !context[k]);
  if (missing.length) {
    add(
      "programme_amount",
      "unresolved",
      "Missing applicability facts: " + missing.join(", "),
    );
    return result();
  }
  if (!proof("applicability"))
    add(
      "programme_amount",
      "unresolved",
      "Institutional applicability is claimed; officer-reviewed source evidence is required.",
    );
  if (
    context.entity === "government_university" &&
    year === "2024-25" &&
    ["new_programme", "new_level"].includes(context.application)
  ) {
    add(
      "university_exemption",
      "unresolved",
      "2024-25 clauses 4.10(a) and 4.10(c) overlap for a government university adding a programme/level; authoritative interpretation required.",
    );
    return result();
  }
  let exempt = false;
  if (
    context.entity === "government_university" ||
    (context.entity === "technical" &&
      context.application === "new_institution" &&
      ["government", "government_aided"].includes(context.ownership)) ||
    (context.entity === "technical" &&
      ["new_level", "new_programme"].includes(context.application) &&
      context.ownership === "government")
  ) {
    exempt = proof("government_status");
    add(
      "government_exemption",
      exempt ? "reference_supported" : "unresolved",
      exempt
        ? "Government classification evidence supports the reference exemption."
        : "Government exemption claim requires reviewed classification evidence.",
    );
  }
  if (
    ["private_university", "deemed_private"].includes(context.entity) &&
    afterYears(context.ugcRecognitionDate, 10, context.applicationDate)
  ) {
    const applicable =
      year !== "2024-25" ||
      !["new_programme", "new_level"].includes(context.application);
    exempt = applicable && proof("ugc_recognition");
    add(
      "university_exemption",
      exempt ? "reference_supported" : "unresolved",
      applicable
        ? "More-than-ten-year UGC recognition exemption requires reviewed evidence."
        : "2024-25 new programme/level is not covered by the later exemption amendment.",
    );
  }
  if (context.application === "clause_1_3_3") {
    exempt =
      afterYears(
        context.regulatorRecognitionDate,
        5,
        context.applicationDate,
      ) && proof("prior_regulator");
    add(
      "prior_regulator_exemption",
      exempt ? "reference_supported" : "unresolved",
      "Clause 1.3.3 exemption requires strictly more than five recognized years and reviewed proof.",
    );
  }
  if (proof("prior_release_noc")) {
    const supported =
      context.entity !== "technical" || context.application === "conversion";
    exempt = exempt || supported;
    add(
      "prior_release",
      supported ? "reference_supported" : "unresolved",
      supported
        ? "Prior release NOC supplied and reviewed for the referenced historical category."
        : "NOC alone does not establish the historical conversion/category conditions; no blanket new-institution exemption.",
    );
  }
  if (["conversion", "release"].includes(context.application)) {
    add(
      "prior_release",
      "unresolved",
      "Historical balance/remaining period or release clearance requires a case-specific determination.",
    );
    if (context.application === "release")
      add(
        "release_clearances",
        "unresolved",
        "Release requires application, Affidavit6, current approval, instrument/payment evidence, pending-complaint checks and departmental clearances; maturity alone is insufficient. Renewal/replacement restrictions are not independently verified for this edition.",
      );
    return result();
  }
  const level =
      context.level === "pg_certificate" && year !== "2024-25"
        ? "pg"
        : context.level,
    n = amounts[context.programme]?.[level];
  if (!Number.isSafeInteger(n)) {
    add(
      "programme_amount",
      "unresolved",
      "Programme/level combination is not covered by the reviewed table transcription.",
    );
    return result();
  }
  required = n * 10000000;
  add(
    "programme_amount",
    "reference_calculated",
    "Table amount transcribed from the source publication.",
    { baseAmountPaise: required },
  );
  const leased =
    context.property === "private_lease" ||
    (year === "2026-27" && context.property === "government_lease");
  if (leased) {
    required *= 2;
    add(
      "lease_adjustment",
      "reference_calculated",
      "Leased-property adjustment according to the selected academic-year wording.",
    );
  }
  if (year === "2026-27" && context.concession !== "none") {
    if (leased) {
      required = null;
      add(
        "special_category_concession",
        "unresolved",
        "Concession and lease adjustment interaction requires authoritative clarification; no multiplication order assumed.",
      );
    } else if (
      !["new_institution", "new_programme", "new_level"].includes(
        context.application,
      ) ||
      !proof("special_category")
    ) {
      required = null;
      add(
        "special_category_concession",
        "unresolved",
        "Concession applicability/proof is unresolved.",
      );
    } else {
      required /= 2;
      add(
        "special_category_concession",
        "reference_calculated",
        "Reviewed category claim falls within the 2026-27 concession.",
      );
    }
  } else if (year !== "2026-27" && context.concession !== "none")
    add(
      "special_category_concession",
      "unresolved",
      "The 2026-27 concession is not retroactively applied.",
    );
  if (exempt) required = 0;
  if (required !== null)
    add(
      "programme_amount",
      instrument.amountPaise >= required ? "reference_supported" : "review",
      "Declared deposit compared with the calculated reference requirement.",
      {
        requiredAmountPaise: required,
        actualAmountPaise: instrument.amountPaise,
      },
    );
  if (context.depositDate) {
    const end = new Date(context.depositDate);
    end.setUTCFullYear(end.getUTCFullYear() + 10);
    add(
      "holding_period",
      "review",
      "Council holding period is distinct from FDR maturity; extension, forfeiture and release require authorized determination.",
      { referenceHoldingEnd: end.toISOString().slice(0, 10), asOf },
    );
  } else
    add(
      "holding_period",
      "unresolved",
      "Actual Council deposit date is missing; FDR issue date is not substituted.",
    );
  if (context.application !== "new_institution") {
    if (context.intimationDate && context.paymentDate) {
      const days =
        (Date.parse(context.paymentDate) - Date.parse(context.intimationDate)) /
        86400000;
      add(
        "payment_and_affidavit",
        days >= 0 && days <= 15 && proof("payment_affidavit3")
          ? "reference_supported"
          : "review",
        "Check proof, Affidavit3 and intimation interval; penalties are not autonomously imposed.",
        { elapsedDays: days },
      );
    } else
      add(
        "payment_and_affidavit",
        "unresolved",
        "Intimation, payment dates and Affidavit3 evidence are needed.",
      );
  }
  add(
    "release_clearances",
    "review",
    "Release requires the referenced documents and departmental clearances; no automatic release or approval.",
  );
  return result();
}
