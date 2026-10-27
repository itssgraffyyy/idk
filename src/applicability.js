import { evaluatePolicy } from "./policy-runtime.js";
const normalized = (value) =>
  typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase()
    : null;
// Resolve declared sources without silently choosing between contradictory facts.
export function resolveApplicability(registered = {}, declared = {}) {
  const context = { ...declared },
    conflicts = [];
  for (const field of ["programme", "level"]) {
    const a = normalized(registered[field]),
      b = normalized(declared[field]);
    if (a && b && a !== b) {
      conflicts.push({
        field,
        registered: registered[field],
        declared: declared[field],
        obligationId: registered.id || null,
        obligationRevision: registered.revision ?? null,
      });
      delete context[field];
    } else if (a && !b) context[field] = a;
  }
  return { context, conflicts };
}
export function evaluateApplicablePolicy(facts, config, conflicts = []) {
  const result = evaluatePolicy(facts, config);
  if (!conflicts.length) return result;
  return {
    ...result,
    outcome: "NEEDS_HUMAN_REVIEW",
    unconflictedOutcome: result.outcome,
    applicabilityConflicts: structuredClone(conflicts),
    reason:
      "Registered obligation and regulatory context contain contradictory applicability facts. " +
      (result.reason ||
        "Resolve the source records before selecting applicable conditions."),
  };
}
