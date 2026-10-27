import { accessibleCases } from "./pagination.js";
import { canReadCase } from "./permissions.js";
import { randomUUID } from "node:crypto";

export const metricsMigration = {
  version: 22,
  sql: `CREATE TABLE workflow_measurements(id TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES users(id),case_id TEXT REFERENCES cases(id),task TEXT NOT NULL CHECK(task IN ('submission','review','correction','clearance','evidence','clarification')),duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 0 AND 7200000),clicks INTEGER NOT NULL CHECK(clicks BETWEEN 0 AND 10000),errors INTEGER NOT NULL CHECK(errors BETWEEN 0 AND 1000),help INTEGER NOT NULL CHECK(help BETWEEN 0 AND 1000),manual_fields INTEGER NOT NULL CHECK(manual_fields BETWEEN 0 AND 1000),validation_corrections INTEGER NOT NULL CHECK(validation_corrections BETWEEN 0 AND 1000),created TEXT NOT NULL);
CREATE INDEX workflow_measurements_case ON workflow_measurements(case_id,created);
CREATE TRIGGER workflow_measurements_immutable BEFORE UPDATE ON workflow_measurements BEGIN SELECT RAISE(ABORT,'immutable workflow measurement');END;
CREATE TRIGGER workflow_measurements_no_delete BEFORE DELETE ON workflow_measurements BEGIN SELECT RAISE(ABORT,'immutable workflow measurement');END;`,
};
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const average = (values) =>
  values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;

export function operationalMetrics(db, u, url, now = new Date()) {
  const days = Number(url.searchParams.get("days") || 30);
  if (![7, 30, 90, 365].includes(days))
    fail(400, "Choose a 7, 30, 90 or 365 day history window");
  const access = accessibleCases(u),
    since = new Date(+now - days * 86400000).toISOString();
  const cases = db
    .prepare(
      `SELECT c.*,w.stage,w.updated,w.input_revision,w.reviewed_input_revision,d.obligation_id FROM cases c JOIN case_operations w ON w.case_id=c.id JOIN case_domains d ON d.case_id=c.id WHERE ${access.where} ORDER BY c.id LIMIT 501`,
    )
    .all(...access.params);
  if (cases.length > 500)
    fail(413, "Overview exceeds 500 accessible cases; use bounded work queues");
  const scoped = (table, alias, date = true) => {
    const rows = db
      .prepare(
        `SELECT ${alias}.* FROM ${table} ${alias} JOIN cases c ON c.id=${alias}.case_id WHERE ${access.where} ${date ? `AND ${alias}.created>=? AND ${alias}.created<=?` : ""} ORDER BY ${alias}.rowid LIMIT 10001`,
      )
      .all(...access.params, ...(date ? [since, now.toISOString()] : []));
    if (rows.length > 10000)
      fail(
        413,
        "Analytics history exceeds 10000 records; choose a shorter window",
      );
    return rows;
  };
  const evidence = scoped("evidence", "e"),
    clearances = scoped("clearance_events", "e"),
    audit = scoped("audit", "e"),
    measurements = scoped("workflow_measurements", "e");
  const stages = {},
    teams = {},
    bottlenecks = {},
    preparation = [],
    response = [],
    review = [],
    clearanceTimes = [],
    processing = [],
    waiting = [];
  let repeatedReviews = 0;
  const exceptionTrends = {};
  const unlinked = db
    .prepare(
      "SELECT * FROM workflow_measurements WHERE case_id IS NULL AND actor=? AND created>=? AND created<=? ORDER BY rowid LIMIT 10001",
    )
    .all(u.id, since, now.toISOString());
  if (unlinked.length + measurements.length > 10000)
    fail(413, "Too many task measurements; choose a shorter window");
  measurements.push(...unlinked);
  const tasks = {};
  for (const m of measurements) {
    const t = (tasks[m.task] ||= {
      samples: 0,
      durationMs: 0,
      clicks: 0,
      errors: 0,
      help: 0,
      manualFields: 0,
      validationCorrections: 0,
    });
    t.samples++;
    for (const k of [
      "durationMs",
      "clicks",
      "errors",
      "help",
      "manualFields",
      "validationCorrections",
    ])
      t[k] +=
        m[
          {
            durationMs: "duration_ms",
            manualFields: "manual_fields",
            validationCorrections: "validation_corrections",
          }[k] || k
        ];
  }
  for (const t of Object.values(tasks))
    t.meanDurationMs = Math.round(t.durationMs / t.samples);
  const elapsed = (a, b) => {
    const n = Date.parse(b) - Date.parse(a);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  for (const e of evidence) {
    const p = JSON.parse(e.payload);
    if (
      e.kind === "extraction" &&
      Number.isFinite(p.durationMs) &&
      p.durationMs >= 0
    )
      processing.push(p.durationMs);
    if (e.kind === "evaluation") {
      const day = e.created.slice(0, 10);
      exceptionTrends[day] =
        (exceptionTrends[day] || 0) + (p.findings?.length || 0);
    }
    if (e.kind === "workflow_transition" && p.after === "under_review") {
      const row = db.prepare("SELECT rowid FROM evidence WHERE id=?").get(e.id);
      const prior = db
        .prepare(
          "SELECT created,payload FROM evidence WHERE case_id=? AND kind='workflow_transition' AND rowid<? ORDER BY rowid DESC LIMIT 1",
        )
        .get(e.case_id, row.rowid);
      if (prior && JSON.parse(prior.payload).after === "ready_for_review") {
        const n = elapsed(prior.created, e.created);
        if (n != null) waiting.push(n);
      }
      if (
        db
          .prepare(
            "SELECT 1 FROM evidence WHERE case_id=? AND kind='workflow_transition' AND json_extract(payload,'$.after')='under_review' AND rowid<? LIMIT 1",
          )
          .get(e.case_id, row.rowid)
      )
        repeatedReviews++;
    }
    if (e.kind === "responses" && p.requestId) {
      const request = db
        .prepare(
          "SELECT created FROM evidence WHERE id=? AND case_id=? AND kind='clarifications'",
        )
        .get(p.requestId, e.case_id);
      const n = request && elapsed(request.created, e.created);
      if (n != null) response.push(n);
    }
  }
  for (const c of cases) {
    stages[c.stage] = (stages[c.stage] || 0) + 1;
    teams[c.assigned || "unassigned"] =
      (teams[c.assigned || "unassigned"] || 0) + 1;
    const submission = db
      .prepare(
        "SELECT created FROM evidence WHERE case_id=? AND kind='workflow_transition' AND json_extract(payload,'$.after')='submitted' ORDER BY rowid LIMIT 1",
      )
      .get(c.id);
    const firstDraft = db
      .prepare(
        "SELECT created FROM submission_drafts WHERE case_id=? ORDER BY created,id LIMIT 1",
      )
      .get(c.id);
    const first =
      firstDraft ||
      db
        .prepare(
          "SELECT created FROM evidence WHERE case_id=? ORDER BY rowid LIMIT 1",
        )
        .get(c.id);
    if (
      submission &&
      first &&
      submission.created >= since &&
      submission.created <= now.toISOString()
    ) {
      const n = elapsed(first.created, submission.created);
      if (n != null) preparation.push(n);
    }
    const decision = db
      .prepare(
        "SELECT created FROM clearance_events WHERE case_id=? AND kind='proposal' AND action='confirmed' ORDER BY rowid LIMIT 1",
      )
      .get(c.id);
    const submitted = db
      .prepare(
        "SELECT created FROM evidence WHERE case_id=? AND kind='workflow_transition' AND json_extract(payload,'$.after')='submitted' ORDER BY rowid LIMIT 1",
      )
      .get(c.id);
    if (
      decision &&
      submitted &&
      decision.created >= since &&
      decision.created <= now.toISOString()
    ) {
      const n = elapsed(submitted.created, decision.created);
      if (n != null) review.push(n);
    }
    const latest = db
      .prepare(
        "SELECT payload FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
      )
      .get(c.id);
    for (const f of latest ? JSON.parse(latest.payload).findings || [] : [])
      bottlenecks[f.code] = (bottlenecks[f.code] || 0) + 1;
  }
  for (const e of clearances.filter((e) => e.action === "responded")) {
    const first = db
      .prepare(
        "SELECT created FROM clearance_events WHERE case_id=? AND entity=? AND action='requested' AND rowid<? ORDER BY rowid DESC LIMIT 1",
      )
      .get(
        e.case_id,
        e.entity,
        db.prepare("SELECT rowid FROM clearance_events WHERE id=?").get(e.id)
          .rowid,
      );
    if (first) {
      const n = elapsed(first.created, e.created);
      if (n != null) clearanceTimes.push(n);
    }
  }
  const today = now.toISOString().slice(0, 10),
    soon = new Date(+now + 30 * 86400000).toISOString().slice(0, 10);
  const attention = cases
    .map((c) => {
      const reasons = [];
      const pendingRequests = db
        .prepare(
          "SELECT count(*) n FROM clearance_events e WHERE e.case_id=? AND e.kind='request' AND json_extract(e.payload,'$.status')='pending' AND NOT EXISTS(SELECT 1 FROM clearance_events n WHERE n.entity=e.entity AND n.rowid>e.rowid)",
        )
        .get(c.id).n;
      if (pendingRequests) reasons.push("Recorded department requests pending");
      const clarifications = db
        .prepare(
          "SELECT count(*) n FROM structured_clarifications WHERE case_id=? AND status IN ('open','reopened')",
        )
        .get(c.id).n;
      if (clarifications) reasons.push("Clarification awaiting response");
      if (
        !db
          .prepare(
            "SELECT 1 FROM evidence WHERE case_id=? AND kind='document' LIMIT 1",
          )
          .get(c.id)
      )
        reasons.push("Missing document evidence");
      if (c.input_revision !== c.reviewed_input_revision && c.stage !== "draft")
        reasons.push("Changed inputs need review");
      if (
        [
          "pending_clearance",
          "ready_for_decision",
          "response_received",
          "reevaluation_required",
        ].includes(c.stage)
      )
        reasons.push(c.stage.replaceAll("_", " "));
      const instruments = db
        .prepare(
          "SELECT DISTINCT i.id,i.data FROM instruments i JOIN case_instruments ci ON ci.instrument_id=i.id WHERE ci.case_id=? AND i.status!='superseded'",
        )
        .all(c.id);
      const maturities = instruments
        .map((i) => JSON.parse(i.data).matures)
        .filter((d) => d && d <= soon);
      if (maturities.length)
        reasons.push(
          maturities.some((d) => d < today)
            ? "Maturity date passed; release unconfirmed"
            : "Maturity within 30 days",
        );
      return {
        id: c.id,
        name: c.name,
        stage: c.stage,
        updated: c.updated,
        ageDays: Math.max(
          0,
          Math.floor((+now - Date.parse(c.updated)) / 86400000),
        ),
        recordedPendingRequests: pendingRequests,
        reasons,
      };
    })
    .sort(
      (a, b) =>
        b.reasons.length - a.reasons.length ||
        b.ageDays - a.ageDays ||
        a.id.localeCompare(b.id),
    );
  const instruments = db
    .prepare(
      `SELECT count(DISTINCT i.id) n FROM instruments i JOIN case_instruments ci ON ci.instrument_id=i.id JOIN cases c ON c.id=ci.case_id WHERE ${access.where} AND i.status!='superseded'`,
    )
    .get(...access.params).n;
  const result = {
    asOf: now.toISOString(),
    history: { since, through: now.toISOString(), days },
    scope:
      "Only cases currently accessible to this account; departmental document grants do not add cases.",
    cases: cases.length,
    recordedCurrentInstruments: instruments,
    linkedObligations: new Set(cases.map((c) => c.obligation_id)).size,
    obligationPeriods: (() => {
      const rows = db
        .prepare(
          `SELECT DISTINCT o.* FROM obligations o JOIN case_domains d ON d.obligation_id=o.id JOIN cases c ON c.id=d.case_id WHERE ${access.where}`,
        )
        .all(...access.params);
      return {
        recordedInPeriod: rows.filter(
          (o) =>
            o.status === "registered" &&
            o.starts &&
            o.ends &&
            o.starts <= today &&
            o.ends >= today,
        ).length,
        unspecified: rows.filter((o) => !o.starts || !o.ends).length,
      };
    })(),
    stages,
    bottlenecks,
    attention,
    historyCounts: {
      evidenceChanges: evidence.length,
      repeatedReviews,
      reassignments: audit.filter((e) => /assign/.test(e.action)).length,
      reopened: clearances.filter(
        (e) => e.action === "reopened" && e.kind === "administration",
      ).length,
      processingJobs: scoped("jobs", "e").reduce(
        (r, e) => ((r[e.status] = (r[e.status] || 0) + 1), r),
        {},
      ),
    },
    exceptionTrends,
    timing: {
      processing: { samples: processing.length, meanMs: average(processing) },
      reviewerWaiting: { samples: waiting.length, meanMs: average(waiting) },
      preparation: {
        samples: preparation.length,
        meanMs: average(preparation),
      },
      clarificationResponse: {
        samples: response.length,
        meanMs: average(response),
      },
      review: { samples: review.length, meanMs: average(review) },
      clearance: {
        samples: clearanceTimes.length,
        meanMs: average(clearanceTimes),
      },
    },
    measurements: tasks,
    definitions: {
      processing:
        "Recorded extraction duration, successful and failed jobs with a measured duration; not queue delay.",
      reviewerWaiting:
        "Recorded ready-for-review to immediately next under-review transition; interrupted stages excluded.",
      repeatedReviews:
        "Under-review transitions in the window with any earlier recorded under-review transition for the same case.",
      exceptions:
        "Total findings emitted by evaluations completed each UTC day, including reevaluations; not unique institutions or confirmed violations.",
      current:
        "Current scoped cases, stages and latest findings are point-in-time inventory. Recorded instruments are not independently confirmed bank deposits; linked obligations are not asserted active or compliant.",
      aging:
        "Whole days since last operational input/stage update; not total institution delay.",
      history:
        "Events completed within the selected UTC window. No events outside the window contribute to counts.",
      preparation:
        "Earliest linked saved draft (or first case evidence when no draft exists) to first submit completed in the window; excludes unsubmitted drafts and time before the first saved record.",
      obligationPeriods:
        "Registered linked obligations with both declared period boundaries covering the as-of UTC date; unspecified periods are separate. Not independent proof of legal applicability, coverage or bank confirmation.",
      clarificationResponse:
        "Request to recorded response; repeated responses are separate observations.",
      review:
        "First submission to first confirmed internal decision within this window; not a bank release.",
      clearance:
        "Latest preceding requested event to responded event for the same request entity; excludes withdrawn requests.",
      measurements:
        "Explicitly started and finished user task measurements; self-selected observations, not a human productivity study. Only task enum, duration, clicks, errors and help counts are stored.",
    },
  };
  if (["supervisor", "audit_reviewer"].includes(u.role)) result.teams = teams;
  return result;
}

export function workflowMetricsRoute({
  db,
  u,
  path,
  method,
  url,
  body,
  tx,
  audit,
  json,
  res,
}) {
  if (path === "/api/analytics" && method === "GET") {
    json(res, 200, operationalMetrics(db, u, url));
    return true;
  }
  if (path !== "/api/workflow-measurements") return false;
  if (method !== "POST") fail(405, "Method not allowed");
  const keys = [
    "caseId",
    "task",
    "durationMs",
    "clicks",
    "errors",
    "help",
    "manualFields",
    "validationCorrections",
  ];
  if (
    !body ||
    Object.keys(body).some((k) => !keys.includes(k)) ||
    ![
      "submission",
      "review",
      "correction",
      "clearance",
      "evidence",
      "clarification",
    ].includes(body.task)
  )
    fail(400, "Invalid measurement contract");
  if (
    body.caseId !== undefined &&
    (typeof body.caseId !== "string" || !/^[a-f0-9-]{36}$/.test(body.caseId))
  )
    fail(400, "Invalid measurement case reference");
  for (const [k, max] of [
    ["durationMs", 7200000],
    ["clicks", 10000],
    ["errors", 1000],
    ["help", 1000],
    ["manualFields", 1000],
    ["validationCorrections", 1000],
  ])
    if (!Number.isInteger(body[k]) || body[k] < 0 || body[k] > max)
      fail(400, "Invalid measurement count or duration");
  if (
    body.caseId &&
    !canReadCase(
      db,
      u,
      db.prepare("SELECT * FROM cases WHERE id=?").get(body.caseId),
    )
  )
    fail(404, "Case unavailable");
  const id = randomUUID();
  tx(() => {
    db.prepare(
      "INSERT INTO workflow_measurements VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      u.id,
      body.caseId || null,
      body.task,
      body.durationMs,
      body.clicks,
      body.errors,
      body.help,
      body.manualFields,
      body.validationCorrections,
      new Date().toISOString(),
    );
    audit(u.id, "workflow_measurement_recorded", body.caseId || null, {
      measurementId: id,
      task: body.task,
    });
  });
  json(res, 201, { id });
  return true;
}
