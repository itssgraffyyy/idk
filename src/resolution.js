import { comparable } from "./engine.js";
export function resolutionDelta(previous, current) {
  const old = previous?.sources || {},
    next = current.sources || {};
  const changedFacts = [];
  for (const source of ["instrument", "obligation", "extraction", "external"]) {
    const a = old[source] || {},
      b = next[source] || {};
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (JSON.stringify(a[field]) !== JSON.stringify(b[field]))
        changedFacts.push({
          source,
          field,
          before: a[field] ?? null,
          after: b[field] ?? null,
        });
  }
  if (old.documentId !== next.documentId)
    changedFacts.push({
      source: "document",
      field: "version",
      before: old.documentId ?? null,
      after: next.documentId ?? null,
    });
  const prior = new Map((previous?.findings || []).map((f) => [f.code, f])),
    currentCodes = new Set(current.findings.map((f) => f.code));
  const changes = {
    resolved: [...prior.keys()].filter((k) => !currentCodes.has(k)),
    introduced: current.findings
      .filter((f) => !prior.has(f.code))
      .map((f) => f.code),
    outstanding: current.findings
      .filter((f) => prior.has(f.code))
      .map((f) => f.code),
    changed: current.findings
      .filter(
        (f) =>
          prior.has(f.code) &&
          JSON.stringify(f.sources) !==
            JSON.stringify(prior.get(f.code).sources),
      )
      .map((f) => f.code),
  };
  return {
    changedFacts,
    changes,
    dependencies: current.findings.map((f) => ({
      findingCode: f.code,
      evaluationVersion: current.version,
      ruleId: f.policyRule || null,
      sources: f.sources.map((s) => ({
        type: s.type,
        field: s.field ?? null,
        evidenceId: s.evidenceId ?? null,
        extractionId: s.extractionId ?? null,
      })),
    })),
    independentVerificationRequired: current.findings
      .filter((f) =>
        (f.missingEvidence || []).some((e) =>
          /independent|issuer_verified|provider_/.test(e),
        ),
      )
      .map((f) => f.code),
    recommendedAction: changes.introduced.length
      ? "Review newly introduced discrepancies"
      : changes.outstanding.length
        ? "Review outstanding evidence and request targeted clarification"
        : "Record an authorized review; evidence matching alone is not administrative approval",
    strategy: "FULL_RECOMPUTATION_SAFE_FALLBACK",
    administrativeApproval: false,
  };
}
export function recordResolution(db, caseId, id, previous, current) {
  const payload = resolutionDelta(previous?.payload, current);
  db.prepare("INSERT INTO evaluation_resolutions VALUES(?,?,?,?,?)").run(
    id,
    caseId,
    previous?.id ?? null,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
  return payload;
}
export function targetedCorrection(original, values, allowedFields) {
  const result = { ...original };
  for (const [field, value] of Object.entries(values)) {
    if (!allowedFields.includes(field))
      throw Object.assign(Error("Correction field is not requested"), {
        status: 400,
      });
    result[field] = value;
  }
  return result;
}
