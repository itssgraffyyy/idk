// Policies are trusted application configuration, never uploaded executable code.
export const registry = {
  version: "unverified-1",
  source: null,
  verification: "unverified",
  rules: [],
};
export function assessPolicy(
  facts,
  { asOf, policies = [registry], scope = "aicte" } = {},
) {
  const matching = policies.filter(
    (p) =>
      p.scope === scope && p.effectiveFrom <= asOf && p.effectiveTo >= asOf,
  );
  if (!matching.length)
    return {
      version: "unverified-1",
      status: "unconfirmed",
      checks: [
        {
          id: "policy_unverified",
          status: "unresolved",
          explanation:
            "No verified policy applicable to the supplied date and scope.",
        },
      ],
    };
  const p = matching.sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  )[0];
  if (p.verification !== "verified" || !p.source || !p.reviewReference)
    return {
      version: p.version,
      status: "unconfirmed",
      checks: [
        {
          id: "policy_unverified",
          status: "unresolved",
          explanation:
            "Policy source and authorized validation are incomplete.",
        },
      ],
    };
  const checks = p.rules.map((r) => {
    const base = { id: r.id, source: p.source, policyVersion: p.version };
    if (!["minimum_amount", "exemption"].includes(r.type))
      return {
        ...base,
        status: "unresolved",
        explanation: "Unsupported rule type; review required.",
      };
    if (r.type === "exemption") {
      const proof = facts.proofs?.find(
        (x) => x.type === r.proofType && x.verified && x.evidenceId,
      );
      return {
        ...base,
        status: proof ? "supported" : "unresolved",
        explanation: proof
          ? "Exemption condition supported by referenced evidence; authorized review required."
          : "Exemption proof missing or unverified.",
        evidenceId: proof?.evidenceId ?? null,
      };
    }
    if (
      !Number.isSafeInteger(r.amountPaise) ||
      !Number.isSafeInteger(facts.amountPaise)
    )
      return {
        ...base,
        status: "unresolved",
        explanation: "Financial inputs unavailable or invalid.",
      };
    return {
      ...base,
      status: facts.amountPaise >= r.amountPaise ? "supported" : "review",
      explanation:
        "Declared amount compared with the configured policy threshold.",
    };
  });
  return { version: p.version, status: "human_review_required", checks };
}
