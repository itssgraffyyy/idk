import { createHash } from "node:crypto";

const id = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const validId = (v) => typeof v === "string" && id.test(v);
const fields = new Set([
  "programme",
  "institutionType",
  "government",
  "propertyOwned",
  "purpose",
  "instrumentType",
  "currency",
  "ownership",
  "entity",
  "property",
  "application",
]);
const plain = (v) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
const reject = (message) => {
  throw Object.assign(Error(message), { status: 400 });
};
const exact = (v, keys) =>
  plain(v) && Object.keys(v).every((k) => keys.includes(k));
const date = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (plain(value))
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  if (
    value === undefined ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw Error("Invalid canonical value");
  return JSON.stringify(value);
}
export const snapshotHash = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export function validateProcedure(input) {
  if (
    !exact(input, [
      "version",
      "scope",
      "classification",
      "source",
      "effectiveFrom",
      "effectiveTo",
      "requirements",
    ]) ||
    !validId(input.version) ||
    !validId(input.scope) ||
    !["SYNTHETIC", "UNVERIFIED_OFFICIAL"].includes(input.classification) ||
    typeof input.source !== "string" ||
    !input.source.trim() ||
    input.source.length > 2000 ||
    !date(input.effectiveFrom) ||
    !date(input.effectiveTo) ||
    input.effectiveFrom > input.effectiveTo ||
    !Array.isArray(input.requirements) ||
    !input.requirements.length ||
    input.requirements.length > 50
  )
    reject("Invalid versioned clearance procedure");
  const ids = new Set();
  for (const r of input.requirements) {
    if (
      !exact(r, [
        "id",
        "label",
        "department",
        "mandatory",
        "dependsOn",
        "conditions",
        "evidenceKinds",
      ]) ||
      !validId(r.id) ||
      ids.has(r.id) ||
      !validId(r.department) ||
      typeof r.label !== "string" ||
      !r.label.trim() ||
      r.label.length > 200 ||
      typeof r.mandatory !== "boolean" ||
      !Array.isArray(r.dependsOn) ||
      r.dependsOn.length > 50 ||
      r.dependsOn.some((v) => !validId(v)) ||
      new Set(r.dependsOn).size !== r.dependsOn.length ||
      !Array.isArray(r.evidenceKinds) ||
      r.evidenceKinds.length > 10 ||
      new Set(r.evidenceKinds).size !== r.evidenceKinds.length ||
      r.evidenceKinds.some(
        (k) => !["FDR", "SUPPORTING", "PROOF"].includes(k),
      ) ||
      !plain(r.conditions) ||
      Object.keys(r.conditions).length > fields.size
    )
      reject("Invalid clearance requirement");
    for (const [key, value] of Object.entries(r.conditions))
      if (
        !fields.has(key) ||
        !["string", "boolean"].includes(typeof value) ||
        (typeof value === "string" && (!value.trim() || value.length > 200))
      )
        reject("Unsupported clearance applicability condition");
    ids.add(r.id);
  }
  const nodes = new Map(input.requirements.map((r) => [r.id, r])),
    done = new Set(),
    visiting = new Set();
  const visit = (key) => {
    if (done.has(key)) return;
    if (visiting.has(key)) reject("Circular clearance dependency");
    const r = nodes.get(key);
    if (!r) reject("Unknown clearance prerequisite");
    visiting.add(key);
    r.dependsOn.forEach(visit);
    visiting.delete(key);
    done.add(key);
  };
  nodes.forEach((_, key) => visit(key));
  return structuredClone(input);
}

// Only current, server-authorized response facts may enter this pure evaluator.
// It never authenticates a department, financial issuer or regulatory source.
export function clearanceReadiness({
  procedure,
  facts = {},
  responses = [],
  asOf,
  currentBinding = true,
}) {
  const p = validateProcedure(procedure);
  if (!date(asOf)) reject("A valid assessment date is required");
  if (!plain(facts) || !Array.isArray(responses) || responses.length > 50)
    reject("Invalid clearance assessment facts");
  const seen = new Set();
  for (const r of responses) {
    if (
      !plain(r) ||
      !p.requirements.some((n) => n.id === r.requirementId) ||
      seen.has(r.requirementId) ||
      !["accepted", "rejected", "withdrawn", "pending"].includes(r.status) ||
      typeof r.current !== "boolean"
    )
      reject("Invalid or duplicate current clearance response");
    seen.add(r.requirementId);
  }
  const rows = new Map(),
    requirements = new Map(p.requirements.map((r) => [r.id, r]));
  function assess(key) {
    if (rows.has(key)) return rows.get(key);
    const r = requirements.get(key),
      reasons = [],
      missingFacts = [];
    let mismatched = false;
    for (const [field, expected] of Object.entries(r.conditions)) {
      if (
        !Object.hasOwn(facts, field) ||
        facts[field] === null ||
        facts[field] === undefined
      )
        missingFacts.push(field);
      else if (facts[field] !== expected) mismatched = true;
    }
    let status;
    if (mismatched) status = "NOT_APPLICABLE";
    else if (missingFacts.length) {
      status = "REVIEW_APPLICABILITY";
      reasons.push("Missing applicability facts: " + missingFacts.join(", "));
    } else {
      const dependencies = r.dependsOn.map(assess),
        blocked = dependencies.filter(
          (d) => !["ACCEPTED", "NOT_APPLICABLE"].includes(d.status),
        );
      const response = responses.find((v) => v.requirementId === key);
      if (blocked.length) {
        status = "BLOCKED_PREREQUISITE";
        reasons.push(...blocked.map((d) => "Unresolved prerequisite: " + d.id));
      } else if (!response) {
        status = "NOT_REQUESTED";
        reasons.push("Department request required");
      } else if (!response.current) {
        status = "STALE";
        reasons.push("Source, reviewer grant or request version changed");
      } else {
        status = response.status.toUpperCase();
        if (status !== "ACCEPTED")
          reasons.push("Department response: " + response.status);
      }
    }
    const row = {
      id: key,
      label: r.label,
      department: r.department,
      mandatory: r.mandatory,
      status,
      missingFacts,
      reasons,
      evidenceKinds: r.evidenceKinds,
      dependsOn: r.dependsOn,
    };
    rows.set(key, row);
    return row;
  }
  const items = p.requirements.map((r) => assess(r.id));
  const blockers = items
    .filter(
      (r) => r.mandatory && !["ACCEPTED", "NOT_APPLICABLE"].includes(r.status),
    )
    .map((r) => ({
      requirementId: r.id,
      department: r.department,
      code: r.status,
      reasons: r.reasons,
    }));
  if (asOf < p.effectiveFrom || asOf > p.effectiveTo)
    blockers.push({ code: "PROCEDURE_OUTSIDE_EFFECTIVE_PERIOD" });
  if (!currentBinding) blockers.push({ code: "STALE_PROCEDURE_BINDING" });
  if (p.classification !== "SYNTHETIC")
    blockers.push({ code: "OFFICIAL_PROCEDURE_UNVERIFIED" });
  return {
    procedureVersion: p.version,
    procedureHash: snapshotHash(p),
    classification: p.classification,
    asOf,
    items,
    blockers,
    readyForInternalReview: blockers.length === 0,
    administrativeApproval: false,
    externalRelease: "NOT_CONFIRMED",
    realRegulatoryAuthority: false,
  };
}
