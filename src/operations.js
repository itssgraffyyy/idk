import { randomUUID } from "node:crypto";
import { isInstitution, isReviewer } from "./permissions.js";
import { currentEvidence } from "./current-evidence.js";
import { validate, evidenceFields } from "./engine.js";
const bad = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const now = () => new Date().toISOString();
export function notifyCase(db, c, key, category, message, audience = "both") {
  const recipients = db
    .prepare(
      "SELECT id FROM users WHERE status='active' AND ((tenant=? AND role IN ('institution','institution_admin') AND ?!='reviewer') OR (id=? AND ?!='institution'))",
    )
    .all(c.tenant, audience, c.assigned, audience);
  for (const u of recipients)
    db.prepare(
      "INSERT OR IGNORE INTO case_notifications VALUES(?,?,?,?,?,?,?,NULL)",
    ).run(randomUUID(), u.id, c.id, category, key, message, now());
}
export function readiness(db, c) {
  const h = currentEvidence(db, c.id),
    last = (k) => h.find((e) => e.kind === k),
    document = last("document"),
    extraction = last("extraction"),
    report = last("evaluation")?.payload;
  const blockers = [],
    warnings = [];
  try {
    validate(JSON.parse(c.instrument));
  } catch (e) {
    blockers.push({ code: "invalid_declaration", message: e.message });
  }
  if (!document)
    blockers.push({
      code: "missing_document",
      message: "Upload the instrument document before submission",
    });
  if (
    document &&
    (!extraction ||
      extraction.payload.documentId !== document.id ||
      extraction.payload.status !== "completed")
  )
    warnings.push({
      code: "extraction_unavailable",
      message: "Document extraction is incomplete; manual review is required",
    });
  for (const finding of report?.findings || [])
    warnings.push({
      code: finding.code,
      message: finding.message || finding.title || finding.code,
      severity: finding.severity,
      sourceReferences: finding.sources,
    });
  return {
    outcome: blockers.length
      ? "CANNOT_SUBMIT"
      : warnings.length
        ? "POSSIBLE_WITH_REVIEW_WARNINGS"
        : "READY_FOR_SUBMISSION",
    blockers,
    warnings,
    documentVersionId: document?.id ?? null,
    evaluationId: last("evaluation")?.id ?? null,
    regulatoryAuthority:
      report?.operationalPolicy?.realRegulatoryAuthority === true
        ? "ISSUER_VERIFIED"
        : "UNVERIFIED",
    administrativeApproval: false,
  };
}
export function operationSnapshot(db, c) {
  const state = db
      .prepare("SELECT * FROM case_operations WHERE case_id=?")
      .get(c.id),
    h = currentEvidence(db, c.id),
    last = (k) => h.find((e) => e.kind === k);
  const row = db
    .prepare(
      "SELECT payload FROM evaluation_resolutions WHERE case_id=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(c.id);
  return {
    ...state,
    dimensions: {
      submission: state.stage === "draft" ? "DRAFT" : "SUBMITTED",
      processing:
        db
          .prepare(
            "SELECT status FROM jobs WHERE case_id=? ORDER BY rowid DESC LIMIT 1",
          )
          .get(c.id)?.status || "NOT_STARTED",
      financial:
        last("external")?.payload.productionVerification || "UNCONFIRMED",
      regulatory:
        last("evaluation")?.payload.operationalPolicy?.outcome ||
        "UNVERIFIED_POLICY",
      administrative: state.stage,
      clearance: db
        .prepare(
          "SELECT 1 FROM clearance_events WHERE case_id=? AND kind='binding' LIMIT 1",
        )
        .get(c.id)
        ? "SEE_CURRENT_CLEARANCE_READINESS"
        : "NOT_INITIATED",
      release: db
        .prepare(
          "SELECT 1 FROM clearance_events WHERE case_id=? AND kind='proposal' AND action='confirmed' LIMIT 1",
        )
        .get(c.id)
        ? "INTERNAL_DECISION_RECORDED_BANK_UNCONFIRMED"
        : "NOT_REQUESTED",
    },
    needsReview: state.reviewed_input_revision !== state.input_revision,
    resolution: row ? JSON.parse(row.payload) : null,
    readiness: readiness(db, c),
    clarifications: db
      .prepare(
        "SELECT * FROM structured_clarifications WHERE case_id=? ORDER BY rowid DESC LIMIT 50",
      )
      .all(c.id)
      .map((r) => ({
        ...r,
        fields: JSON.parse(r.fields),
        documents: JSON.parse(r.documents),
      })),
    nextAction:
      state.stage === "awaiting_response"
        ? "Institution: respond to the targeted clarification"
        : state.stage === "draft"
          ? "Institution: upload, confirm and submit evidence"
          : "Assigned reviewer: inspect evidence and readiness; record an authorized next step",
  };
}
export function moveOperation(db, u, c, body) {
  const s = db
    .prepare("SELECT * FROM case_operations WHERE case_id=?")
    .get(c.id);
  if (body.revision !== s.revision || body.inputRevision !== s.input_revision)
    bad(409, "Workflow or evidence changed; reload");
  if (typeof body.reason !== "string" || !body.reason.trim())
    bad(400, "Transition reason required");
  const edges = {
    submit: [["draft"], "submitted", "institution"],
    intake: [["submitted"], "intake_validation", "reviewer"],
    ready: [
      ["intake_validation", "response_received", "reevaluation_required"],
      "ready_for_review",
      "reviewer",
    ],
    review: [["ready_for_review"], "under_review", "reviewer"],
    clarify: [["under_review"], "awaiting_response", "reviewer"],
    response: [["awaiting_response"], "response_received", "institution"],
    reevaluate: [
      [
        "response_received",
        "under_review",
        "pending_clearance",
        "ready_for_decision",
        "decision_recorded",
      ],
      "reevaluation_required",
      "reviewer",
    ],
    clearance: [["under_review"], "pending_clearance", "reviewer"],
  };
  const edge = edges[body.action];
  if (!edge) bad(400, "Unsupported operational transition");
  if (edge[2] === "institution" ? !isInstitution(u) : !isReviewer(u))
    bad(403, "Operational permission denied");
  if (!edge[0].includes(s.stage))
    bad(409, "Operational transition is not available from this stage");
  if (body.action === "submit" && readiness(db, c).blockers.length)
    bad(409, "Submission readiness has blocking errors");
  if (["ready", "review"].includes(body.action)) {
    const report = db
      .prepare(
        "SELECT payload FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
      )
      .get(c.id);
    if (
      !report ||
      JSON.parse(report.payload).inputRevision !== s.input_revision
    )
      bad(409, "Re-evaluate current evidence before advancing review");
    if (
      db
        .prepare(
          "SELECT 1 FROM structured_clarifications WHERE case_id=? AND status IN ('open','reopened')",
        )
        .get(c.id)
    )
      bad(409, "An institution response remains outstanding");
  }
  if (
    body.action === "clarify" &&
    !db
      .prepare(
        "SELECT 1 FROM structured_clarifications WHERE case_id=? AND status IN ('open','reopened')",
      )
      .get(c.id)
  )
    bad(409, "Create a targeted clarification before requesting a response");
  if (
    body.action === "response" &&
    !db
      .prepare(
        "SELECT 1 FROM structured_clarifications WHERE case_id=? AND status='responded'",
      )
      .get(c.id)
  )
    bad(409, "Record a clarification response first");
  db.prepare(
    "UPDATE case_operations SET stage=?,revision=revision+1,reviewed_input_revision=?,updated=? WHERE case_id=?",
  ).run(
    edge[1],
    ["ready", "review"].includes(body.action)
      ? s.input_revision
      : s.reviewed_input_revision,
    now(),
    c.id,
  );
  return {
    before: s.stage,
    after: edge[1],
    reason: body.reason,
    inputRevision: s.input_revision,
    acknowledgement:
      body.action === "submit"
        ? {
            caseId: c.id,
            submittedAt: now(),
            documentVersionId: readiness(db, c).documentVersionId,
          }
        : null,
  };
}
export function clarificationTemplate(finding) {
  return {
    findingCode: finding.code,
    fields: [
      ...new Set(
        (finding.sources || [])
          .map((s) => s.field)
          .filter((f) => evidenceFields.includes(f)),
      ),
    ],
    documents: [
      ...new Set(
        (finding.sources || [])
          .filter((s) => s.type === "document")
          .map((s) => s.evidenceId)
          .filter(Boolean),
      ),
    ],
    text:
      "Please review " +
      finding.code.replaceAll("_", " ") +
      ". Compare the referenced evidence and correct the disputed fields or provide supporting documents. " +
      (finding.suggestedAction || "Uncertainty remains until reviewed."),
  };
}
