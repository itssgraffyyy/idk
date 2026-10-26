import { randomUUID } from "node:crypto";
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
  let delivered = 0;
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
    const windows = reminderWindows(JSON.parse(p.windows));
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
      for (const window of due)
        delivered += Number(
          db
            .prepare(
              "INSERT OR IGNORE INTO case_notifications VALUES(?,?,?,?,?,?,?,NULL)",
            )
            .run(
              randomUUID(),
              u.id,
              c.id,
              category,
              ["reminder", c.id, identity, date, window].join(":"),
              message +
                " (" +
                date +
                "). Check current evidence; this reminder is not a bank or legal determination.",
              new Date().toISOString(),
            ).changes,
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
          "maturity_reminder",
          "Declared maturity approaching or passed",
        );
    for (const request of db
      .prepare(
        "SELECT id,deadline FROM structured_clarifications WHERE case_id=? AND status IN ('open','reopened') AND deadline IS NOT NULL ORDER BY id LIMIT 500",
      )
      .all(c.id))
      emit(
        request.id,
        request.deadline,
        "clarification_reminder",
        "Explicit clarification deadline approaching or passed",
      );
  }
  return {
    delivered,
    next: rows.length === limit ? rows.at(-1).position : 0,
    basis: "Asia/Kolkata civil date",
    asOf,
  };
}
