import { isInstitution } from "./permissions.js";
import { intakeDocument } from "./document-intake.js";
import { extract, validate, comparable } from "./engine.js";
import { createCaseRecord } from "./registration.js";
import { prepareDocument, registerVersion } from "./domain.js";
import { moveOperation, notifyCase } from "./operations.js";
import { hash } from "./store.js";
import { recordScan, documentScan } from "./upload-scanning.js";
import { randomUUID } from "node:crypto";
const bad = (s, m) => {
  throw Object.assign(Error(m), { status: s });
};
export async function submissions({
  db,
  u,
  path,
  method,
  body,
  storage,
  scanning,
  revalidate,
  recognize,
  tx,
  evidence,
  audit,
  refresh,
  json,
  res,
}) {
  const match = path.match(
    /^\/api\/drafts\/([a-f0-9-]{36})\/(documents(?:\/[a-f0-9-]{36})?|process|readiness|submit)$/,
  );
  if (!match) return false;
  if (!isInstitution(u)) bad(403, "Institution draft permission required");
  const [, id, action] = match;
  const get = () => {
    const d = db
      .prepare(
        "SELECT * FROM submission_drafts WHERE id=? AND tenant=? AND actor=?",
      )
      .get(id, u.tenant, u.id);
    if (!d) bad(404, "Draft unavailable");
    return { ...d, payload: JSON.parse(d.payload) };
  };
  let draft = get();
  const latest = () =>
    db
      .prepare(
        "SELECT * FROM draft_documents WHERE draft_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(id);
  if (action.startsWith("documents/") && method === "GET") {
    const doc = db
      .prepare("SELECT * FROM draft_documents WHERE id=? AND draft_id=?")
      .get(action.slice(10), id);
    if (!doc) bad(404, "Draft document unavailable");
    const bytes = storage.read(doc.id);
    revalidate();
    if (hash(bytes) !== doc.sha256)
      bad(409, "Draft document integrity failure");
    res.setHeader("Content-Type", doc.mime);
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="draft-evidence"',
    );
    res.end(bytes);
    audit(u.id, "draft_document_read", null, {
      draftId: id,
      documentVersionId: doc.id,
    });
    return true;
  }
  if (action === "documents" && method === "POST") {
    if (draft.case_id) bad(409, "Submitted draft is frozen");
    const doc = await intakeDocument(storage, body, scanning);
    try {
      revalidate();
      draft = get();
      if (draft.case_id || draft.revision !== body.revision)
        bad(409, "Draft changed; reload");
      tx(() => {
        db.prepare(
          "INSERT INTO draft_documents VALUES(?,?,?,?,?,?,'uploaded',NULL,?)",
        ).run(
          doc.id,
          id,
          doc.sha256,
          doc.mime,
          doc.bytes,
          doc.id,
          new Date().toISOString(),
        );
        recordScan(db, doc.id, doc.sha256, doc.scan);
        db.prepare(
          "UPDATE submission_drafts SET payload=?,revision=revision+1,updated=? WHERE id=?",
        ).run(
          JSON.stringify({
            ...draft.payload,
            confirmedFields: [],
            confirmedDocumentId: null,
          }),
          new Date().toISOString(),
          id,
        );
        audit(u.id, "draft_document_uploaded", null, {
          draftId: id,
          documentVersionId: doc.id,
          sha256: doc.sha256,
          scanVerdict: doc.scan.verdict,
        });
      });
    } catch (e) {
      storage.remove(doc.id);
      throw e;
    }
    json(res, 201, { ...doc, revision: get().revision });
    return true;
  }
  if (action === "process" && method === "POST") {
    if (draft.case_id || draft.revision !== body.revision)
      bad(409, "Draft changed or already submitted");
    const doc = latest();
    if (!doc) bad(409, "Upload a draft document first");
    if (doc.status === "processing")
      bad(409, "Draft document is already processing");
    if (
      db
        .prepare(
          "SELECT count(*) n FROM draft_extraction_attempts WHERE document_id=?",
        )
        .get(doc.id).n >= 25
    )
      bad(
        429,
        "Draft recognition attempt limit reached; review the saved source",
      );
    if (
      db
        .prepare(
          "SELECT count(*) n FROM draft_documents WHERE status='processing'",
        )
        .get().n >= 2
    )
      bad(429, "Draft OCR capacity reached");
    db.prepare("UPDATE draft_documents SET status='processing' WHERE id=?").run(
      doc.id,
    );
    let raw;
    try {
      if (hash(storage.read(doc.id)) !== doc.sha256)
        bad(409, "Document integrity failure");
      raw = await recognize(doc);
      revalidate();
      draft = get();
      if (
        draft.case_id ||
        draft.revision !== body.revision ||
        latest()?.id !== doc.id
      ) {
        db.prepare(
          "UPDATE draft_documents SET status='superseded' WHERE id=?",
        ).run(doc.id);
        bad(409, "Draft changed during recognition");
      }
      if (hash(storage.read(doc.id)) !== doc.sha256)
        bad(409, "Document integrity changed");
      const result = {
        fields: extract(raw.text, {
          blocks: raw.blocks,
          pages: raw.pages,
          fieldAttempts: raw.fieldAttempts,
          documentVersionId: doc.id,
          processedAt: new Date().toISOString(),
        }),
        raw,
        documentId: doc.id,
        method:
          doc.mime === "text/plain" ? "text-import" : "genuine-ocr-or-pdf-text",
        status: "completed",
      };
      tx(() => {
        db.prepare("INSERT INTO draft_extraction_attempts VALUES(?,?,?,?)").run(
          randomUUID(),
          doc.id,
          JSON.stringify(result),
          new Date().toISOString(),
        );
        db.prepare(
          "UPDATE draft_documents SET status='completed',extraction=? WHERE id=?",
        ).run(JSON.stringify(result), doc.id);
        audit(u.id, "draft_document_processed", null, {
          draftId: id,
          documentVersionId: doc.id,
        });
      });
      json(res, 200, result);
    } catch (e) {
      db.prepare("INSERT INTO draft_extraction_attempts VALUES(?,?,?,?)").run(
        randomUUID(),
        doc.id,
        JSON.stringify({
          documentId: doc.id,
          raw: raw || null,
          status: "rejected_or_failed",
          error: "Recognition failed, source changed or authorization changed",
        }),
        new Date().toISOString(),
      );
      db.prepare(
        "UPDATE draft_documents SET status='failed' WHERE id=? AND status='processing'",
      ).run(doc.id);
      if (e.status) throw e;
      bad(
        503,
        "Draft recognition unavailable; saved data remains available for manual correction",
      );
    }
    return true;
  }
  if (action === "readiness" && method === "GET") {
    const doc = latest(),
      extraction = doc?.extraction ? JSON.parse(doc.extraction) : null,
      blockers = [],
      warnings = [];
    try {
      validate(draft.payload.instrument);
    } catch (e) {
      blockers.push({ code: "invalid_fields", message: e.message });
    }
    if (
      typeof draft.payload.name !== "string" ||
      !draft.payload.name.trim() ||
      !Number.isSafeInteger(draft.payload.obligation?.amountPaise) ||
      draft.payload.obligation.amountPaise <= 0
    )
      blockers.push({
        code: "missing_obligation",
        message: "Institution name and exact obligation amount required",
      });
    if (!doc)
      blockers.push({
        code: "missing_document",
        message: "Upload a source document",
      });
    for (const k of [
      "reference",
      "amountPaise",
      "bank",
      "ifsc",
      "issued",
      "matures",
    ])
      if (!draft.payload.confirmedFields?.includes(k))
        blockers.push({
          code: "unconfirmed_" + k,
          message: "Confirm " + k + " against its source",
        });
    if (doc && draft.payload.confirmedDocumentId !== doc.id)
      blockers.push({
        code: "confirmation_source_changed",
        message: "Confirm fields against the current document version",
      });
    if (doc?.status === "processing")
      blockers.push({
        code: "processing_in_progress",
        message: "Wait for the bounded recognition attempt to finish",
      });
    if (!extraction || doc?.status !== "completed")
      warnings.push({
        code: "manual_review",
        message:
          "OCR unavailable or not processed; confirm fields manually against the original",
      });
    for (const [k, f] of Object.entries(extraction?.fields || {}))
      if (
        f.requiresReview ||
        f.value === undefined ||
        comparable(k, f.value) !== comparable(k, draft.payload.instrument?.[k])
      )
        warnings.push({
          code: "review_" + k,
          message:
            "Review extracted " + k + " and its source; no silent correction",
        });
    if (
      draft.payload.instrument?.reference &&
      db
        .prepare(
          "SELECT 1 FROM instruments WHERE tenant=? AND json_extract(data,'$.reference')=? LIMIT 1",
        )
        .get(u.tenant, draft.payload.instrument.reference)
    )
      warnings.push({
        code: "related_identifier",
        message:
          "An existing instrument uses this reference; inspect related evidence",
      });
    warnings.push({
      code: "authority_unverified",
      message:
        "Submission is not bank verification or official regulatory approval",
    });
    json(res, 200, {
      outcome: blockers.length
        ? "CANNOT_SUBMIT"
        : "POSSIBLE_WITH_REVIEW_WARNINGS",
      blockers,
      warnings,
      document: doc
        ? { id: doc.id, mime: doc.mime, sha256: doc.sha256, status: doc.status }
        : null,
      extraction,
      revision: draft.revision,
    });
    return true;
  }
  if (action === "submit" && method === "POST") {
    if (draft.case_id) {
      json(res, 200, {
        id: draft.case_id,
        acknowledgement: "Previously submitted; original case preserved",
      });
      return true;
    }
    if (draft.revision !== body.revision) bad(409, "Draft changed; reload");
    const doc = latest();
    if (!doc) bad(409, "Source document required");
    for (const k of [
      "reference",
      "amountPaise",
      "bank",
      "ifsc",
      "issued",
      "matures",
    ])
      if (!draft.payload.confirmedFields?.includes(k))
        bad(409, "Confirm required financial fields before submission");
    if (draft.payload.confirmedDocumentId !== doc.id)
      bad(409, "Confirm the current source document version");
    if (doc.status === "processing")
      bad(409, "Recognition is still processing");
    if (hash(storage.read(doc.id)) !== doc.sha256)
      bad(409, "Document integrity failure");
    let caseId, result;
    tx(() => {
      caseId = createCaseRecord(db, u, draft.payload, {
        evidence,
        audit,
        refresh,
      });
      const c = db.prepare("SELECT * FROM cases WHERE id=?").get(caseId),
        p = {
          sha256: doc.sha256,
          mime: doc.mime,
          bytes: doc.bytes,
          scan: documentScan(db, doc.id, doc.sha256),
          ...prepareDocument(db, c, {}),
        };
      db.prepare("INSERT INTO evidence VALUES(?,?,'document',?,?,?)").run(
        doc.id,
        caseId,
        JSON.stringify(p),
        doc.created,
        u.id,
      );
      registerVersion(db, doc.id, p, u);
      for (const attempt of db
        .prepare(
          "SELECT * FROM draft_extraction_attempts WHERE document_id=? ORDER BY rowid",
        )
        .iterate(doc.id))
        evidence(u.id, caseId, "draft_extraction_attempt", {
          attemptId: attempt.id,
          draftId: id,
          ...JSON.parse(attempt.payload),
        });
      if (doc.extraction)
        evidence(u.id, caseId, "extraction", {
          ...JSON.parse(doc.extraction),
          documentId: doc.id,
          draftSource: id,
        });
      refresh(u.id, c);
      const state = db
        .prepare("SELECT * FROM case_operations WHERE case_id=?")
        .get(caseId);
      result = moveOperation(db, u, c, {
        action: "submit",
        reason: "Institution confirmed and submitted saved draft",
        revision: state.revision,
        inputRevision: state.input_revision,
      });
      const ev = evidence(u.id, caseId, "workflow_transition", result);
      notifyCase(
        db,
        c,
        "workflow:" + ev,
        "workflow",
        "New institution submission requires intake review",
        "reviewer",
      );
      db.prepare(
        "UPDATE submission_drafts SET case_id=?,revision=revision+1,updated=? WHERE id=?",
      ).run(caseId, new Date().toISOString(), id);
      audit(u.id, "draft_submitted", caseId, {
        draftId: id,
        documentVersionId: doc.id,
      });
    });
    json(res, 201, { id: caseId, ...result });
    return true;
  }
  bad(405, "Method not allowed");
}
