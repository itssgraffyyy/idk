export function validatePolicies(policies) {
  if (!Array.isArray(policies) || policies.length > 100)
    throw Error("Invalid trusted policy configuration");
  const ids = new Set();
  for (const p of policies) {
    if (
      !p ||
      typeof p.version !== "string" ||
      ids.has(p.version) ||
      typeof p.scope !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveFrom) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveTo) ||
      p.effectiveFrom > p.effectiveTo ||
      !Array.isArray(p.rules) ||
      p.rules.length > 100
    )
      throw Error("Invalid policy version/period/rules");
    ids.add(p.version);
    const ruleIds = new Set();
    for (const r of p.rules) {
      if (typeof r.id !== "string" || ruleIds.has(r.id))
        throw Error("Duplicate/invalid rule ID");
      ruleIds.add(r.id);
      if (
        r.type === "minimum_amount" &&
        (!Number.isSafeInteger(r.amountPaise) || r.amountPaise < 0)
      )
        throw Error("Invalid policy amount");
    }
  }
  for (const p of policies)
    for (const r of p.rules)
      if (
        r.severity &&
        !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(r.severity)
      )
        throw Error("Invalid severity");
  return structuredClone(policies);
}
export function evaluatePolicy(
  facts,
  { policies = [], scope = "aicte", asOf, verifiedSourceHashes = [] } = {},
) {
  const eligible = policies
    .filter(
      (p) =>
        p.scope === scope &&
        p.active !== false &&
        p.effectiveFrom <= asOf &&
        p.effectiveTo >= asOf,
    )
    .sort(
      (a, b) =>
        b.effectiveFrom.localeCompare(a.effectiveFrom) ||
        b.version.localeCompare(a.version),
    );
  if (
    eligible.length > 1 &&
    eligible[0].effectiveFrom === eligible[1].effectiveFrom
  )
    return {
      outcome: "NEEDS_HUMAN_REVIEW",
      version: null,
      checks: [],
      reason: "Ambiguous active policy versions",
      administrativeApproval: false,
    };
  const p = eligible[0];
  if (!p)
    return {
      outcome: policies.some((p) => p.scope === scope)
        ? "NOT_APPLICABLE"
        : "UNVERIFIED_POLICY",
      version: null,
      checks: [],
      administrativeApproval: false,
    };
  const synthetic = p.classification === "SYNTHETIC",
    verified =
      p.verification === "verified" &&
      p.source &&
      p.reviewReference &&
      (synthetic ||
        (p.issuerConfirmed === true &&
          verifiedSourceHashes.includes(p.sourceSHA256)));
  if (!verified)
    return {
      outcome: "UNVERIFIED_POLICY",
      version: p.version,
      checks: [],
      administrativeApproval: false,
    };
  const checks = p.rules.map((r) => {
    const base = {
      ruleId: r.id,
      policyVersion: p.version,
      source: p.source,
      sourceSHA256: p.sourceSHA256 || null,
      classification: synthetic ? "SYNTHETIC" : "ISSUER_VERIFIED",
      severity: r.severity || "MEDIUM",
      expected: r.amountPaise ?? null,
      actual: facts.amountPaise ?? null,
      evidence: [],
      missingEvidence: [],
    };
    for (const [key, value] of Object.entries(r.conditions || {})) {
      if (facts[key] === undefined)
        return {
          ...base,
          outcome: "INSUFFICIENT_EVIDENCE",
          missingEvidence: [key],
        };
      if (facts[key] !== value) return { ...base, outcome: "NOT_APPLICABLE" };
    }
    if (r.type === "minimum_amount")
      return {
        ...base,
        outcome: Number.isSafeInteger(facts.amountPaise)
          ? facts.amountPaise >= r.amountPaise
            ? "COMPLIANT"
            : "NON_COMPLIANT"
          : "INSUFFICIENT_EVIDENCE",
      };
    if (r.type === "exemption") {
      const proof = facts.proofs?.find(
        (p) =>
          p.type === r.proofType && p.decision === "accepted" && p.documentId,
      );
      return {
        ...base,
        outcome: proof ? "COMPLIANT" : "INSUFFICIENT_EVIDENCE",
        evidence: proof ? [proof.documentId] : [],
        missingEvidence: proof ? [] : [r.proofType],
        exempts: r.exempts || [],
      };
    }
    return {
      ...base,
      outcome: "NEEDS_HUMAN_REVIEW",
      reason: "Unsupported declarative rule type",
    };
  });
  const exempted = new Set(
    checks
      .filter((c) => c.exempts && c.outcome === "COMPLIANT")
      .flatMap((c) => c.exempts),
  );
  for (const c of checks)
    if (exempted.has(c.ruleId)) {
      c.outcome = "NOT_APPLICABLE";
      c.reason = "Supported explicit exemption";
    }
  const outcomes = checks.map((c) => c.outcome),
    outcome = outcomes.includes("NEEDS_HUMAN_REVIEW")
      ? "NEEDS_HUMAN_REVIEW"
      : outcomes.includes("NON_COMPLIANT")
        ? "NON_COMPLIANT"
        : outcomes.includes("INSUFFICIENT_EVIDENCE")
          ? "INSUFFICIENT_EVIDENCE"
          : outcomes.every((o) => o === "NOT_APPLICABLE")
            ? "NOT_APPLICABLE"
            : "COMPLIANT";
  return {
    version: p.version,
    outcome,
    checks,
    classification: synthetic ? "SYNTHETIC" : "ISSUER_VERIFIED",
    realRegulatoryAuthority: !synthetic,
    administrativeApproval: false,
    asOf,
  };
}
export function findingSeverity(code, status) {
  return /mismatch_|external_(amountPaise|reference|depositor|currency)|amount_shortfall|duplicate_reference|date_order/.test(
    code,
  )
    ? "HIGH"
    : code === "mock_only"
      ? "LOW"
      : status === "unresolved"
        ? "MEDIUM"
        : "LOW";
}
