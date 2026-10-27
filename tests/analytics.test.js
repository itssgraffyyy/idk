import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support/harness.js";
import { operationalMetrics } from "../src/workflow-metrics.js";
import { randomUUID } from "node:crypto";

test("analytics totals, attention and optional measurements respect live institution, assignment and authority boundaries", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      o = await h.login("o"),
      p = await h.login("p"),
      s = await h.login("s"),
      r = await h.login("r"),
      x = await h.login("x");
    const id = await h.create(a),
      other = await h.create(b, { name: "Private other college" });
    const sample = {
      caseId: id,
      task: "review",
      durationMs: 1000,
      clicks: 3,
      errors: 0,
      help: 1,
      manualFields: 2,
      validationCorrections: 0,
    };
    assert.equal(
      (await h.call("/workflow-measurements", { ...sample, caseId: {} }, a))
        .status,
      400,
    );
    assert.equal(
      (await h.call("/workflow-measurements", sample, a)).status,
      201,
    );
    assert.equal(
      (await h.call("/workflow-measurements", { ...sample, caseId: other }, a))
        .status,
      404,
    );
    assert.equal(
      (await h.call("/workflow-measurements", sample, r)).status,
      403,
    );
    assert.equal(
      (
        await h.call(
          "/workflow-measurements",
          { ...sample, documentText: "forbidden" },
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (await h.call("/workflow-measurements", { ...sample, durationMs: -1 }, a))
        .status,
      400,
    );
    assert.equal(
      (await h.call("/analytics?days=10", undefined, a)).status,
      400,
    );
    for (const [auth, count] of [
      [a, 1],
      [b, 1],
      [o, 2],
      [p, 0],
      [s, 2],
      [r, 2],
      [x, 0],
    ]) {
      const result = await h.call("/analytics", undefined, auth);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.cases, count);
      assert.equal(result.body.attention.length, count);
      if (auth === a) {
        assert.equal(result.body.measurements.review.meanDurationMs, 1000);
        assert.equal(result.body.measurements.review.clicks, 3);
        assert.ok(
          !JSON.stringify(result.body).includes("Private other college"),
        );
        assert.ok(
          result.body.attention[0].reasons.includes(
            "Missing document evidence",
          ),
        );
        assert.equal(result.body.teams, undefined);
      }
    }
    h.app.db.prepare("UPDATE cases SET assigned=? WHERE id=?").run("p", id);
    assert.equal(
      (await h.call("/analytics", undefined, o)).body.measurements.review,
      undefined,
    );
    assert.equal(
      (await h.call("/analytics", undefined, p)).body.measurements.review
        .samples,
      1,
    );
    assert.throws(
      () => h.app.db.exec("DELETE FROM workflow_measurements"),
      /immutable/,
    );
  } finally {
    await h.close();
  }
});

test("event timings use exact historical completion windows and unknown stays null; bounded history rejects partial statistics", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      db = h.app.db;
    const insert = (kind, payload, created) =>
      db
        .prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?)")
        .run(randomUUID(), id, kind, JSON.stringify(payload), created, "a");
    const request = randomUUID();
    db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?)").run(
      request,
      id,
      "clarifications",
      "{}",
      "2026-09-30T00:00:00.000Z",
      "o",
    );
    insert("responses", { requestId: request }, "2026-10-02T00:00:00.000Z");
    insert(
      "workflow_transition",
      { after: "submitted" },
      "2026-10-01T00:00:00.000Z",
    );
    insert(
      "workflow_transition",
      { after: "submitted" },
      "2026-10-26T00:00:00.000Z",
    );
    const u = db.prepare("SELECT * FROM users WHERE id=?").get("a");
    const result = operationalMetrics(
      db,
      u,
      new URL("http://local?days=30"),
      new Date("2026-10-27T00:00:00Z"),
    );
    assert.equal(result.timing.clarificationResponse.samples, 1);
    assert.equal(result.timing.clarificationResponse.meanMs, 172800000);
    assert.equal(result.timing.review.meanMs, null);
    db.prepare("INSERT INTO submission_drafts VALUES(?,?,?,?,1,?,?,?)").run(
      randomUUID(),
      "college-a",
      "a",
      "{}",
      id,
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    );
    db.prepare(
      "UPDATE obligations SET starts=?,ends=? WHERE id=(SELECT obligation_id FROM case_domains WHERE case_id=?)",
    ).run("2026-01-01", "2026-12-31", id);
    const requestEvent = randomUUID();
    db.prepare(
      "INSERT INTO clearance_events VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      requestEvent,
      "authority",
      id,
      "analytics-request",
      "request",
      "requested",
      1,
      null,
      "o",
      JSON.stringify({ status: "pending" }),
      "2026-10-01T00:00:00.000Z",
    );
    assert.equal(
      operationalMetrics(
        db,
        u,
        new URL("http://local?days=30"),
        new Date("2026-10-27T00:00:00Z"),
      ).attention[0].recordedPendingRequests,
      1,
    );
    db.prepare(
      "INSERT INTO clearance_events VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      "authority",
      id,
      "analytics-request",
      "request",
      "responded",
      2,
      requestEvent,
      "o",
      JSON.stringify({ status: "accepted" }),
      "2026-10-03T00:00:00.000Z",
    );
    insert("extraction", { durationMs: 1234 }, "2026-10-02T00:00:00.000Z");
    insert(
      "workflow_transition",
      { after: "ready_for_review" },
      "2026-10-03T00:00:00.000Z",
    );
    insert(
      "workflow_transition",
      { after: "under_review" },
      "2026-10-04T00:00:00.000Z",
    );
    insert(
      "workflow_transition",
      { after: "under_review" },
      "2026-10-05T00:00:00.000Z",
    );
    const completed = operationalMetrics(
      db,
      u,
      new URL("http://local?days=30"),
      new Date("2026-10-27T00:00:00Z"),
    );
    assert.equal(completed.timing.clearance.meanMs, 172800000);
    assert.equal(completed.timing.preparation.meanMs, 30 * 86400000);
    assert.equal(completed.obligationPeriods.recordedInPeriod, 1);
    assert.equal(completed.obligationPeriods.unspecified, 0);
    assert.equal(completed.timing.processing.meanMs, 1234);
    assert.equal(completed.timing.reviewerWaiting.meanMs, 86400000);
    assert.equal(completed.historyCounts.repeatedReviews, 1);
    assert.equal(completed.attention[0].recordedPendingRequests, 0);
    const short = operationalMetrics(
      db,
      u,
      new URL("http://local?days=7"),
      new Date("2026-10-27T00:00:00Z"),
    );
    assert.equal(short.timing.clarificationResponse.samples, 0);
    assert.equal(
      short.timing.preparation.samples,
      0,
      "resubmission does not masquerade as first preparation",
    );
    db.exec("BEGIN");
    try {
      for (let i = 0; i < 10001; i++)
        insert("observations", {}, "2026-10-25T00:00:00.000Z");
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    assert.throws(
      () =>
        operationalMetrics(
          db,
          u,
          new URL("http://local?days=7"),
          new Date("2026-10-27T00:00:00Z"),
        ),
      { status: 413 },
    );
  } finally {
    await h.close();
  }
});
