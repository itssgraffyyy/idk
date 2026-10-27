import { test } from "node:test";
import { migrationFixture } from "./support/migration-fixture.js";
import assert from "node:assert/strict";
import { harness, instrument } from "./support/harness.js";
import {
  runReminderBatch,
  indiaCivilDate,
  reminderCategories,
} from "../src/reminders.js";
import { migrate } from "../src/migrations.js";
const future = () => indiaCivilDate(new Date(Date.now() + 366 * 86400000));
test("missing evidence reminders retain immutable delivery provenance and stop after a real upload", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      id = await h.create(a),
      root = "/cases/" + id,
      db = h.app.db;
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          {
            revision: 0,
            windows: [0],
            categories: ["missing_evidence"],
            enabled: true,
          },
          a,
        )
      ).status,
      200,
    );
    db.exec("BEGIN IMMEDIATE");
    const initial = runReminderBatch(db);
    db.exec("COMMIT");
    assert.equal(initial.delivered, 1);
    assert.equal(runReminderBatch(db, { asOf: future() }).delivered, 0);
    const ledger = db.prepare("SELECT * FROM reminder_deliveries").get();
    assert.equal(
      JSON.parse(ledger.context).source.instrumentId,
      db.prepare("SELECT id FROM instruments").get().id,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='reminder_delivered'",
        )
        .get().n,
      1,
    );
    assert.throws(() =>
      db.prepare("UPDATE reminder_deliveries SET context='{}'").run(),
    );
    assert.throws(() => db.prepare("DELETE FROM reminder_deliveries").run());
    assert.throws(() =>
      db
        .prepare("DELETE FROM case_notifications WHERE id=?")
        .run(ledger.notification_id),
    );
    const history = await h.call(root + "/reminders/history", undefined, a);
    assert.equal(history.status, 200);
    assert.equal(history.body.items.length, 1);
    assert.equal(
      (await h.call(root + "/reminders/history", undefined, b)).status,
      404,
    );
    assert.equal(
      (
        await h.call(
          root + "/documents",
          {
            mime: "text/plain",
            base64: Buffer.from("Actual private source upload").toString(
              "base64",
            ),
          },
          a,
        )
      ).status,
      201,
    );
    assert.equal(runReminderBatch(db, { asOf: future() }).delivered, 0);
  } finally {
    await h.close();
  }
});
test("a delivery ledger failure cannot leave an unaudited notification behind", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      db = h.app.db;
    assert.equal(
      (
        await h.call(
          "/cases/" + id + "/reminders",
          {
            revision: 0,
            windows: [0],
            categories: ["missing_evidence"],
            enabled: true,
          },
          a,
        )
      ).status,
      200,
    );
    const before = db
      .prepare("SELECT count(*) n FROM case_notifications")
      .get().n;
    db.exec(
      "CREATE TRIGGER fail_delivery BEFORE INSERT ON reminder_deliveries BEGIN SELECT RAISE(ABORT,'test delivery failure');END",
    );
    assert.throws(
      () => runReminderBatch(db, { asOf: future() }),
      /test delivery failure/,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM case_notifications").get().n,
      before,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='reminder_delivered'",
        )
        .get().n,
      0,
    );
    db.exec("DROP TRIGGER fail_delivery");
    assert.equal(runReminderBatch(db, { asOf: future() }).delivered, 1);
  } finally {
    await h.close();
  }
});
test("correction and undated response follow-ups stop on response, with no invented deadline", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      id = await h.create(a),
      root = "/cases/" + id,
      db = h.app.db;
    assert.equal(
      (
        await h.call(
          root + "/clarifications",
          { text: "Explain this amount", fields: ["amountPaise"] },
          o,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          {
            revision: 0,
            windows: [0],
            categories: ["correction", "clarification"],
            enabled: true,
          },
          a,
        )
      ).status,
      200,
    );
    assert.equal(runReminderBatch(db, { asOf: future() }).delivered, 2);
    const messages = db
      .prepare(
        "SELECT message FROM case_notifications WHERE category IN ('correction_reminder','clarification_reminder')",
      )
      .all();
    assert.ok(
      messages.every((v) =>
        v.message.includes("No statutory deadline is inferred"),
      ),
    );
    const request = db
      .prepare("SELECT id FROM structured_clarifications")
      .get();
    assert.equal(
      (
        await h.call(
          root + "/responses",
          { text: "Corrected and explained", requestId: request.id },
          a,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          {
            revision: 1,
            windows: [1],
            categories: ["correction", "clarification"],
            enabled: true,
          },
          a,
        )
      ).status,
      200,
    );
    assert.equal(runReminderBatch(db, { asOf: future() }).delivered, 0);
  } finally {
    await h.close();
  }
});
test("assignment and supervisory categories enforce role boundaries and use real current findings", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      s = await h.login("s"),
      id = await h.create(a),
      root = "/cases/" + id,
      db = h.app.db;
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          {
            revision: 0,
            windows: [0],
            categories: ["assignment"],
            enabled: true,
          },
          a,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          {
            revision: 0,
            windows: [0],
            categories: ["supervisor_attention"],
            enabled: true,
          },
          o,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          {
            revision: 0,
            windows: [0],
            categories: ["assignment"],
            enabled: true,
          },
          o,
        )
      ).status,
      200,
    );
    assert.equal(
      (await h.call(root + "/external", { scenario: "mock_conflict" }, o))
        .status,
      200,
    );
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          {
            revision: 0,
            windows: [0],
            categories: ["supervisor_attention"],
            enabled: true,
          },
          s,
        )
      ).status,
      200,
    );
    assert.equal(runReminderBatch(db, { asOf: future() }).delivered, 2);
    const supervisor = db
      .prepare("SELECT context FROM reminder_deliveries WHERE user_id='s'")
      .get();
    assert.ok(
      JSON.parse(supervisor.context).source.findingCodes.includes(
        "external_amountPaise",
      ),
    );
    assert.equal(runReminderBatch(db, { asOf: future() }).delivered, 0);
    assert.equal(
      (await h.call(root + "/reminders/history", undefined, a)).body.items
        .length,
      0,
    );
    assert.equal(
      (await h.call(root + "/reminders/history", undefined, o)).body.items
        .length,
      1,
    );
    db.prepare(
      "UPDATE reminder_preferences SET windows='[1]' WHERE user_id='o'",
    ).run();
    db.prepare("UPDATE users SET role='audit_reviewer' WHERE id='o'").run();
    assert.equal(runReminderBatch(db, { asOf: future() }).delivered, 0);
    assert.throws(() => reminderCategories(["legal_enforcement"]));
  } finally {
    await h.close();
  }
});
test("pending replacement documentation reminder stops after successor evidence arrives", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      root = "/cases/" + id,
      db = h.app.db,
      old = db.prepare("SELECT id FROM instruments").get().id;
    const added = await h.call(
      root + "/instruments",
      {
        instrument: {
          ...instrument,
          reference: "REPLACEMENT-NOTIFICATION",
          type: "FDR",
          currency: "INR",
          branch: "Synthetic branch",
        },
      },
      a,
    );
    assert.equal(added.status, 201);
    const successor = added.body.id,
      inputRevision = db
        .prepare("SELECT input_revision n FROM case_operations WHERE case_id=?")
        .get(id).n;
    assert.equal(
      (
        await h.call(
          root + "/continuity/proposals",
          {
            predecessor: old,
            successor,
            reason: "Need successor evidence",
            inputRevision,
          },
          a,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          {
            revision: 0,
            windows: [0],
            categories: ["replacement_documentation"],
            enabled: true,
          },
          a,
        )
      ).status,
      200,
    );
    assert.equal(runReminderBatch(db, { asOf: future() }).delivered, 1);
    assert.equal(
      (
        await h.call(
          root + "/documents",
          {
            instrumentId: successor,
            mime: "text/plain",
            base64: Buffer.from("Successor evidence").toString("base64"),
          },
          a,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          { revision: 1, windows: [1], enabled: true },
          a,
        )
      ).status,
      200,
    );
    assert.equal(runReminderBatch(db, { asOf: future() }).delivered, 0);
  } finally {
    await h.close();
  }
});
test("migration retains frozen legacy notification bytes and keys and does not redeliver the same window", () => {
  const f = migrationFixture(14);
  try {
    const before = f.snapshot();
    migrate(f.db, f.dir);
    assert.deepEqual(f.snapshot(), before);
    const legacy = JSON.parse(
      f.db.prepare("SELECT context FROM reminder_deliveries").get().context,
    );
    assert.equal(legacy.legacy, true);
    assert.equal(legacy.sourceProvenance, "NOT_RECORDED");
    assert.equal(runReminderBatch(f.db, { asOf: "2030-12-26" }).delivered, 0);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    f.close();
  }
});
