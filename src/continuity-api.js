import { analyzeContinuity } from "./continuity.js";
import { randomUUID } from "node:crypto";
import { isInstitution, isReviewer } from "./permissions.js";
import { reminderWindows } from "./reminders.js";
const reject = (status, message) => {
  throw Object.assign(Error(message), { status });
};
export function continuityRoute({
  db,
  c,
  action,
  method,
  url,
  json,
  res,
  audit,
  u,
  body,
  tx,
}) {
  if (action === "reminders" && method === "GET") {
    const p = db
      .prepare(
        "SELECT * FROM reminder_preferences WHERE user_id=? AND case_id=?",
      )
      .get(u.id, c.id);
    json(
      res,
      200,
      p
        ? { ...p, windows: JSON.parse(p.windows) }
        : { windows: [0, 7, 30, 90], enabled: false, revision: 0 },
    );
    return true;
  }
  if (action === "reminders" && method === "POST") {
    let windows;
    try {
      windows = reminderWindows(body.windows);
    } catch (e) {
      reject(400, e.message);
    }
    if (typeof body.enabled !== "boolean")
      reject(400, "Explicit enabled flag required");
    tx(() => {
      const p = db
        .prepare(
          "SELECT revision FROM reminder_preferences WHERE user_id=? AND case_id=?",
        )
        .get(u.id, c.id);
      if (body.revision !== (p?.revision || 0))
        reject(409, "Reminder preferences changed");
      db.prepare(
        "INSERT INTO reminder_preferences VALUES(?,?,?,?,1) ON CONFLICT(user_id,case_id) DO UPDATE SET windows=excluded.windows,enabled=excluded.enabled,revision=reminder_preferences.revision+1",
      ).run(u.id, c.id, JSON.stringify(windows), Number(body.enabled));
      audit(u.id, "reminder_preferences", c.id, {
        windows,
        enabled: body.enabled,
      });
    });
    json(res, 200, {
      revision: body.revision + 1,
      windows,
      enabled: body.enabled,
      delivery: "IN_APP_ONLY",
    });
    return true;
  }
  if (action === "continuity/proposals" && method === "POST") {
    if (!isInstitution(u))
      reject(403, "Institution proposal permission required");
    const id = randomUUID();
    tx(() => {
      const state = db
        .prepare("SELECT input_revision FROM case_operations WHERE case_id=?")
        .get(c.id);
      if (body.inputRevision !== state.input_revision)
        reject(409, "Evidence changed; reload before proposing");
      for (const key of ["predecessor", "successor"])
        if (
          !db
            .prepare(
              "SELECT 1 FROM case_instruments WHERE case_id=? AND instrument_id=?",
            )
            .get(c.id, body[key])
        )
          reject(404, "Linked instrument unavailable");
      if (body.predecessor === body.successor)
        reject(400, "Distinct instruments required");
      if (
        typeof body.reason !== "string" ||
        !body.reason.trim() ||
        body.reason.length > 2000
      )
        reject(400, "Explanation required");
      db.prepare(
        "INSERT INTO continuity_events VALUES(?,?,?,'proposed',?,?,?,?,?,?)",
      ).run(
        id,
        c.id,
        id,
        body.predecessor,
        body.successor,
        u.id,
        state.input_revision,
        body.reason,
        new Date().toISOString(),
      );
      audit(u.id, "continuity_proposed", c.id, { proposalId: id });
    });
    json(res, 201, { id, status: "PROPOSED", bankRelease: false });
    return true;
  }
  if (action === "continuity/events" && method === "GET") {
    // Bounded ordered history; continuation uses explicit immutable event rowid.
    const after = Number(url.searchParams.get("after") || 0);
    if (!Number.isSafeInteger(after) || after < 0)
      reject(400, "Invalid history position");
    const rows = db
      .prepare(
        "SELECT rowid AS position,* FROM continuity_events WHERE case_id=? AND rowid>? ORDER BY rowid LIMIT 51",
      )
      .all(c.id, after);
    json(res, 200, {
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49].position : null,
      pending: db
        .prepare(
          "SELECT p.* FROM continuity_events p WHERE p.case_id=? AND p.kind='proposed' AND NOT EXISTS(SELECT 1 FROM continuity_events r WHERE r.proposal_id=p.id AND r.kind!='proposed') ORDER BY p.rowid LIMIT 50",
        )
        .all(c.id),
    });
    return true;
  }
  const resolution = action?.match(/^continuity\/proposals\/([a-f0-9-]{36})$/);
  if (resolution && method === "POST") {
    if (!["registered", "rejected", "withdrawn"].includes(body.decision))
      reject(400, "Unsupported proposal decision");
    if (body.decision === "withdrawn" ? !isInstitution(u) : !isReviewer(u))
      reject(403, "Proposal decision permission denied");
    tx(() => {
      const proposal = db
        .prepare(
          "SELECT * FROM continuity_events WHERE proposal_id=? AND case_id=? AND kind='proposed'",
        )
        .get(resolution[1], c.id);
      if (!proposal) reject(404, "Proposal unavailable");
      if (
        db
          .prepare(
            "SELECT 1 FROM continuity_events WHERE proposal_id=? AND kind!='proposed'",
          )
          .get(proposal.id)
      )
        reject(409, "Proposal already resolved");
      const state = db
        .prepare("SELECT input_revision FROM case_operations WHERE case_id=?")
        .get(c.id);
      if (body.inputRevision !== state.input_revision)
        reject(409, "Evidence changed; reload before deciding");
      if (
        typeof body.reason !== "string" ||
        !body.reason.trim() ||
        body.reason.length > 2000
      )
        reject(400, "Explanation required");
      if (body.decision === "registered") {
        if (
          !db
            .prepare(
              "SELECT 1 FROM document_instruments di JOIN documents d ON d.id=di.document_id JOIN document_versions v ON v.document_id=d.id WHERE d.case_id=? AND di.instrument_id=?",
            )
            .get(c.id, proposal.successor)
        )
          reject(409, "Successor document evidence required");
        const cycle = db
          .prepare(
            "WITH RECURSIVE edges(predecessor,successor) AS (SELECT predecessor,successor FROM continuity_events WHERE kind='registered' UNION SELECT predecessor,successor FROM instrument_relationships), successors(id) AS (SELECT ? UNION SELECT e.successor FROM edges e JOIN successors s ON s.id=e.predecessor) SELECT 1 FROM successors WHERE id=? LIMIT 1",
          )
          .get(proposal.successor, proposal.predecessor);
        if (cycle) reject(409, "Replacement relationship would form a cycle");
        if (
          db
            .prepare(
              "SELECT 1 FROM continuity_events WHERE successor=? AND kind='registered'",
            )
            .get(proposal.successor)
        )
          reject(409, "Successor already registered");
      }
      db.prepare(
        "INSERT INTO continuity_events VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).run(
        randomUUID(),
        c.id,
        proposal.id,
        body.decision,
        proposal.predecessor,
        proposal.successor,
        u.id,
        state.input_revision,
        body.reason,
        new Date().toISOString(),
      );
      audit(u.id, "continuity_" + body.decision, c.id, {
        proposalId: proposal.id,
      });
    });
    json(res, 200, {
      status: body.decision,
      bankRelease: false,
      meaning: "Internal relationship record; no bank confirmation or release",
    });
    return true;
  }
  if (action !== "continuity" || method !== "GET") return false;
  const link = db
    .prepare("SELECT obligation_id FROM case_domains WHERE case_id=?")
    .get(c.id);
  const obligation = db
    .prepare("SELECT * FROM obligations WHERE id=?")
    .get(link.obligation_id);
  const rows = db
    .prepare(
      "SELECT i.* FROM instruments i JOIN case_instruments ci ON ci.instrument_id=i.id WHERE ci.case_id=? ORDER BY i.id LIMIT 501",
    )
    .all(c.id);
  let report;
  try {
    report = analyzeContinuity({
      starts: url.searchParams.get("starts") || obligation.starts,
      ends: url.searchParams.get("ends") || obligation.ends,
      amountPaise: obligation.amount_paise,
      instruments: rows.map((r) => ({
        id: r.id,
        data: JSON.parse(r.data),
        proposed: !!db
          .prepare(
            "SELECT 1 FROM continuity_events p WHERE p.case_id=? AND p.successor=? AND p.kind='proposed' AND NOT EXISTS(SELECT 1 FROM continuity_events r WHERE r.successor=p.successor AND r.kind='registered')",
          )
          .get(c.id, r.id),
      })),
    });
  } catch (e) {
    throw Object.assign(e, { status: 400 });
  }
  audit(u.id, "continuity_read", c.id);
  json(res, 200, {
    ...report,
    obligationId: obligation.id,
    obligationRevision: obligation.revision,
    instrumentRevisions: rows.map((r) => ({ id: r.id, revision: r.revision })),
    assumptions: [
      "Recorded instruments include historical records; supersession does not establish bank release.",
      "Missing currency or conflicting deposit identity requires review.",
      "Dates are inclusive scenario boundaries, not an authoritative security holding period.",
    ],
  });
  return true;
}
