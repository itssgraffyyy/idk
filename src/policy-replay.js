import { evaluatePolicy } from "./policy-runtime.js";
export function replayPolicySnapshot(db, caseId, evaluationId, asOf, config) {
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
  return {
    ...original,
    version,
    asOf,
    financialAssessmentAsOf: original.financialAssessmentAsOf || original.asOf,
    operationalPolicy: evaluatePolicy(
      {
        ...original.sources.instrument,
        ...(context ? JSON.parse(context.payload) : {}),
        proofs,
      },
      { ...config, asOf },
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
}
