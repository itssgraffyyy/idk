import { randomUUID } from "node:crypto";
import { requireRole, isInstitution, isReviewer } from "./permissions.js";
const reject = (status, message) => {
  throw Object.assign(Error(message), { status });
};
export function domainSnapshot(db, caseId) {
  const link = db
    .prepare("SELECT * FROM case_domains WHERE case_id=?")
    .get(caseId);
  if (!link) return null;
  return {
    ...link,
    obligation: db
      .prepare("SELECT * FROM obligations WHERE id=?")
      .get(link.obligation_id),
    instruments: db
      .prepare(
        "SELECT i.* FROM instruments i JOIN case_instruments c ON c.instrument_id=i.id WHERE c.case_id=? ORDER BY i.id",
      )
      .all(caseId)
      .map((i) => ({ ...i, data: JSON.parse(i.data) })),
    documents: db
      .prepare("SELECT * FROM documents WHERE case_id=? ORDER BY created,id")
      .all(caseId),
  };
}
export function transition(db, user, c, body) {
  const state = db
    .prepare("SELECT * FROM case_domains WHERE case_id=?")
    .get(c.id);
  if (body.revision !== state.revision) reject(409, "Stale lifecycle revision");
  if (
    typeof body.reason !== "string" ||
    !body.reason.trim() ||
    body.reason.length > 2000
  )
    reject(400, "Reason required");
  const edges = {
    submit: ["registered", "submitted", "institution"],
    start_review: ["submitted", "under_review", "reviewer"],
    request_information: ["under_review", "needs_information", "reviewer"],
    resubmit: ["needs_information", "resubmitted", "institution"],
    resume_review: ["resubmitted", "under_review", "reviewer"],
    record_review: ["under_review", "review_recorded", "reviewer"],
  };
  const edge = edges[body.action];
  if (!edge) reject(400, "Unsupported Phase 1 transition");
  if (edge[2] === "institution" ? !isInstitution(user) : !isReviewer(user))
    reject(403, "Transition permission denied");
  if (state.status !== edge[0]) reject(409, "Invalid lifecycle transition");
  db.prepare(
    "UPDATE case_domains SET status=?,revision=revision+1 WHERE case_id=? AND revision=?",
  ).run(edge[1], c.id, state.revision);
  return { before: state.status, after: edge[1], reason: body.reason };
}
export function assignOfficer(db, user, c, body) {
  requireRole(user, ["supervisor"]);
  const officer = db
    .prepare(
      "SELECT * FROM users WHERE id=? AND role='officer' AND status='active' AND tenant=?",
    )
    .get(body.officerId, user.tenant);
  if (!officer) reject(400, "Active officer in the same authority required");
  if (body.revision !== c.revision) reject(409, "Stale assignment revision");
  if (typeof body.reason !== "string" || !body.reason.trim())
    reject(400, "Reason required");
  db.prepare(
    "UPDATE cases SET assigned=?,revision=revision+1 WHERE id=? AND revision=?",
  ).run(officer.id, c.id, c.revision);
  return { before: c.assigned, after: officer.id, reason: body.reason };
}
export function prepareDocument(db, c, body) {
  let doc;
  if (body.documentId) {
    doc = db
      .prepare("SELECT * FROM documents WHERE id=? AND case_id=?")
      .get(body.documentId, c.id);
    if (!doc) reject(404, "Logical document not found");
  } else {
    const kind = body.kind || "fdr";
    if (!["fdr", "proof", "other"].includes(kind))
      reject(400, "Invalid document kind");
    doc =
      kind === "fdr"
        ? db
            .prepare(
              "SELECT * FROM documents WHERE case_id=? AND kind='fdr' ORDER BY created,id LIMIT 1",
            )
            .get(c.id)
        : null;
    if (!doc) {
      doc = { id: randomUUID(), kind };
      db.prepare("INSERT INTO documents VALUES(?,?,?,?,?)").run(
        doc.id,
        c.id,
        kind,
        String(body.title || kind).slice(0, 150),
        new Date().toISOString(),
      );
    }
  }
  return {
    logicalDocumentId: doc.id,
    documentKind: doc.kind,
    documentVersion: db
      .prepare(
        "SELECT coalesce(max(version),0)+1 n FROM document_versions WHERE document_id=?",
      )
      .get(doc.id).n,
  };
}
export function registerVersion(db, id, p, user) {
  db.prepare("INSERT INTO document_versions VALUES(?,?,?,?,?,?,?,?,?)").run(
    id,
    p.logicalDocumentId,
    p.documentVersion,
    p.sha256,
    p.mime,
    p.bytes,
    id,
    new Date().toISOString(),
    user.id,
  );
}
export function latestFDR(db, caseId) {
  return db
    .prepare(
      "SELECT e.* FROM evidence e JOIN document_versions v ON v.id=e.id JOIN documents d ON d.id=v.document_id WHERE d.case_id=? AND d.kind='fdr' ORDER BY e.rowid DESC LIMIT 1",
    )
    .get(caseId);
}
export function linkInstruments(db, user, c, body) {
  if (!isInstitution(user)) reject(403, "Institution role required");
  const predecessor = db
      .prepare("SELECT * FROM instruments WHERE id=? AND tenant=?")
      .get(body.predecessor, c.tenant),
    successor = db
      .prepare("SELECT * FROM instruments WHERE id=? AND tenant=?")
      .get(body.successor, c.tenant);
  if (!predecessor || !successor) reject(404, "Instrument not found");
  if (predecessor.revision !== body.revision)
    reject(409, "Stale predecessor revision");
  if (typeof body.reason !== "string" || !body.reason.trim())
    reject(400, "Relationship reason required");
  try {
    db.prepare("INSERT INTO instrument_relationships VALUES(?,?,?,?,?)").run(
      predecessor.id,
      successor.id,
      body.reason,
      user.id,
      new Date().toISOString(),
    );
  } catch {
    reject(409, "Invalid, duplicate or cyclic relationship");
  }
  db.prepare(
    "UPDATE instruments SET status='superseded',revision=revision+1 WHERE id=?",
  ).run(predecessor.id);
  return {
    predecessor: predecessor.id,
    successor: successor.id,
    reason: body.reason,
    administrativeApproval: false,
  };
}
