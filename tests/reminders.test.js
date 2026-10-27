import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support/harness.js";
import {
  runReminderBatch,
  reminderWindows,
  indiaCivilDate,
} from "../src/reminders.js";
test("reminder windows and India civil-day boundaries are explicit", () => {
  assert.deepEqual(reminderWindows([30, 0, 7, 7]), [0, 7, 30]);
  for (const x of [[], [-1], [1.5], [3651], ["7"]])
    assert.throws(() => reminderWindows(x));
  assert.equal(indiaCivilDate(new Date("2026-01-01T18:29:59Z")), "2026-01-01");
  assert.equal(indiaCivilDate(new Date("2026-01-01T18:30:00Z")), "2026-01-02");
});
test("persisted opt-in reminders are deduplicated, bounded and reauthorize users before delivery", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      id = await h.create(a),
      root = "/cases/" + id;
    const prefs = await h.call(root + "/reminders", undefined, a);
    assert.equal(prefs.body.enabled, false);
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          { revision: 0, windows: [7, 0], enabled: true },
          b,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          { revision: 0, windows: [7, 0], enabled: true },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          { revision: 0, windows: [7], enabled: true },
          a,
        )
      ).status,
      409,
    );
    let result = runReminderBatch(h.app.db, { asOf: "2030-12-26", limit: 1 });
    assert.equal(result.delivered, 1);
    assert.ok(result.next);
    assert.equal(
      runReminderBatch(h.app.db, { asOf: "2030-12-26" }).delivered,
      0,
    );
    assert.equal(
      runReminderBatch(h.app.db, { asOf: "2031-01-01" }).delivered,
      1,
    );
    assert.equal(
      runReminderBatch(h.app.db, { asOf: "2031-01-02" }).delivered,
      1,
    );
    assert.equal(
      runReminderBatch(h.app.db, { asOf: "2031-02-02" }).delivered,
      0,
    );
    h.app.db.prepare("UPDATE users SET tenant='college-b' WHERE id='a'").run();
    h.app.db.prepare("UPDATE reminder_preferences SET windows='[30]'").run();
    assert.equal(
      runReminderBatch(h.app.db, { asOf: "2030-12-15" }).delivered,
      0,
    );
    assert.throws(() => runReminderBatch(h.app.db, { asOf: "2031-02-30" }));
  } finally {
    await h.close();
  }
});
test("clarification reminders stop after the institution responds", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      id = await h.create(a),
      root = "/cases/" + id;
    const requested = await h.call(
      root + "/clarifications",
      {
        text: "Please explain the amount",
        fields: ["amountPaise"],
        deadline: "2026-02-01",
      },
      o,
    );
    assert.equal(requested.status, 201);
    assert.equal(
      (
        await h.call(
          root + "/reminders",
          { revision: 0, enabled: true, windows: [0] },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      runReminderBatch(h.app.db, { asOf: "2026-02-01" }).delivered,
      1,
    );
    const request = h.app.db
      .prepare("SELECT id FROM structured_clarifications WHERE case_id=?")
      .get(id);
    assert.equal(
      (
        await h.call(
          root + "/responses",
          { text: "Amount clarified", requestId: request.id },
          a,
        )
      ).status,
      201,
    );
    assert.equal(
      runReminderBatch(h.app.db, { asOf: "2026-02-02" }).delivered,
      0,
    );
  } finally {
    await h.close();
  }
});
