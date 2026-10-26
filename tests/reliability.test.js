import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, instrument } from "./support/harness.js";
import { scrub } from "../src/observability.js";
test("signed pagination is tenant/filter bound and stable while new records arrive", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b");
    const ids = [];
    for (let n = 0; n < 5; n++)
      ids.push(
        await h.create(a, {
          instrument: { ...instrument, reference: "PAGE-" + n },
        }),
      );
    await h.create(b);
    const first = await h.call("/cases?limit=2", undefined, a);
    assert.equal(first.body.length, 2);
    assert.equal(first.headers.get("x-total-count"), "5");
    const cursor = first.headers.get("x-next-cursor");
    assert(cursor);
    await h.create(a, {
      instrument: { ...instrument, reference: "ARRIVED-LATER" },
    });
    const second = await h.call(
      "/cases?limit=2&cursor=" + encodeURIComponent(cursor),
      undefined,
      a,
    );
    assert.equal(second.body.length, 2);
    const third = await h.call(
      "/cases?limit=2&cursor=" +
        encodeURIComponent(second.headers.get("x-next-cursor")),
      undefined,
      a,
    );
    assert.equal(third.body.length, 1);
    assert.equal(
      new Set([...first.body, ...second.body, ...third.body].map((c) => c.id))
        .size,
      5,
    );
    assert.equal(
      (
        await h.call(
          "/cases?limit=2&cursor=" + encodeURIComponent(cursor),
          undefined,
          b,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call(
          "/cases?q=different&cursor=" + encodeURIComponent(cursor),
          undefined,
          a,
        )
      ).status,
      400,
    );
    assert.equal((await h.call("/cases?limit=101", undefined, a)).status, 400);
    assert.equal(
      (
        await h.call(
          "/cases/" + ids[0] + "/domain-records?kind=instruments&limit=1",
          undefined,
          a,
        )
      ).body.items.length,
      1,
    );
    assert.equal(
      (
        await h.call(
          "/cases/" + ids[0] + "/domain-records?kind=instruments",
          undefined,
          b,
        )
      ).status,
      404,
    );
    h.app.db.exec("BEGIN");
    for (let n = 0; n < 55; n++)
      h.app.db
        .prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?)")
        .run(
          "paging-event-" + n,
          ids[0],
          "test_history",
          JSON.stringify({ n }),
          new Date().toISOString(),
          "a",
        );
    h.app.db.exec("COMMIT");
    const current = await h.call("/cases/" + ids[0], undefined, a);
    assert.equal(current.body.history.length, 50);
    assert(current.body.historyPage.nextCursor);
    const older = await h.call(
      "/cases/" +
        ids[0] +
        "/history?cursor=" +
        encodeURIComponent(current.body.historyPage.nextCursor),
      undefined,
      a,
    );
    assert(older.body.items.some((e) => e.kind === "declaration"));
    assert.equal(
      (await h.call("/cases/" + ids[0] + "/history", undefined, b)).status,
      404,
    );
  } finally {
    await h.close();
  }
});
test("audit correlation, outcome and structured logs exclude secrets and survive concurrent requests", async () => {
  const events = [],
    h = await harness({ logSink: (e) => events.push(e) });
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      id = await h.create(a);
    const result = await h.call(
      "/cases/" + id + "/corrections",
      {
        instrument: { ...instrument, amountPaise: 13000000 },
        revision: 1,
        reason: "Audited edit",
      },
      a,
    );
    assert.equal(result.status, 200);
    const requestId = result.headers.get("x-request-id");
    assert(requestId);
    const rows = h.app.db
      .prepare("SELECT * FROM audit WHERE correlation_id=?")
      .all(requestId);
    assert(rows.length);
    assert(rows.every((e) => e.category && e.outcome === "SUCCESS"));
    assert(rows.some((e) => e.action === "correction"));
    await Promise.all([
      h.call("/cases/" + id, undefined, b),
      h.call("/me", undefined, a),
    ]);
    assert(events.some((e) => e.status === 404));
    assert.equal(new Set(events.map((e) => e.requestId)).size, events.length);
    assert(!JSON.stringify(events).includes("phase12-password"));
    assert(!JSON.stringify(events).includes(a.cookie));
    assert(!JSON.stringify(rows).includes("phase12-password"));
    assert.deepEqual(
      scrub({
        password: "x",
        nested: { accessToken: "y", Authorization: "Bearer z" },
      }),
      {
        password: "[REDACTED]",
        nested: { accessToken: "[REDACTED]", Authorization: "[REDACTED]" },
      },
    );
  } finally {
    await h.close();
  }
});
