import { explainPolicy, loadPolicyConfiguration } from "./policy-history.js";
import { paginate } from "./pagination.js";
export function policyDecisionRoute({
  db,
  c,
  action,
  method,
  url,
  json,
  res,
  audit,
  u,
  key,
  currentConfigurationSHA256,
}) {
  if (action === "policy-decisions/history" && method === "GET") {
    const page = paginate(db, {
      table: "evidence t",
      where: "t.case_id=? AND t.kind IN ('evaluation','evaluation_replay')",
      params: [c.id],
      url,
      scope: u.id + "|" + u.role + "|policy-history|" + c.id,
      key,
      descending: true,
      defaultLimit: 20,
    });
    page.items = page.items.map((r) => {
      const p = JSON.parse(r.payload);
      return {
        id: r.id,
        kind: r.kind,
        version: p.version,
        recordedAt: r.created,
        policyVersion: p.operationalPolicy?.version || null,
        configurationBasis:
          p.policyConfiguration?.basis || "LEGACY_CONFIGURATION_NOT_CAPTURED",
      };
    });
    json(res, 200, page);
    return true;
  }
  if (action !== "policy-decisions" || method !== "GET") return false;
  const id = url.searchParams.get("evaluationId");
  if (id && !/^[a-f0-9-]{36}$/.test(id))
    throw Object.assign(Error("Invalid evaluation identity"), { status: 400 });
  const row = id
    ? db
        .prepare(
          "SELECT * FROM evidence WHERE case_id=? AND id=? AND kind IN ('evaluation','evaluation_replay')",
        )
        .get(c.id, id)
    : db
        .prepare(
          "SELECT * FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
        )
        .get(c.id);
  if (!row) throw Object.assign(Error("Evaluation not found"), { status: 404 });
  const report = JSON.parse(row.payload),
    capsule = report.policyConfiguration?.sha256
      ? loadPolicyConfiguration(db, report.policyConfiguration.sha256)
      : null;
  const explanation = explainPolicy(report, capsule?.configuration);
  const documentIds = [
    ...new Set(
      [
        report.sourceReferences?.document,
        ...(report.policyFacts?.proofs || []).map((p) => p.documentId),
      ].filter(Boolean),
    ),
  ].slice(0, 21);
  const documents = documentIds
    .map((id) =>
      db
        .prepare(
          "SELECT v.id,v.document_id,v.version,v.sha256,v.mime,v.created,d.kind FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=? AND d.case_id=?",
        )
        .get(id, c.id),
    )
    .filter(Boolean);
  const extraction = report.sourceReferences?.extraction
    ? db
        .prepare(
          "SELECT id,payload FROM evidence WHERE id=? AND case_id=? AND kind='extraction'",
        )
        .get(report.sourceReferences.extraction, c.id)
    : null;
  const fieldReferences = extraction
    ? Object.fromEntries(
        Object.entries(JSON.parse(extraction.payload).fields || {}).map(
          ([field, value]) => [
            field,
            {
              documentVersionId: report.sourceReferences.document || null,
              extractionId: extraction.id,
              value: value.value ?? null,
              rawValue: value.rawValue ?? null,
              page: value.page ?? null,
              bbox: value.bbox ?? null,
              method: value.method || null,
              engineConfidence: value.engineConfidence ?? null,
              confidenceCalibration:
                value.confidenceCalibration || "uncalibrated",
            },
          ],
        ),
      )
    : {};
  audit(u.id, "policy_decision_inspected", c.id, {
    evaluationId: row.id,
    configurationSHA256: capsule?.sha256 || null,
  });
  json(res, 200, {
    evaluationId: row.id,
    evaluationVersion: report.version,
    recordedAt: row.created,
    historicalReplay: Boolean(report.isHistoricalReplay),
    financialAssessmentAsOf: report.financialAssessmentAsOf || report.asOf,
    configuration: report.policyConfiguration
      ? {
          ...report.policyConfiguration,
          matchesCurrentConfiguration: currentConfigurationSHA256
            ? report.policyConfiguration.sha256 === currentConfigurationSHA256
            : null,
        }
      : {
          basis: "LEGACY_CONFIGURATION_NOT_CAPTURED",
          originalConfigurationAvailable: false,
          matchesCurrentConfiguration: null,
        },
    explanation,
    facts: report.policyFacts || {
      instrument: report.sources?.instrument || {},
      context: null,
      proofs: [],
    },
    documents,
    extractionReference: extraction
      ? {
          id: extraction.id,
          documentVersionId: report.sourceReferences.document || null,
        }
      : null,
    fieldReferences,
  });
  return true;
}
