import { randomUUID } from "node:crypto";
import { isInstitution, isReviewer } from "./permissions.js";
import { paginate, accessibleCases } from "./pagination.js";
import {
  operationSnapshot,
  moveOperation,
  notifyCase,
  clarificationTemplate,
} from "./operations.js";
import { targetedCorrection } from "./resolution.js";
import { validate, evidenceFields } from "./engine.js";
const bad = (s, m) => {
  throw Object.assign(Error(m), { status: s });
};
export function recordConversation(db, u, c, action, body, eventId) {
  if (action === "clarifications") {
    const report = db
      .prepare(
        "SELECT payload FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
      )
      .get(c.id);
    const finding = body.findingCode
      ? JSON.parse(report?.payload || "{}").findings?.find(
          (f) => f.code === body.findingCode,
        )
      : null;
    if (body.findingCode && !finding) bad(409, "Finding is no longer active");
    const fields =
        body.fields || (finding ? clarificationTemplate(finding).fields : []),
      documents = body.documents || [];
    if (
      !Array.isArray(fields) ||
      fields.length > 20 ||
      fields.some((f) => !evidenceFields.includes(f)) ||
      !Array.isArray(documents) ||
      documents.length > 20
    )
      bad(400, "Invalid clarification references");
    for (const id of documents)
      if (
        !db
          .prepare(
            "SELECT 1 FROM evidence WHERE id=? AND case_id=? AND kind='document'",
          )
          .get(id, c.id)
      )
        bad(404, "Referenced document unavailable");
    if (
      body.deadline &&
      (typeof body.deadline !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body.deadline) ||
        !Number.isFinite(Date.parse(body.deadline)) ||
        new Date(body.deadline).toISOString().slice(0, 10) !== body.deadline)
    )
      bad(400, "Invalid explicit deadline");
    db.prepare(
      "INSERT INTO structured_clarifications VALUES(?,?,?,?,?,?,'open',1,?,?)",
    ).run(
      eventId,
      c.id,
      body.findingCode || null,
      JSON.stringify(fields),
      JSON.stringify(documents),
      body.deadline || null,
      u.id,
      new Date().toISOString(),
    );
    notifyCase(
      db,
      c,
      "clarification:" + eventId,
      "clarification",
      "A reviewer requested clarification; inspect the requested fields and evidence",
      "institution",
    );
  } else if (action === "responses") {
    const request = db
      .prepare(
        "SELECT * FROM structured_clarifications WHERE id=? AND case_id=?",
      )
      .get(body.requestId, c.id);
    if (!request || !["open", "reopened"].includes(request.status))
      bad(409, "Clarification is no longer awaiting response");
    if (body.revision !== undefined && body.revision !== request.revision)
      bad(409, "Clarification changed; reload");
    const attachments = body.documents || [];
    if (!Array.isArray(attachments) || attachments.length > 20)
      bad(400, "Invalid response attachments");
    for (const id of attachments)
      if (
        !db
          .prepare(
            "SELECT 1 FROM evidence WHERE id=? AND case_id=? AND kind='document'",
          )
          .get(id, c.id)
      )
        bad(404, "Response document unavailable");
    db.prepare(
      "UPDATE structured_clarifications SET status='responded',revision=revision+1 WHERE id=?",
    ).run(request.id);
    notifyCase(
      db,
      c,
      "response:" + eventId,
      "response",
      "Institution response received; review the clarification and changed evidence",
      "reviewer",
    );
  }
}
export function operationsGlobal({
  db,
  u,
  path,
  url,
  body,
  method,
  tx,
  audit,
  json,
  res,
  cursorKey,
}) {
  if (path === "/api/notifications" && method === "GET") {
    const access = accessibleCases(u),
      page = paginate(db, {
        table: "case_notifications t",
        where:
          "t.user_id=? AND EXISTS(SELECT 1 FROM cases c WHERE c.id=t.case_id AND " +
          access.where +
          ")",
        params: [u.id, ...access.params],
        url,
        scope: u.id + "|" + u.role + "|notifications",
        key: cursorKey,
        descending: true,
      });
    json(res, 200, page);
    return true;
  }
  const notification = path.match(
    /^\/api\/notifications\/([a-f0-9-]{36})\/read$/,
  );
  if (notification && method === "POST") {
    const row = db
      .prepare("SELECT * FROM case_notifications WHERE id=? AND user_id=?")
      .get(notification[1], u.id);
    if (!row) bad(404, "Notification unavailable");
    const access = accessibleCases(u);
    if (
      !db
        .prepare("SELECT 1 FROM cases c WHERE c.id=? AND " + access.where)
        .get(row.case_id, ...access.params)
    )
      bad(404, "Notification unavailable");
    tx(() => {
      db.prepare(
        "UPDATE case_notifications SET read_at=coalesce(read_at,?) WHERE id=?",
      ).run(new Date().toISOString(), row.id);
      audit(u.id, "notification_read", row.case_id, { notificationId: row.id });
    });
    json(res, 200, { ok: true });
    return true;
  }
  const draft = path.match(/^\/api\/drafts(?:\/([a-f0-9-]{36}))?$/);
  if (draft) {
    if (!isInstitution(u)) bad(403, "Institution draft permission required");
    const id = draft[1];
    if (method === "GET") {
      if (id) {
        const row = db
          .prepare(
            "SELECT * FROM submission_drafts WHERE id=? AND tenant=? AND actor=?",
          )
          .get(id, u.tenant, u.id);
        if (!row) bad(404, "Draft unavailable");
        json(res, 200, { ...row, payload: JSON.parse(row.payload) });
      } else {
        const page = paginate(db, {
          table: "submission_drafts t",
          where: "t.tenant=? AND t.actor=?",
          params: [u.tenant, u.id],
          url,
          scope: u.id + "|drafts",
          key: cursorKey,
        });
        json(res, 200, {
          ...page,
          items: page.items.map((r) => ({
            ...r,
            payload: JSON.parse(r.payload),
          })),
        });
      }
      return true;
    }
    if (method !== "POST") bad(405, "Method not allowed");
    if (
      !body.payload ||
      typeof body.payload !== "object" ||
      Array.isArray(body.payload) ||
      Buffer.byteLength(JSON.stringify(body.payload)) > 65536
    )
      bad(400, "Draft payload must be a bounded object");
    const allowed = [
      "name",
      "obligationId",
      "obligation",
      "instrument",
      "confirmedFields",
      "confirmedDocumentId",
      "step",
      "caseId",
    ];
    if (Object.keys(body.payload).some((k) => !allowed.includes(k)))
      bad(400, "Unsupported draft content");
    const p = body.payload;
    if (
      (p.name !== undefined &&
        (typeof p.name !== "string" || p.name.length > 150)) ||
      (p.instrument !== undefined &&
        (!p.instrument ||
          typeof p.instrument !== "object" ||
          Array.isArray(p.instrument))) ||
      (p.obligation !== undefined &&
        (!p.obligation ||
          typeof p.obligation !== "object" ||
          Array.isArray(p.obligation))) ||
      (p.confirmedFields !== undefined &&
        (!Array.isArray(p.confirmedFields) ||
          p.confirmedFields.length > 20 ||
          p.confirmedFields.some((f) => !evidenceFields.includes(f))))
    )
      bad(400, "Invalid saved draft fields");
    const next = id || randomUUID();
    tx(() => {
      if (id) {
        const row = db
          .prepare(
            "SELECT * FROM submission_drafts WHERE id=? AND tenant=? AND actor=?",
          )
          .get(id, u.tenant, u.id);
        if (!row) bad(404, "Draft unavailable");
        if (row.case_id) bad(409, "Submitted draft is frozen");
        if (row.revision !== body.revision) bad(409, "Draft changed; reload");
        db.prepare(
          "UPDATE submission_drafts SET payload=?,revision=revision+1,updated=? WHERE id=?",
        ).run(JSON.stringify(body.payload), new Date().toISOString(), id);
      } else
        db.prepare(
          "INSERT INTO submission_drafts VALUES(?,?,?,?,1,NULL,?,?)",
        ).run(
          next,
          u.tenant,
          u.id,
          JSON.stringify(body.payload),
          new Date().toISOString(),
          new Date().toISOString(),
        );
      audit(u.id, "draft_saved", null, { draftId: next });
    });
    json(res, id ? 200 : 201, {
      id: next,
      revision: db
        .prepare("SELECT revision FROM submission_drafts WHERE id=?")
        .get(next).revision,
    });
    return true;
  }
  if (path === "/api/work-queue" && method === "GET") {
    const access = accessibleCases(u),
      queue = url.searchParams.get("queue") || "assigned";
    const filters = {
      assigned: "1=1",
      submitted: "w.stage='submitted'",
      review: "w.stage IN ('ready_for_review','under_review')",
      responses:
        "EXISTS(SELECT 1 FROM structured_clarifications q WHERE q.case_id=c.id AND q.status='responded')",
      overdue:
        "EXISTS(SELECT 1 FROM structured_clarifications q WHERE q.case_id=c.id AND q.status IN ('open','reopened') AND q.deadline IS NOT NULL AND q.deadline<date('now'))",
      maturity:
        "json_extract(c.instrument,'$.matures') BETWEEN date('now') AND date('now','+90 days')",
      high: "EXISTS(SELECT 1 FROM evidence e,json_each(e.payload,'$.findings') f WHERE e.id=(SELECT id FROM evidence WHERE case_id=c.id AND kind='evaluation' ORDER BY rowid DESC LIMIT 1) AND json_extract(f.value,'$.severity') IN ('HIGH','CRITICAL'))",
    };
    if (!filters[queue]) bad(400, "Unknown transparent queue");
    const page = paginate(db, {
      table: "cases c JOIN case_operations w ON w.case_id=c.id",
      alias: "c",
      where: access.where + " AND " + filters[queue],
      params: access.params,
      url,
      scope: u.id + "|" + u.role + "|queue|" + queue,
      key: cursorKey,
    });
    json(res, 200, {
      ...page,
      definition:
        queue === "maturity"
          ? "Declared maturity in next 90 days; not release eligibility"
          : queue === "overdue"
            ? "Explicit clarification deadline passed"
            : queue,
      items: page.items.map((c) => ({
        id: c.id,
        name: c.name,
        reference: JSON.parse(c.instrument).reference,
        stage: db
          .prepare("SELECT stage FROM case_operations WHERE case_id=?")
          .get(c.id).stage,
      })),
    });
    return true;
  }
  return false;
}
export function operationsCase({
  db,
  u,
  c,
  action,
  method,
  body,
  tx,
  audit,
  evidence,
  refresh,
  json,
  res,
}) {
  if (action === "operations" && method === "GET") {
    json(res, 200, operationSnapshot(db, c));
    return true;
  }
  if (action === "operations" && method === "POST") {
    let result;
    tx(() => {
      result = moveOperation(db, u, c, body);
      const event = evidence(u.id, c.id, "workflow_transition", result);
      notifyCase(
        db,
        c,
        "workflow:" + event,
        "workflow",
        "Case moved to " + result.after,
        result.after === "submitted" ? "reviewer" : "both",
      );
    });
    json(res, 200, { ...result, state: operationSnapshot(db, c) });
    return true;
  }
  if (action === "clarification-templates" && method === "GET") {
    const row = db
      .prepare(
        "SELECT payload FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
      )
      .get(c.id);
    json(
      res,
      200,
      (JSON.parse(row?.payload || "{}").findings || []).map(
        clarificationTemplate,
      ),
    );
    return true;
  }
  const review = action?.match(/^clarifications\/([a-f0-9-]{36})\/review$/);
  if (review && method === "POST") {
    if (!isReviewer(u)) bad(403, "Reviewer permission required");
    if (
      !["close", "reopen"].includes(body.decision) ||
      typeof body.reason !== "string" ||
      !body.reason.trim()
    )
      bad(400, "Review decision and reason required");
    tx(() => {
      const q = db
        .prepare(
          "SELECT * FROM structured_clarifications WHERE id=? AND case_id=?",
        )
        .get(review[1], c.id);
      if (!q) bad(404, "Clarification unavailable");
      if (q.revision !== body.revision) bad(409, "Clarification changed");
      if (body.decision === "close" && q.status !== "responded")
        bad(409, "Review a response before closure");
      if (
        body.decision === "reopen" &&
        !["responded", "closed"].includes(q.status)
      )
        bad(409, "Clarification already awaits a response");
      db.prepare(
        "UPDATE structured_clarifications SET status=?,revision=revision+1 WHERE id=?",
      ).run(body.decision === "close" ? "closed" : "reopened", q.id);
      const event = evidence(u.id, c.id, "clarification_review", {
        requestId: q.id,
        decision: body.decision,
        reason: body.reason,
      });
      refresh(u.id, c);
      notifyCase(
        db,
        c,
        event,
        "clarification",
        body.decision === "close"
          ? "Clarification review recorded"
          : "Clarification reopened; institution response requested",
        "institution",
      );
    });
    json(res, 200, { ok: true });
    return true;
  }
  if (action === "disputed-fields" && method === "POST") {
    if (!isInstitution(u)) bad(403, "Institution correction required");
    let values;
    tx(() => {
      const q = db
        .prepare(
          "SELECT * FROM structured_clarifications WHERE id=? AND case_id=?",
        )
        .get(body.requestId, c.id);
      if (!q || !["open", "reopened"].includes(q.status))
        bad(409, "Open clarification required");
      if (body.revision !== c.revision) bad(409, "Case changed");
      if (
        !body.values ||
        Array.isArray(body.values) ||
        typeof body.values !== "object" ||
        !Object.keys(body.values).length ||
        !body.reason?.trim()
      )
        bad(400, "Values and explanation required");
      try {
        values = validate(
          targetedCorrection(
            JSON.parse(c.instrument),
            body.values,
            JSON.parse(q.fields),
          ),
        );
      } catch (e) {
        bad(e.status || 400, e.message);
      }
      db.prepare(
        "UPDATE cases SET instrument=?,revision=revision+1 WHERE id=?",
      ).run(JSON.stringify(values), c.id);
      evidence(u.id, c.id, "correction", {
        before: JSON.parse(c.instrument),
        after: values,
        requestId: q.id,
        reason: body.reason,
      });
      refresh(
        u.id,
        db.prepare("SELECT * FROM cases WHERE id=?").get(c.id),
        JSON.parse(c.instrument).reference,
      );
    });
    json(res, 200, { ok: true, instrument: values });
    return true;
  }
  return false;
}
