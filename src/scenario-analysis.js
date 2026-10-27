import { analyzeContinuity } from "./continuity.js";
import { validate } from "./engine.js";
import { date } from "./administration.js";
import { evaluatePolicy } from "./policy-runtime.js";
import { clearanceReadiness, snapshotHash } from "./clearance-procedure.js";
import { currentEvidence, currentProofs } from "./current-evidence.js";
const bad = (message) => {
  throw Object.assign(Error(message), { status: 400 });
};
const exact = (v, keys) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    bad("Unsupported scenario fields");
};
const validated = (value) => {
  try {
    return validate(value);
  } catch (e) {
    bad(e.message);
  }
};
const money = (v) => {
  if (!Number.isSafeInteger(v) || v <= 0)
    bad("Positive safe integer paise required");
  return v;
};
export function scenarioSnapshot(db, c, capsule, clearances, user) {
  const domain = db
    .prepare("SELECT * FROM case_domains WHERE case_id=?")
    .get(c.id);
  const obligation = db
    .prepare("SELECT * FROM obligations WHERE id=?")
    .get(domain.obligation_id);
  const instruments = db
    .prepare(
      "SELECT i.* FROM instruments i JOIN case_instruments ci ON ci.instrument_id=i.id WHERE ci.case_id=? ORDER BY i.id LIMIT 501",
    )
    .all(c.id);
  if (instruments.length > 500) bad("At most 500 instruments supported");
  const documents = db
    .prepare(
      "SELECT v.id,v.document_id,v.version,v.sha256,d.kind FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE d.case_id=? AND v.version=(SELECT max(x.version) FROM document_versions x WHERE x.document_id=d.id) ORDER BY v.id LIMIT 501",
    )
    .all(c.id);
  if (documents.length > 500) bad("At most 500 current documents supported");
  const evidence = currentEvidence(db, c.id);
  const evaluation = evidence.find((e) => e.kind === "evaluation");
  const context = evidence.find((e) => e.kind === "regulatory_context");
  const regulatory = context?.payload.context || {};
  const factConflicts = [];
  if (
    obligation.programme &&
    regulatory.programme &&
    obligation.programme !== regulatory.programme
  )
    factConflicts.push({
      field: "programme",
      obligation: obligation.programme,
      regulatory: regulatory.programme,
    });
  const binding = db
    .prepare(
      "SELECT * FROM clearance_events WHERE case_id=? AND kind='binding' ORDER BY revision DESC LIMIT 1",
    )
    .get(c.id);
  const readiness = clearances.readiness(user, c.id);
  const procedure = binding ? JSON.parse(binding.payload).procedure : null;
  return JSON.parse(
    JSON.stringify({
      format: 1,
      asOf: new Date().toISOString().slice(0, 10),
      classification: "HYPOTHETICAL_ANALYSIS_ONLY",
      caseId: c.id,
      caseRevision: c.revision,
      inputRevision: db
        .prepare("SELECT input_revision FROM case_operations WHERE case_id=?")
        .get(c.id).input_revision,
      domain,
      obligation,
      instruments: instruments.map((r) => ({
        ...r,
        data: JSON.parse(r.data),
        proposed: !!db
          .prepare(
            "SELECT 1 FROM continuity_events p WHERE p.case_id=? AND p.successor=? AND p.kind='proposed' AND NOT EXISTS(SELECT 1 FROM continuity_events r WHERE r.successor=p.successor AND r.kind='registered')",
          )
          .get(c.id, r.id),
      })),
      documents,
      evidenceReferences: evidence.map((e) => ({
        id: e.id,
        kind: e.kind,
        sha256: snapshotHash(e.payload),
      })),
      evaluationId: evaluation?.id || null,
      factConflicts,
      policyFacts: {
        context: {
          ...regulatory,
          ...(obligation.programme ? { programme: obligation.programme } : {}),
        },
        proofs: currentProofs(db, c.id, context?.id),
      },
      capsule,
      clearance: {
        procedure,
        confirmations: readiness.procedureTrust?.candidates || [],
        readiness,
        responses: (readiness.requests || []).map((r) => ({
          requirementId: r.payload.requirementId,
          status: r.payload.status,
          current:
            readiness.snapshot?.requests?.find((v) => v.id === r.id)
              ?.authorizedCurrent === true,
        })),
      },
    }),
  );
}
function evaluateScenario(snapshot, changes) {
  exact(changes, [
    "asOf",
    "starts",
    "ends",
    "amountPaise",
    "updates",
    "add",
    "remove",
    "policyVersion",
    "clearances",
  ]);
  const asOf = date(changes.asOf),
    starts = date(changes.starts || snapshot.obligation.starts),
    ends = date(changes.ends || snapshot.obligation.ends);
  const amountPaise = money(
    changes.amountPaise ?? snapshot.obligation.amount_paise,
  );
  const rows = structuredClone(snapshot.instruments),
    assumptions = [],
    seen = new Set();
  for (const key of ["updates", "add", "remove", "clearances"])
    if (
      changes[key] !== undefined &&
      (!Array.isArray(changes[key]) || changes[key].length > 100)
    )
      bad("At most 100 changes per category");
  for (const id of changes.remove || []) {
    if (
      typeof id !== "string" ||
      seen.has(id) ||
      !rows.some((r) => r.id === id)
    )
      bad("Unknown or duplicate removed instrument");
    seen.add(id);
    rows.splice(
      rows.findIndex((r) => r.id === id),
      1,
    );
  }
  for (const update of changes.updates || []) {
    exact(update, ["id", "amountPaise", "issued", "matures", "currency"]);
    const r = rows.find((r) => r.id === update.id);
    if (!r || seen.has(update.id))
      bad("Unknown or repeated updated instrument");
    seen.add(update.id);
    const { id, ...patch } = update;
    r.data = validated({ ...r.data, ...patch });
    assumptions.push(
      "Changed declared instrument " + id + "; no bank confirmation.",
    );
  }
  for (const [i, addition] of (changes.add || []).entries()) {
    const data = validated(addition);
    if (Object.keys(addition).some((k) => !Object.hasOwn(data, k)))
      bad("Unsupported added instrument metadata");
    rows.push({ id: "hypothetical-" + i, data, proposed: false });
    assumptions.push(
      "Hypothetical new instrument " +
        i +
        " is assumed available only for this analysis.",
    );
  }
  // Currency is never inferred. Legacy records without it remain incomplete.
  let continuity;
  try {
    continuity = analyzeContinuity({
      starts,
      ends,
      amountPaise,
      instruments: rows,
    });
  } catch (e) {
    bad(e.message);
  }
  const primary = rows.find((r) => r.id === snapshot.domain.instrument_id);
  const config = structuredClone(snapshot.capsule.configuration);
  if (changes.policyVersion !== undefined) {
    if (
      typeof changes.policyVersion !== "string" ||
      !config.policies.some((p) => p.version === changes.policyVersion)
    )
      bad("Policy version is not in the pinned server configuration");
    config.policies = config.policies.filter(
      (p) => p.version === changes.policyVersion,
    );
    assumptions.push(
      "Selected pinned policy version " +
        changes.policyVersion +
        "; original effective period and trust gates retained.",
    );
  }
  const facts = {
    ...(snapshot.policyFacts.context || {}),
    ...(primary?.data || {}),
    instrumentType: primary?.data.type ?? null,
    proofs: snapshot.policyFacts.proofs || [],
  };
  const policy = evaluatePolicy(facts, { ...config, asOf });
  if (snapshot.factConflicts?.length) {
    policy.outcome = "NEEDS_HUMAN_REVIEW";
    policy.reason = "Conflicting recorded applicability facts";
  }
  const clearance = structuredClone(snapshot.clearance);
  const changedRequirements = new Set();
  for (const item of changes.clearances || []) {
    exact(item, ["requirementId", "status"]);
    if (
      !clearance.procedure?.requirements.some(
        (r) => r.id === item.requirementId,
      ) ||
      changedRequirements.has(item.requirementId) ||
      !["accepted", "rejected", "pending", "withdrawn"].includes(item.status)
    )
      bad("Unknown, duplicate or unsupported hypothetical clearance");
    changedRequirements.add(item.requirementId);
    clearance.responses = clearance.responses.filter(
      (r) => r.requirementId !== item.requirementId,
    );
    clearance.responses.push({ ...item, current: true });
    assumptions.push(
      "Assumed department " +
        item.requirementId +
        " " +
        item.status +
        "; no actual response or grant changed.",
    );
  }
  const clearanceResult = clearance.procedure
    ? clearanceReadiness({
        procedure: clearance.procedure,
        confirmations: clearance.confirmations || [],
        facts,
        responses: clearance.responses,
        asOf,
        currentBinding: !clearance.readiness.blockers?.some(
          (b) => b.code === "STALE_PROCEDURE_BINDING",
        ),
      })
    : {
        readyForInternalReview: false,
        blockers: [{ code: "PROCEDURE_NOT_BOUND" }],
      };
  const missingEvidence = [];
  if (!snapshot.documents.some((d) => d.kind === "fdr"))
    missingEvidence.push("SOURCE_FDR_DOCUMENT");
  if (!snapshot.evidenceReferences.some((e) => e.kind === "extraction"))
    missingEvidence.push("CURRENT_EXTRACTION");
  if (!primary) missingEvidence.push("PRIMARY_INSTRUMENT_REMOVED");
  return {
    format: 1,
    classification: "HYPOTHETICAL_NOT_APPROVAL_OR_BANK_CONFIRMATION",
    asOf,
    changes: structuredClone(changes),
    continuity,
    policy,
    clearance: clearanceResult,
    missingEvidence,
    factConflicts: snapshot.factConflicts || [],
    recordedAdministrativeBlockers: clearance.readiness.blockers || [],
    policyConfigurationSHA256: snapshot.capsule.sha256,
    assumptions: [
      ...assumptions,
      "Declared dates are inclusive; no pooling of distinct deposits.",
      "Existing proposed instruments stay excluded until actually registered.",
      "Unchanged missing documents, proof decisions and administrative blockers remain unresolved.",
      "Results cannot authorize release, modify evidence or establish legal sufficiency.",
    ],
    administrativeApproval: false,
    bankRelease: false,
  };
}
export function runScenario(snapshot, changes) {
  const result = evaluateScenario(snapshot, changes);
  const baseline = evaluateScenario(snapshot, {
    asOf: snapshot.asOf || changes.asOf,
    starts: snapshot.obligation.starts || changes.starts,
    ends: snapshot.obligation.ends || changes.ends,
  });
  return {
    ...result,
    baseline: {
      asOf: baseline.asOf,
      continuity: baseline.continuity,
      policy: baseline.policy,
      clearance: baseline.clearance,
      missingEvidence: baseline.missingEvidence,
    },
    comparisonAssumption:
      "If the recorded obligation has no period, baseline uses the hypothetical period; baseline does not infer a legal holding period.",
  };
}
