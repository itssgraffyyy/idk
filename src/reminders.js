import { randomUUID, createHash } from "node:crypto";
import { canReadCase } from "./permissions.js";
export function reminderWindows(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 10 ||
    value.some((n) => !Number.isInteger(n) || n < 0 || n > 3650)
  )
    throw Error("Use one to ten day windows between zero and 3650");
  return [...new Set(value)].sort((a, b) => a - b);
}
export function indiaCivilDate(now = new Date()) {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
export const reminderCategoryNames = [
  "maturity",
  "clarification",
  "correction",
  "missing_evidence",
  "replacement_documentation",
  "assignment",
  "supervisor_attention",
];
export function reminderCategories(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > reminderCategoryNames.length ||
    value.some((v) => !reminderCategoryNames.includes(v))
  )
    throw Error("Select supported reminder categories");
  return [...new Set(value)].sort();
}
function delivery(db, u, c, category, key, message, context) {
  const id = randomUUID(),
    created = new Date().toISOString();
  db.exec("SAVEPOINT reminder_delivery");
  try {
    const changes = Number(
      db
        .prepare(
          "INSERT OR IGNORE INTO case_notifications VALUES(?,?,?,?,?,?,?,NULL)",
        )
        .run(
          id,
          u.id,
          c.id,
          category + "_reminder",
          key,
          message +
            " Check current evidence; this is an operational reminder, not a bank or legal determination.",
          created,
        ).changes,
    );
    if (changes) {
      db.prepare("INSERT INTO reminder_deliveries VALUES(?,?,?,?,?,?,?)").run(
        id,
        c.id,
        u.id,
        category,
        key,
        JSON.stringify(context),
        created,
      );
      db.prepare(
        "INSERT INTO audit(actor,action,case_id,payload,created,correlation_id,category,outcome) VALUES('system','reminder_delivered',?,?,?,'system','administration','SUCCESS')",
      ).run(
        c.id,
        JSON.stringify({
          notificationId: id,
          recipientUserId: u.id,
          category,
          conditionKey: key,
          ...context,
        }),
        created,
      );
    }
    db.exec("RELEASE reminder_delivery");
    return changes;
  } catch (e) {
    db.exec("ROLLBACK TO reminder_delivery; RELEASE reminder_delivery");
    throw e;
  }
}
export function runReminderBatch(
  db,
  { asOf = indiaCivilDate(), after = 0, limit = 100 } = {},
) {
  const time = Date.parse(asOf);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== asOf ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(after) ||
    after < 0
  )
    throw Error("Invalid reminder batch");
  const rows = db
    .prepare(
      "SELECT rowid AS position,* FROM reminder_preferences WHERE rowid>? ORDER BY rowid LIMIT ?",
    )
    .all(after, limit);
  let delivered = 0,
    evaluated = 0,
    matchedConditions = 0;
  for (const p of rows) {
    if (!p.enabled) continue;
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(p.user_id),
      c = db.prepare("SELECT * FROM cases WHERE id=?").get(p.case_id);
    if (!u || u.status !== "active" || !c || !canReadCase(db, u, c)) continue;
    if (
      db
        .prepare(
          "SELECT 1 FROM case_operations WHERE case_id=? AND stage='closed'",
        )
        .get(c.id)
    )
      continue;
    const windows = reminderWindows(JSON.parse(p.windows)),
      categories = reminderCategories(JSON.parse(p.categories));
    evaluated++;
    const operation = db
      .prepare("SELECT * FROM case_operations WHERE case_id=?")
      .get(c.id);
    const send = (identity, category, window, message, source) => {
      if (!categories.includes(category)) return;
      matchedConditions++;
      const key = ["reminder", c.id, category, identity, window].join(":");
      delivered += delivery(db, u, c, category, key, message, {
        asOf,
        dateBasis: "Asia/Kolkata civil date",
        window,
        source,
        inputRevision: operation.input_revision,
      });
    };
    const emit = (identity, date, category, message) => {
      const at = Date.parse(date),
        delta = (at - time) / 86400000;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(at) ||
        new Date(at).toISOString().slice(0, 10) !== date
      )
        return;
      const due = delta < 0 ? ["overdue"] : windows.filter((w) => delta <= w);
      for (const window of due) {
        // Preserve pre-15 delivery identities; migration does not rewrite messages or history.
        const legacyKey = ["reminder", c.id, identity, date, window].join(":");
        if (
          db
            .prepare(
              "SELECT 1 FROM case_notifications WHERE user_id=? AND dedupe_key=? AND category=?",
            )
            .get(u.id, legacyKey, category + "_reminder")
        )
          continue;
        send(
          identity + ":" + date,
          category,
          window,
          message + " (" + date + ").",
          { id: identity, date },
        );
      }
    };
    const aged = (identity, created, category, message, source) => {
      const date = indiaCivilDate(new Date(created)),
        age = (time - Date.parse(date)) / 86400000;
      for (const window of windows.filter((w) => age >= w))
        send(
          identity,
          category,
          window,
          message +
            " Operational elapsed-day threshold: " +
            window +
            ". No statutory deadline is inferred.",
          source,
        );
    };
    const instruments = db
      .prepare(
        "SELECT i.id,i.data FROM instruments i JOIN case_instruments ci ON ci.instrument_id=i.id WHERE ci.case_id=? ORDER BY i.id LIMIT 501",
      )
      .all(c.id);
    // Oversized cases are not silently partially analyzed; UI exposes the bounded-analysis error.
    if (instruments.length <= 500)
      for (const i of instruments)
        emit(
          i.id,
          JSON.parse(i.data).matures,
          "maturity",
          "Declared maturity approaching or passed",
        );
    for (const request of db
      .prepare(
        "SELECT * FROM structured_clarifications WHERE case_id=? AND status IN ('open','reopened') ORDER BY id LIMIT 500",
      )
      .all(c.id)) {
      if (request.deadline)
        emit(
          request.id,
          request.deadline,
          "clarification",
          "Explicit clarification deadline approaching or passed",
        );
      else
        aged(
          request.id,
          request.created,
          "clarification",
          "Clarification awaits an institution response.",
          { requestId: request.id },
        );
      if (JSON.parse(request.fields).length)
        aged(
          request.id,
          request.created,
          "correction",
          "Requested field correction remains outstanding.",
          { requestId: request.id, fields: JSON.parse(request.fields) },
        );
    }
    if (instruments.length <= 500)
      for (const i of instruments) {
        if (
          !db
            .prepare(
              "SELECT 1 FROM document_instruments di JOIN documents d ON d.id=di.document_id JOIN document_versions v ON v.document_id=d.id WHERE d.case_id=? AND d.kind='fdr' AND di.instrument_id=?",
            )
            .get(c.id, i.id)
        )
          aged(
            i.id + ":" + operation.input_revision,
            operation.updated,
            "missing_evidence",
            "Instrument source document is missing.",
            { instrumentId: i.id },
          );
      }
    for (const proposal of db
      .prepare(
        "SELECT p.* FROM continuity_events p WHERE p.case_id=? AND p.kind='proposed' AND NOT EXISTS(SELECT 1 FROM continuity_events r WHERE r.proposal_id=p.id AND r.kind!='proposed') AND NOT EXISTS(SELECT 1 FROM document_instruments di JOIN documents d ON d.id=di.document_id JOIN document_versions v ON v.document_id=d.id WHERE d.case_id=p.case_id AND di.instrument_id=p.successor) ORDER BY p.rowid LIMIT 500",
      )
      .all(c.id))
      aged(
        proposal.id,
        proposal.created,
        "replacement_documentation",
        "Pending replacement needs successor document evidence.",
        { proposalId: proposal.id, instrumentId: proposal.successor },
      );
    if (u.id === c.assigned && ["officer", "supervisor"].includes(u.role)) {
      const assignment = db
        .prepare(
          "SELECT id,created FROM audit WHERE case_id=? AND action IN ('case_created','assignment') ORDER BY id DESC LIMIT 1",
        )
        .get(c.id);
      if (assignment)
        aged(
          String(assignment.id),
          assignment.created,
          "assignment",
          "This case is assigned to you; inspect its current review step.",
          { assignmentAuditId: assignment.id },
        );
    }
    if (u.role === "supervisor") {
      const evaluation = db
        .prepare(
          "SELECT id,payload,created FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
        )
        .get(c.id);
      const findings = (
        evaluation ? JSON.parse(evaluation.payload).findings || [] : []
      )
        .filter((f) => ["HIGH", "CRITICAL"].includes(f.severity))
        .map((f) => f.code)
        .sort();
      if (findings.length) {
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(findings))
          .digest("hex");
        aged(
          operation.input_revision + ":" + fingerprint,
          evaluation.created,
          "supervisor_attention",
          "High-severity findings require supervisory attention.",
          { evaluationId: evaluation.id, findingCodes: findings },
        );
      }
    }
  }
  return {
    delivered,
    processed: rows.length,
    evaluated,
    matchedConditions,
    next: rows.length === limit ? rows.at(-1).position : 0,
    basis: "Asia/Kolkata civil date",
    asOf,
  };
}
