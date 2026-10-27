import { snapshotHash } from "./clearance-procedure.js";
export const policyHistoryMigration = {
  version: 17,
  sql: `CREATE TABLE policy_capsules(sha256 TEXT PRIMARY KEY,scope TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),created TEXT NOT NULL);
CREATE TABLE evaluation_policy_context(evaluation_id TEXT PRIMARY KEY REFERENCES evidence(id),case_id TEXT NOT NULL REFERENCES cases(id),capsule_sha256 TEXT NOT NULL REFERENCES policy_capsules(sha256),basis TEXT NOT NULL,created TEXT NOT NULL);
CREATE INDEX evaluation_policy_case ON evaluation_policy_context(case_id,created);
CREATE TRIGGER policy_capsules_immutable BEFORE UPDATE ON policy_capsules BEGIN SELECT RAISE(ABORT,'immutable policy capsule');END;
CREATE TRIGGER policy_capsules_no_delete BEFORE DELETE ON policy_capsules BEGIN SELECT RAISE(ABORT,'immutable policy capsule');END;
CREATE TRIGGER evaluation_policy_immutable BEFORE UPDATE ON evaluation_policy_context BEGIN SELECT RAISE(ABORT,'immutable evaluation policy context');END;
CREATE TRIGGER evaluation_policy_no_delete BEFORE DELETE ON evaluation_policy_context BEGIN SELECT RAISE(ABORT,'immutable evaluation policy context');END;
CREATE TRIGGER evaluation_policy_valid BEFORE INSERT ON evaluation_policy_context WHEN NOT EXISTS(SELECT 1 FROM evidence e WHERE e.id=NEW.evaluation_id AND e.case_id=NEW.case_id AND e.kind IN ('evaluation','evaluation_replay') AND json_extract(e.payload,'$.policyConfiguration.sha256')=NEW.capsule_sha256) BEGIN SELECT RAISE(ABORT,'invalid evaluation policy binding');END;`,
};
const fail = (message) => {
  throw Object.assign(Error(message), { status: 409 });
};
export function capturePolicyConfiguration(
  db,
  { policies, scope, verifiedSourceHashes, regulatoryRegister },
  audit,
) {
  const configuration = JSON.parse(
      JSON.stringify({
        policies,
        scope,
        verifiedSourceHashes,
        regulatoryRegister,
      }),
    ),
    sha256 = snapshotHash(configuration);
  const existing = db
    .prepare("SELECT * FROM policy_capsules WHERE sha256=?")
    .get(sha256);
  if (existing) {
    if (
      snapshotHash(JSON.parse(existing.payload)) !== sha256 ||
      existing.scope !== scope
    )
      fail("Policy capsule integrity failure");
    return { sha256, scope, configuration, created: existing.created };
  }
  const created = new Date().toISOString();
  db.prepare("INSERT INTO policy_capsules VALUES(?,?,?,?)").run(
    sha256,
    scope,
    JSON.stringify(configuration),
    created,
  );
  audit?.("system", "policy_configuration_captured", null, {
    sha256,
    scope,
    classification: "TRUSTED_CONFIGURATION_CAPTURE_NOT_ISSUER_CONFIRMATION",
  });
  return { sha256, scope, configuration, created };
}
export function loadPolicyConfiguration(db, sha256) {
  const row = db
    .prepare("SELECT * FROM policy_capsules WHERE sha256=?")
    .get(sha256);
  if (
    !row ||
    snapshotHash(JSON.parse(row.payload)) !== sha256 ||
    row.scope !== JSON.parse(row.payload).scope
  )
    fail("Policy configuration unavailable or integrity check failed");
  return {
    sha256,
    scope: row.scope,
    created: row.created,
    configuration: JSON.parse(row.payload),
  };
}
export function bindPolicyContext(db, evaluationId, caseId, payload) {
  if (!payload.policyConfiguration?.sha256) return;
  loadPolicyConfiguration(db, payload.policyConfiguration.sha256);
  db.prepare("INSERT INTO evaluation_policy_context VALUES(?,?,?,?,?)").run(
    evaluationId,
    caseId,
    payload.policyConfiguration.sha256,
    payload.policyConfiguration.basis,
    new Date().toISOString(),
  );
}
export function attachPolicyContext(
  report,
  capsule,
  facts,
  basis = "RECORDED_CONFIGURATION",
) {
  report.policyConfiguration = {
    sha256: capsule.sha256,
    scope: capsule.scope,
    capturedAt: capsule.created,
    basis,
    originalConfigurationAvailable: true,
  };
  report.policyFacts = JSON.parse(JSON.stringify(facts));
  report.policyExplanation = explainPolicy(report, capsule.configuration);
  return report;
}
const authority = (policy, assessment) =>
  !policy
    ? "UNSUPPORTED_OR_UNAVAILABLE_SOURCE"
    : policy.classification === "SYNTHETIC"
      ? "SYNTHETIC_TEST_POLICY"
      : assessment.realRegulatoryAuthority === true
        ? "VERIFIED_OFFICIAL_POLICY"
        : "PROVISIONAL_INTERPRETATION";
export function explainPolicy(report, configuration = null) {
  const assessment = report.operationalPolicy || {},
    p = configuration?.policies?.find(
      (p) =>
        p.version === assessment.version && p.scope === configuration.scope,
    ),
    refs = report.sourceReferences || {},
    facts = {
      ...report.policyFacts?.instrument,
      ...report.policyFacts?.context,
    };
  const category = authority(p, assessment),
    period = p ? { from: p.effectiveFrom, to: p.effectiveTo } : null;
  const baseChecks = assessment.checks?.length
    ? assessment.checks
    : (p?.rules || []).map((r) => ({
        ruleId: r.id,
        outcome: "UNVERIFIED_POLICY",
        severity: r.severity || "MEDIUM",
        expected: r.amountPaise ?? null,
        actual: facts.amountPaise ?? null,
        missingEvidence: ["issuer_verified_policy_source"],
      }));
  const checks = baseChecks.map((check) => {
    const rule = p?.rules.find((r) => r.id === check.ruleId),
      predicates = Object.entries(rule?.conditions || {}).map(
        ([field, expected]) => ({
          field,
          expected,
          actual: facts[field] ?? null,
          outcome: !Object.hasOwn(facts, field)
            ? "MISSING_FACT"
            : facts[field] === expected
              ? "MATCH"
              : "DOES_NOT_APPLY",
          evidenceId: Object.hasOwn(report.policyFacts?.context || {}, field)
            ? refs.regulatoryContext || null
            : refs.declaration || null,
        }),
      );
    const explanations = {
      COMPLIANT:
        "The configured condition is supported by the recorded facts and referenced evidence.",
      NON_COMPLIANT:
        "The recorded facts do not satisfy the configured condition.",
      INSUFFICIENT_EVIDENCE: "Required facts or reviewed evidence are missing.",
      NOT_APPLICABLE:
        check.reason ||
        "The recorded applicability conditions exclude this rule.",
      NEEDS_HUMAN_REVIEW:
        check.reason || "This rule needs an authorized interpretation.",
    };
    return {
      ruleId: check.ruleId,
      policyVersion: assessment.version,
      authorityCategory: category,
      effectivePeriod: period,
      source: p?.source || check.source || null,
      sourceSHA256: p?.sourceSHA256 || check.sourceSHA256 || null,
      sourceVerified: category === "VERIFIED_OFFICIAL_POLICY",
      applicability: predicates,
      expected: check.expected ?? null,
      actual: check.actual ?? null,
      outcome: check.outcome,
      severity: check.severity || "MEDIUM",
      explanation:
        explanations[check.outcome] || "An authorized review is required.",
      exceptions: {
        exempts: rule?.exempts || [],
        appliedReason: check.reason || null,
      },
      missingEvidence: check.missingEvidence || [],
      evidence: check.evidence || [],
      factReferences: {
        declaration: refs.declaration || null,
        regulatoryContext: refs.regulatoryContext || null,
        documentVersion: refs.document || null,
        extraction: refs.extraction || null,
        proofReviews: refs.proofReviews || [],
      },
      reviewRequired:
        category !== "VERIFIED_OFFICIAL_POLICY" ||
        [
          "INSUFFICIENT_EVIDENCE",
          "NEEDS_HUMAN_REVIEW",
          "NON_COMPLIANT",
        ].includes(check.outcome),
      nextAction:
        category === "SYNTHETIC_TEST_POLICY"
          ? "Use this fictional result to test the workflow; obtain authoritative policy before real administrative reliance."
          : category !== "VERIFIED_OFFICIAL_POLICY"
            ? "Confirm the source edition and issuer authority with an authorized reviewer."
            : check.outcome === "INSUFFICIENT_EVIDENCE"
              ? "Supply the missing facts or reviewed proof, then reevaluate."
              : "Review the recorded facts and prerequisite clearances before a separate administrative decision.",
    };
  });
  return {
    policyVersion: assessment.version || null,
    configurationSHA256: report.policyConfiguration?.sha256 || null,
    authorityCategory: category,
    effectivePeriod: period,
    asOf: report.asOf,
    outcome: assessment.outcome || "UNVERIFIED_POLICY",
    checks,
    reason:
      assessment.reason ||
      (category === "UNSUPPORTED_OR_UNAVAILABLE_SOURCE"
        ? "The original trusted policy configuration is unavailable or no policy matches this scope/date."
        : category === "SYNTHETIC_TEST_POLICY"
          ? "Fictional test policy; no real regulatory authority."
          : category === "PROVISIONAL_INTERPRETATION"
            ? "Source authority is not independently confirmed."
            : "Verified source configuration; administrative approval remains separate."),
    regulatoryReference: {
      edition: report.regulatory?.version || null,
      authorityCategory: "PROVISIONAL_INTERPRETATION",
      sourceVerified: false,
      checks: (report.regulatory?.checks || []).map((r) => {
        const rule = configuration?.regulatoryRegister?.rules?.find(
          (v) => v.id === r.id,
        );
        const missingEvidence = (rule?.requiredEvidence || []).filter(
          (type) =>
            !(report.policyFacts?.proofs || []).some(
              (p) =>
                p.type === type && p.decision === "accepted" && p.documentId,
            ),
        );
        return {
          ...r,
          ruleId: r.id,
          policyEdition: report.regulatory?.version || null,
          applicability:
            rule?.applicability ||
            "Applicability not captured in the original configuration",
          effectiveAcademicYears: rule?.effectiveAcademicYears || [],
          exactEffectiveDate: rule?.exactEffectiveDate || null,
          effectiveDateStatus: rule?.effectiveDateStatus || "Not captured",
          exceptionConditions: rule?.exceptions || null,
          recordedInstitutionFacts: report.policyFacts?.context || null,
          recordedInstrumentFacts:
            report.policyFacts?.instrument ||
            report.sources?.instrument ||
            null,
          factReferences: { ...refs },
          missingEvidence,
          reviewRequirements: [
            "issuer_verified_policy_source",
            ...missingEvidence,
          ],
          sourceVerified: false,
          reviewRequired: true,
          assessmentMode: report.isHistoricalReplay
            ? "RECORDED_REFERENCE_CHECK_NOT_REEVALUATED"
            : "RECORDED_REFERENCE_CHECK",
        };
      }),
    },
    uncertainty: [
      ...(report.policyFacts?.applicabilityConflicts || []).map(
        (c) =>
          "Contradictory " +
          c.field +
          " in registered obligation and regulatory context; human reconciliation required",
      ),
      ...(report.policyConfiguration
        ? []
        : [
            "Original policy configuration was not captured for this legacy evaluation",
          ]),
      ...(report.policyConfiguration?.originalConfigurationAvailable === false
        ? [
            "Original configuration unavailable; this is a reassessment under current trusted configuration",
          ]
        : []),
      ...(category === "VERIFIED_OFFICIAL_POLICY"
        ? []
        : ["Official issuer authority is not established by this evaluation"]),
    ],
    administrativeApproval: false,
    externalRelease: "NOT_CONFIRMED",
  };
}
