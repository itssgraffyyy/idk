import { evaluatePolicy } from "./policy-runtime.js";
import {
  attachPolicyContext,
  loadPolicyConfiguration,
} from "./policy-history.js";
export function replayPolicySnapshot(
  db,
  caseId,
  evaluationId,
  asOf,
  config = {},
) {
  if (
    typeof asOf !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(Date.parse(asOf)) ||
    new Date(asOf).toISOString().slice(0, 10) !== asOf ||
    !["recorded", "current"].includes(config.basis || "recorded")
  )
    throw Object.assign(Error("Valid policy date and replay basis required"), {
      status: 400,
    });
  const row = db
    .prepare(
      "SELECT * FROM evidence WHERE id=? AND case_id=? AND kind IN ('evaluation','evaluation_replay')",
    )
    .get(evaluationId, caseId);
  if (!row)
    throw Object.assign(Error("Evaluation snapshot not found"), {
      status: 404,
    });
  const original = JSON.parse(row.payload);
  if (!original.sources?.instrument)
    throw Object.assign(
      Error("Legacy evaluation lacks a replayable fact snapshot"),
      { status: 409 },
    );
  const refs = original.sourceReferences || {};
  const context = refs.regulatoryContext
    ? db
        .prepare(
          "SELECT payload FROM evidence WHERE id=? AND case_id=? AND kind='regulatory_context'",
        )
        .get(refs.regulatoryContext, caseId)
    : null;
  const proofIds = refs.proofReviews || [];
  if (proofIds.length > 20)
    throw Object.assign(Error("Unsupported legacy proof snapshot"), {
      status: 409,
    });
  const proofs = proofIds
    .map((id) =>
      db
        .prepare(
          "SELECT payload FROM evidence WHERE id=? AND case_id=? AND kind='proof_review'",
        )
        .get(id, caseId),
    )
    .filter(Boolean)
    .map((r) => JSON.parse(r.payload));
  const version =
    db
      .prepare(
        "SELECT count(*) n FROM evidence WHERE case_id=? AND kind IN ('evaluation','evaluation_replay')",
      )
      .get(caseId).n + 1;
  const recorded = original.policyConfiguration?.sha256
    ? loadPolicyConfiguration(db, original.policyConfiguration.sha256)
    : null;
  const capsule =
    (config.basis || "recorded") === "recorded" && recorded
      ? recorded
      : config.capsule || null;
  const facts = original.policyFacts || {
    instrument: original.sources.instrument,
    context: context ? JSON.parse(context.payload).context || {} : {},
    proofs,
  };
  const selected = capsule?.configuration || config;
  const result = {
    ...original,
    version,
    asOf,
    financialAssessmentAsOf: original.financialAssessmentAsOf || original.asOf,
    operationalPolicy: evaluatePolicy(
      { ...facts.instrument, ...facts.context, proofs: facts.proofs },
      { ...selected, asOf },
    ),
    findings: (original.findings || []).map((f) => ({
      ...f,
      evaluationVersion: version,
      sourceEvaluationId: row.id,
    })),
    isHistoricalReplay: true,
    replayMode: "FROZEN_FACTS_POLICY_ONLY",
    replays: row.id,
    supersedes: null,
    sourceReferences: { ...refs, replaySource: row.id },
  };
  if (capsule) {
    attachPolicyContext(
      result,
      capsule,
      facts,
      capsule.sha256 === recorded?.sha256 &&
        (config.basis || "recorded") === "recorded"
        ? "RECORDED_CONFIGURATION"
        : "CURRENT_CONFIGURATION_REASSESSMENT",
    );
    result.policyConfiguration.originalConfigurationAvailable =
      Boolean(recorded);
    if (!recorded)
      result.policyExplanation.uncertainty.push(
        "Original configuration unavailable; this is a reassessment under current trusted configuration",
      );
  }
  return result;
}
