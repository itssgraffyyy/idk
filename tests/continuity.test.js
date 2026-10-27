import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeContinuity } from "../src/continuity.js";
import { harness } from "./support/harness.js";
import { randomUUID } from "node:crypto";
import { migrate } from "../src/migrations.js";
import { readdirSync } from "node:fs";
test("additive continuity migration preserves populated version-13 evidence and document hashes", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      id = await h.create(a);
    assert.equal(
      (
        await h.call(
          "/cases/" + id + "/documents",
          {
            mime: "text/plain",
            base64: Buffer.from("Historical immutable source").toString(
              "base64",
            ),
          },
          a,
        )
      ).status,
      201,
    );
    const db = h.app.db,
      before = db.prepare("SELECT * FROM evidence ORDER BY rowid").all(),
      versions = db
        .prepare("SELECT * FROM document_versions ORDER BY rowid")
        .all();
    // Reconstruct the exact pre-14 schema in this disposable fixture only.
    db.exec(
      "DROP TABLE clearance_events;DROP TABLE reminder_deliveries;DROP TRIGGER continuity_instrument_revision;DROP TRIGGER continuity_link_revision;DROP TABLE continuity_events;DROP TABLE reminder_preferences;DELETE FROM schema_migrations WHERE version>=14",
    );
    migrate(db, h.dir);
    assert.deepEqual(
      db.prepare("SELECT * FROM evidence ORDER BY rowid").all(),
      before,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM document_versions ORDER BY rowid").all(),
      versions,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.ok(
      readdirSync(h.dir).some((p) => p.startsWith("pre-migration-14-")),
    );
    migrate(db, h.dir);
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM schema_migrations WHERE version=14")
        .get().n,
      1,
    );
  } finally {
    await h.close();
  }
});
test("document-backed replacement registration is race-safe and never releases or supersedes a deposit", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      o = await h.login("o");
    const id = await h.create(a),
      root = "/cases/" + id;
    const old = h.app.db.prepare("SELECT * FROM instruments").get();
    const added = await h.call(
      root + "/instruments",
      {
        instrument: {
          ...JSON.parse(old.data),
          reference: "RENEWAL",
          type: "FDR",
          currency: "INR",
          branch: "Synthetic branch",
        },
      },
      a,
    );
    assert.equal(added.status, 201);
    const successor = added.body.id;
    const upload = await h.call(
      root + "/documents",
      {
        instrumentId: successor,
        mime: "text/plain",
        base64: Buffer.from(
          "Synthetic renewal evidence, not a bank confirmation",
        ).toString("base64"),
      },
      a,
    );
    assert.equal(upload.status, 201);
    const revision = () =>
      h.app.db
        .prepare("SELECT input_revision n FROM case_operations WHERE case_id=?")
        .get(id).n;
    const proposal = await h.call(
      root + "/continuity/proposals",
      {
        predecessor: old.id,
        successor,
        reason: "Document-backed proposed replacement",
        inputRevision: revision(),
      },
      a,
    );
    assert.equal(proposal.status, 201);
    const snapshot = revision();
    h.app.db
      .prepare(
        "UPDATE instruments SET data=json_set(data,'$.branch','Corrected branch'),revision=revision+1 WHERE id=?",
      )
      .run(successor);
    assert.ok(revision() > snapshot);
    assert.equal(
      (
        await h.call(
          root + "/continuity/proposals/" + proposal.body.id,
          {
            decision: "registered",
            reason: "Reviewed",
            inputRevision: snapshot,
          },
          o,
        )
      ).status,
      409,
    );
    const body = {
      decision: "registered",
      reason: "Internal documentary relationship only",
      inputRevision: revision(),
    };
    const outcomes = await Promise.all([
      h.call(root + "/continuity/proposals/" + proposal.body.id, body, o),
      h.call(root + "/continuity/proposals/" + proposal.body.id, body, o),
    ]);
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      outcomes.find((r) => r.status === 200).body.bankRelease,
      false,
    );
    assert.equal(
      h.app.db.prepare("SELECT status FROM instruments WHERE id=?").get(old.id)
        .status,
      "recorded",
    );
    const reverse = await h.call(
      root + "/continuity/proposals",
      {
        predecessor: successor,
        successor: old.id,
        reason: "Reverse cycle must fail",
        inputRevision: revision(),
      },
      a,
    );
    assert.equal(reverse.status, 201);
    // Give the predecessor its own evidence so cycle protection, not a missing document, blocks it.
    assert.equal(
      (
        await h.call(
          root + "/documents",
          {
            instrumentId: old.id,
            mime: "text/plain",
            base64: Buffer.from("Synthetic original deposit").toString(
              "base64",
            ),
          },
          a,
        )
      ).status,
      201,
    );
    const cycle = await h.call(
      root + "/continuity/proposals/" + reverse.body.id,
      {
        decision: "registered",
        reason: "Should fail cycle guard",
        inputRevision: revision(),
      },
      o,
    );
    assert.equal(cycle.status, 409);
    assert.match(cycle.body.error, /cycle/);
  } finally {
    await h.close();
  }
});
const deposit = (id, overrides = {}) => ({
  id,
  data: {
    reference: id,
    ifsc: "HDFC0001234",
    currency: "INR",
    amountPaise: 100,
    issued: "2026-01-01",
    matures: "2026-01-03",
    ...overrides,
  },
});
const run = (instruments, overrides = {}) =>
  analyzeContinuity({
    starts: "2026-01-01",
    ends: "2026-01-05",
    amountPaise: 100,
    instruments,
    ...overrides,
  });
test("continuity distinguishes declared gaps, overlaps and unknown bank/legal authority", () => {
  const r = run([
    deposit("a"),
    deposit("b", { issued: "2026-01-05", matures: "2026-02-01" }),
  ]);
  assert.deepEqual(
    r.segments.map((s) => [s.starts, s.ends, s.status]),
    [
      ["2026-01-01", "2026-01-03", "POTENTIAL_DECLARED_COVERAGE"],
      ["2026-01-04", "2026-01-04", "POTENTIAL_DECLARED_SHORTFALL"],
      ["2026-01-05", "2026-01-05", "POTENTIAL_DECLARED_COVERAGE"],
    ],
  );
  assert.equal(r.establishedGap, false);
  assert.equal(r.bankConfirmation, "UNCONFIRMED");
});
test("no pooling, duplicate double count, proposed coverage or conflict-based certainty", () => {
  assert.equal(
    run([deposit("a", { amountPaise: 60 }), deposit("b", { amountPaise: 60 })])
      .segments[0].status,
    "POTENTIAL_DECLARED_SHORTFALL",
  );
  const same = deposit("b", { reference: "a", ifsc: "HDFC0009999" });
  assert.equal(run([deposit("a"), same]).segments[0].instrumentIds.length, 1);
  same.data.amountPaise = 90;
  assert.equal(run([deposit("a"), same]).segments[0].status, "UNKNOWN");
  assert.equal(run([{ ...deposit("a"), proposed: true }]).excluded.length, 1);
  assert.equal(
    run([deposit("a", { currency: undefined })]).segments[0].status,
    "UNKNOWN",
  );
});
test("continuity handles leap days, exact money, inclusive endpoints and rejects malformed ranges", () => {
  assert.equal(
    run([deposit("a", { amountPaise: Number.MAX_SAFE_INTEGER })]).segments[0]
      .maximumSingleAmountPaise,
    String(Number.MAX_SAFE_INTEGER),
  );
  assert.throws(() => run([], { starts: "2026-02-29" }));
  assert.throws(() => run([], { ends: "2025-01-01" }));
  assert.throws(() => run(new Array(501)));
  const r = run(
    [deposit("a", { issued: "2028-02-28", matures: "2028-02-29" })],
    { starts: "2028-02-28", ends: "2028-03-01" },
  );
  assert.equal(r.segments[1].starts, "2028-03-01");
});
test("continuity API scopes records and preserves evidence and instrument revisions", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      officer = await h.login("o");
    const id = await h.create(a, {
      instrument: {
        reference: "ONE",
        amountPaise: 12500000,
        bank: "HDFC Bank",
        ifsc: "HDFC0001234",
        currency: "INR",
        issued: "2026-01-01",
        matures: "2031-01-01",
      },
    });
    const path = `/cases/${id}/continuity?starts=2026-01-01&ends=2031-01-02`;
    const before = h.app.db.prepare("SELECT * FROM instruments").all();
    const count = h.app.db.prepare("SELECT count(*) n FROM evidence").get().n;
    const r = await h.call(path, undefined, a);
    assert.equal(r.status, 200);
    assert.equal(r.body.segments.at(-1).status, "POTENTIAL_DECLARED_SHORTFALL");
    assert.equal((await h.call(path, undefined, officer)).status, 200);
    assert.equal((await h.call(path, undefined, b)).status, 404);
    assert.equal(
      (await h.call(`/cases/${id}/continuity?starts=bad`, undefined, a)).status,
      400,
    );
    assert.deepEqual(
      h.app.db.prepare("SELECT * FROM instruments").all(),
      before,
    );
    assert.equal(
      h.app.db.prepare("SELECT count(*) n FROM evidence").get().n,
      count,
    );
  } finally {
    await h.close();
  }
});
test("replacement proposals preserve instruments, enforce revision/roles and keep immutable decisions", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      b = await h.login("b"),
      r = await h.login("r");
    const id = await h.create(a);
    const old = h.app.db.prepare("SELECT * FROM instruments").get();
    const successor = randomUUID();
    h.app.db
      .prepare(
        "INSERT INTO instruments(id,tenant,obligation_id,data) VALUES(?,?,?,?)",
      )
      .run(
        successor,
        old.tenant,
        old.obligation_id,
        JSON.stringify({
          ...JSON.parse(old.data),
          reference: "SUCCESSOR",
          currency: "INR",
        }),
      );
    h.app.db
      .prepare("INSERT INTO case_instruments VALUES(?,?)")
      .run(id, successor);
    const revision = () =>
      h.app.db
        .prepare("SELECT input_revision n FROM case_operations WHERE case_id=?")
        .get(id).n;
    const path = `/cases/${id}/continuity/proposals`;
    const body = {
      predecessor: old.id,
      successor,
      reason: "Renewal proposal",
      inputRevision: revision(),
    };
    assert.equal((await h.call(path, body, o)).status, 403);
    assert.equal((await h.call(path, body, b)).status, 404);
    assert.equal(
      (await h.call(path, { ...body, inputRevision: 0 }, a)).status,
      409,
    );
    const proposal = await h.call(path, body, a);
    assert.equal(proposal.status, 201);
    assert.equal(
      h.app.db.prepare("SELECT status FROM instruments WHERE id=?").get(old.id)
        .status,
      "recorded",
    );
    const decide = path + "/" + proposal.body.id;
    assert.equal(
      (
        await h.call(
          decide,
          {
            decision: "registered",
            reason: "reviewed",
            inputRevision: revision(),
          },
          a,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.call(
          decide,
          {
            decision: "registered",
            reason: "reviewed",
            inputRevision: revision(),
          },
          r,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.call(
          decide,
          {
            decision: "registered",
            reason: "reviewed",
            inputRevision: revision(),
          },
          o,
        )
      ).status,
      409,
    );
    const resolved = await h.call(
      decide,
      {
        decision: "rejected",
        reason: "Successor evidence missing",
        inputRevision: revision(),
      },
      o,
    );
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.bankRelease, false);
    assert.equal(
      (
        await h.call(
          decide,
          {
            decision: "withdrawn",
            reason: "withdraw",
            inputRevision: revision(),
          },
          a,
        )
      ).status,
      409,
    );
    const events = await h.call(`/cases/${id}/continuity/events`, undefined, a);
    assert.deepEqual(
      events.body.items.map((e) => e.kind),
      ["proposed", "rejected"],
    );
    assert.throws(() =>
      h.app.db.prepare("DELETE FROM continuity_events").run(),
    );
    assert.throws(() =>
      h.app.db.prepare("UPDATE continuity_events SET reason='changed'").run(),
    );
  } finally {
    await h.close();
  }
});
