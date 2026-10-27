import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, instrument } from "./support/harness.js";
import { migrate } from "../src/migrations.js";
import { readdirSync } from "node:fs";
import { migrationFixture } from "./support/migration-fixture.js";
import { runReminderBatch } from "../src/reminders.js";
import { LocalPrivateStorage } from "../src/storage.js";
import { clearanceService } from "../src/clearance-service.js";
import {
  syntheticProcedure as procedure,
  syntheticPolicy as policy,
} from "./support/clearance-fixtures.js";
const options = {
  procedures: [procedure],
  policies: [policy],
  policyScope: "synthetic-test",
};
test("department download rechecks session and exact request event after storage returns", async () => {
  for (const mutation of ["session", "request"]) {
    const h = await harness(options),
      original = LocalPrivateStorage.prototype.read;
    try {
      const c = await setup(h),
        r = await request(h, c);
      const service = clearanceService({
        db: h.app.db,
        procedures: [procedure],
        policyConfig: {
          policies: [policy],
          scope: "synthetic-test",
          verifiedSourceHashes: [],
        },
        audit: (actor, action, caseId, payload) =>
          h.app.db
            .prepare(
              "INSERT INTO audit(actor,action,case_id,payload,created) VALUES(?,?,?,?,?)",
            )
            .run(
              actor,
              action,
              caseId,
              JSON.stringify(payload),
              new Date().toISOString(),
            ),
      });
      let invoked = false;
      LocalPrivateStorage.prototype.read = function (key) {
        const bytes = original.call(this, key);
        if (key === c.versionId && !invoked) {
          invoked = true;
          if (mutation === "session")
            h.app.db.prepare("DELETE FROM sessions WHERE user_id='p'").run();
          else
            service.respond(
              { id: "p", role: "officer", tenant: "authority" },
              r.entity,
              {
                revision: r.revision,
                status: "accepted",
                reason: "Concurrent synthetic department response",
              },
            );
        }
        return bytes;
      };
      const response = await fetch(
        h.base +
          "/api/clearance/requests/" +
          encodeURIComponent(r.entity) +
          "/documents/" +
          c.versionId,
        { headers: c.p },
      );
      assert.equal(response.status, mutation === "session" ? 403 : 409);
      assert.ok(!(await response.text()).includes("Deposit Amount"));
      assert.equal(invoked, true);
    } finally {
      LocalPrivateStorage.prototype.read = original;
      await h.close();
    }
  }
});
test("guarded internal closure preserves obligations and bank state; reopening starts a fresh evidence review", async () => {
  const h = await harness(options);
  try {
    const c = await setup(h);
    assert.equal(
      (
        await h.call(
          c.admin + "/close",
          { revision: 1, reason: "No decision yet" },
          c.s,
        )
      ).status,
      409,
    );
    const proposal = await h.call(
      c.admin + "/proposals",
      {
        outcome: "refer",
        reason: "Document incomplete; internal referral only",
      },
      c.o,
    );
    assert.equal(proposal.status, 201);
    assert.equal(
      (
        await h.call(
          c.admin + "/confirm",
          {
            entity: proposal.body.entity,
            revision: 1,
            reason: "Separate referral review",
          },
          c.s,
        )
      ).status,
      201,
    );
    const ops = (await h.call(c.root + "/operations", undefined, c.s)).body;
    assert.equal(
      (
        await h.call(
          c.admin + "/close",
          { revision: ops.revision, reason: "Assigned officer cannot close" },
          c.o,
        )
      ).status,
      403,
    );
    const closes = await Promise.all(
      [1, 2].map(() =>
        h.call(
          c.admin + "/close",
          {
            revision: ops.revision,
            reason: "Close this internal referral record",
          },
          c.s,
        ),
      ),
    );
    assert.deepEqual(closes.map((r) => r.status).sort(), [201, 409]);
    assert.equal(
      (await h.call(c.root + "/operations", undefined, c.s)).body.stage,
      "closed",
    );
    assert.equal(
      (
        await h.call(
          c.admin + "/proposals",
          { outcome: "refer", reason: "Closed case mutation" },
          c.o,
        )
      ).status,
      409,
    );
    const after = (await h.call(c.admin, undefined, c.s)).body;
    assert.equal(
      (
        await h.call(
          c.admin + "/reopen",
          {
            revision: after.workflow.revision,
            reason: "Explicit new review of retained evidence",
          },
          c.s,
        )
      ).status,
      201,
    );
    const reopened = (await h.call(c.admin, undefined, c.o)).body;
    assert.equal(reopened.workflow.stage, "reevaluation_required");
    assert.equal(reopened.decisions[0].current, false);
    assert.equal(reopened.externalRelease, "NOT_CONFIRMED");
    assert.equal(
      (await h.call(c.root, undefined, c.a)).body.domain.obligation.status,
      "registered",
    );
  } finally {
    await h.close();
  }
});
test("stale proposal recovers through guarded re-evaluation and review without deleting earlier history", async () => {
  const h = await harness(options);
  try {
    const c = await setup(h),
      proposal = await h.call(
        c.admin + "/proposals",
        { outcome: "refer", reason: "Original internal referral" },
        c.o,
      );
    assert.equal(proposal.status, 201);
    const current = (await h.call(c.root, undefined, c.a)).body;
    assert.equal(
      (
        await h.call(
          c.root + "/corrections",
          {
            instrument: { ...instrument, amountPaise: 13000000 },
            revision: current.revision,
            reason: "Correct factual declaration after proposal",
          },
          c.a,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await h.call(
          c.admin + "/confirm",
          {
            entity: proposal.body.entity,
            revision: 1,
            reason: "Stale source test",
          },
          c.s,
        )
      ).status,
      409,
    );
    for (const action of ["reevaluate", "ready", "review"]) {
      const state = (await h.call(c.root + "/operations", undefined, c.o)).body;
      assert.equal(
        (
          await h.call(
            c.root + "/operations",
            {
              action,
              revision: state.revision,
              inputRevision: state.input_revision,
              reason: "Renewed review after changed evidence",
            },
            c.o,
          )
        ).status,
        200,
      );
    }
    assert.equal(
      (
        await h.call(
          c.admin + "/proposals",
          { outcome: "refer", reason: "New referral of current evidence" },
          c.o,
        )
      ).status,
      201,
    );
    const proposals = (await h.call(c.admin, undefined, c.o)).body.proposals;
    assert.equal(proposals.length, 2);
    assert.equal(proposals[0].current, false);
    assert.equal(proposals[1].current, true);
  } finally {
    await h.close();
  }
});
test("opt-in clearance follow-up is source-bound, deduplicated and stops after a department response", async () => {
  const h = await harness(options);
  try {
    const c = await setup(h),
      r = await request(h, c);
    assert.equal(
      (
        await h.call(
          c.root + "/reminders",
          {
            windows: [0],
            categories: ["clearance_delay"],
            enabled: true,
            revision: 0,
          },
          c.o,
        )
      ).status,
      200,
    );
    const run = () =>
      runReminderBatch(h.app.db, {
        asOf: new Date().toISOString().slice(0, 10),
      });
    assert.equal(run().delivered, 1);
    assert.equal(run().delivered, 0);
    const delivery = h.app.db
      .prepare(
        "SELECT * FROM reminder_deliveries WHERE category='clearance_delay'",
      )
      .get();
    assert.equal(JSON.parse(delivery.context).source.requestEventId, r.id);
    assert.equal((await accept(h, c, r)).status, 201);
    assert.equal(run().matchedConditions, 0);
  } finally {
    await h.close();
  }
});
test("schema 16 is additive and repeatable over frozen schema 15 without changing source versions or evaluations", () => {
  const f = migrationFixture(15);
  try {
    const before = f.snapshot();
    migrate(f.db, f.dir);
    migrate(f.db, f.dir);
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
    assert(readdirSync(f.dir).some((p) => p.startsWith("pre-migration-16-")));
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM clearance_events").get().n,
      0,
    );
  } finally {
    f.close();
  }
});
test("reassignment revokes the old department view and renewed grants cannot revive an older response", async () => {
  const h = await harness(options);
  try {
    const c = await setup(h),
      original = await request(h, c),
      endpoint = "/clearance/requests/" + encodeURIComponent(original.entity);
    assert.equal(
      (
        await h.call(
          "/clearance/grants",
          {
            department: "academic",
            userId: "o",
            enabled: true,
            revision: 0,
            reason: "Authorized replacement reviewer",
          },
          c.s,
        )
      ).status,
      201,
    );
    const reassigned = await h.call(
      c.admin + "/requests",
      {
        requirementId: "academic",
        reviewer: "o",
        documentVersionIds: [c.versionId],
        revision: 1,
        reason: "Reassign selected review",
      },
      c.o,
    );
    assert.equal(reassigned.status, 201);
    assert.equal((await h.call(endpoint, undefined, c.p)).status, 404);
    assert.equal((await h.call(endpoint, undefined, c.o)).body.current, true);
    assert.equal(
      (
        await h.call(
          "/clearance/grants",
          {
            department: "academic",
            userId: "o",
            enabled: false,
            revision: 1,
            reason: "Permission revoked",
          },
          c.s,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await h.call(
          "/clearance/grants",
          {
            department: "academic",
            userId: "o",
            enabled: true,
            revision: 2,
            reason: "New permission requires new assignment",
          },
          c.s,
        )
      ).status,
      201,
    );
    assert.equal((await h.call(endpoint, undefined, c.o)).body.current, false);
    assert.equal(
      (
        await h.call(
          endpoint,
          {
            status: "accepted",
            revision: 2,
            reason: "Old assignment must remain stale",
          },
          c.o,
        )
      ).status,
      409,
    );
  } finally {
    await h.close();
  }
});
async function setup(h) {
  const a = await h.login("a"),
    o = await h.login("o"),
    p = await h.login("p"),
    s = await h.login("s"),
    id = await h.create(a);
  const root = "/cases/" + id,
    admin = "/clearance/cases/" + id;
  const upload = await h.call(
    root + "/documents",
    {
      mime: "text/plain",
      base64: Buffer.from(
        "Reference: " +
          instrument.reference +
          "\nDeposit Amount: INR 125000\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssue Date: 2026-01-01\nMaturity Date: 2031-01-01",
      ).toString("base64"),
    },
    a,
  );
  assert.equal(upload.status, 201);
  assert.equal((await h.call(root + "/process", {}, a)).status, 200);
  for (const [action, auth] of [
    ["submit", a],
    ["intake", o],
    ["ready", o],
    ["review", o],
  ]) {
    const ops = (await h.call(root + "/operations", undefined, auth)).body;
    assert.equal(
      (
        await h.call(
          root + "/operations",
          {
            action,
            revision: ops.revision,
            inputRevision: ops.input_revision,
            reason: "Synthetic review transition",
          },
          auth,
        )
      ).status,
      200,
    );
  }
  assert.equal(
    (
      await h.call(
        "/clearance/activations",
        {
          version: procedure.version,
          scope: procedure.scope,
          revision: 0,
          reason: "Activate fictional test procedure",
        },
        s,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await h.call(
        admin + "/bind",
        {
          scope: procedure.scope,
          revision: 0,
          reason: "Bind synthetic review",
        },
        o,
      )
    ).status,
    201,
  );
  for (const department of ["academic", "coordination"])
    assert.equal(
      (
        await h.call(
          "/clearance/grants",
          {
            department,
            userId: "p",
            enabled: true,
            revision: 0,
            reason: "Synthetic department assignment",
          },
          s,
        )
      ).status,
      201,
    );
  const versions = (await h.call(root + "/viewer/versions", undefined, a)).body
    .items;
  return { a, o, p, s, id, root, admin, versionId: versions[0].id };
}
async function request(h, c, requirementId = "academic", revision = 0) {
  const r = await h.call(
    c.admin + "/requests",
    {
      requirementId,
      reviewer: "p",
      documentVersionIds: requirementId === "academic" ? [c.versionId] : [],
      revision,
      reason: "Please review selected synthetic evidence",
    },
    c.o,
  );
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function accept(h, c, r, status = "accepted") {
  return h.call(
    "/clearance/requests/" + encodeURIComponent(r.entity),
    {
      status,
      revision: r.revision,
      reason: "Independent synthetic department response",
    },
    c.p,
  );
}
test("department grants expose selected immutable sources without full case access; revocation and tenants fail closed", async () => {
  const h = await harness(options);
  try {
    const c = await setup(h),
      r = await request(h, c),
      b = await h.login("b"),
      x = await h.login("x"),
      auditor = await h.login("r");
    assert.equal((await h.call(c.root, undefined, c.p)).status, 404);
    const endpoint = "/clearance/requests/" + encodeURIComponent(r.entity);
    assert.equal((await h.call(endpoint, undefined, c.p)).status, 200);
    assert.equal((await h.call(endpoint, undefined, b)).status, 403);
    for (const auth of [x, c.o])
      assert.equal((await h.call(endpoint, undefined, auth)).status, 404);
    const selected = await fetch(
      h.base + "/api" + endpoint + "/documents/" + c.versionId,
      { headers: c.p },
    );
    assert.equal(selected.status, 200);
    assert.match(await selected.text(), /PHASE12-TEST/);
    assert.equal((await h.call(c.admin, undefined, b)).status, 404);
    assert.equal(
      (
        await h.call(
          c.admin + "/requests",
          { requirementId: "academic" },
          auditor,
        )
      ).status,
      403,
    );
    assert.equal(
      (await h.call("/clearance/queue", undefined, c.p)).body.items.length,
      1,
    );
    const institution = (await h.call(c.admin, undefined, c.a)).body;
    assert.equal(institution.requests, undefined);
    assert.equal(institution.snapshot, undefined);
    assert.equal(JSON.stringify(institution).includes("Please review"), false);
    assert.equal(
      (
        await h.call(
          "/clearance/grants",
          {
            department: "academic",
            userId: "p",
            enabled: false,
            revision: 1,
            reason: "Revoke synthetic assignment",
          },
          c.s,
        )
      ).status,
      201,
    );
    assert.equal((await h.call(endpoint, undefined, c.p)).status, 404);
    assert.equal((await accept(h, c, r)).status, 404);
    assert.equal(
      (await h.call("/clearance/queue", undefined, c.p)).body.items.length,
      0,
    );
    assert.throws(() =>
      h.app.db.prepare("UPDATE clearance_events SET action='tampered'").run(),
    );
    assert.throws(() => h.app.db.prepare("DELETE FROM clearance_events").run());
  } finally {
    await h.close();
  }
});
test("parallel clearances, immutable responses and distinct concurrent checker record an internal synthetic decision only", async () => {
  const h = await harness(options);
  try {
    const c = await setup(h),
      first = await request(h, c),
      parallel = await request(h, c, "parallel");
    assert.equal(
      (
        await h.call(
          c.admin + "/proposals",
          { outcome: "approve", reason: "Missing clearances" },
          c.o,
        )
      ).status,
      409,
    );
    const replies = await Promise.all([
      accept(h, c, first),
      accept(h, c, first),
    ]);
    assert.deepEqual(replies.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await accept(h, c, parallel)).status, 201);
    const ready = (await h.call(c.admin, undefined, c.o)).body;
    assert.equal(
      ready.readyForInternalReview,
      true,
      JSON.stringify(ready.blockers),
    );
    const proposal = await h.call(
      c.admin + "/proposals",
      { outcome: "approve", reason: "Synthetic internal documentary decision" },
      c.o,
    );
    assert.equal(proposal.status, 201, JSON.stringify(proposal.body));
    const body = {
      entity: proposal.body.entity,
      revision: 1,
      reason: "Distinct checker test review",
    };
    assert.equal((await h.call(c.admin + "/confirm", body, c.o)).status, 403);
    const checks = await Promise.all([
      h.call(c.admin + "/confirm", body, c.s),
      h.call(c.admin + "/confirm", body, c.s),
    ]);
    assert.deepEqual(checks.map((r) => r.status).sort(), [201, 409]);
    const decision = checks.find((r) => r.status === 201).body;
    assert.equal(decision.payload.externalRelease, "NOT_CONFIRMED");
    assert.equal(decision.payload.administrativeDecisionOnly, true);
    assert.equal(decision.payload.classification, "SYNTHETIC");
    assert.equal(
      (await h.call(c.root + "/operations", undefined, c.o)).body.stage,
      "decision_recorded",
    );
    const history = await h.call(
      c.admin + "/history?limit=2",
      undefined,
      await h.login("r"),
    );
    assert.equal(history.status, 200);
    assert.equal(history.body.items.length, 2);
    assert(history.body.nextCursor);
    const evidence = h.app.db
      .prepare("SELECT payload FROM clearance_events WHERE id=?")
      .get(proposal.body.id);
    assert.equal(
      JSON.parse(evidence.payload).snapshot.source.documents[0].sha256.length,
      64,
    );
  } finally {
    await h.close();
  }
});
test("withdrawal, source changes and procedure reactivation invalidate current clearances and stale proposals", async () => {
  const h = await harness(options);
  try {
    const c = await setup(h),
      r = await request(h, c);
    assert.equal((await accept(h, c, r, "rejected")).status, 201);
    assert(
      (await h.call(c.admin, undefined, c.o)).body.blockers.some(
        (b) => b.code === "REJECTED",
      ),
    );
    assert.equal(
      (
        await h.call(
          c.admin + "/withdraw",
          {
            entity: r.entity,
            revision: 2,
            reason: "Withdraw rejection for fresh request",
          },
          c.o,
        )
      ).status,
      201,
    );
    assert(
      (await h.call(c.admin, undefined, c.o)).body.blockers.some(
        (b) => b.code === "WITHDRAWN",
      ),
    );
    const fresh = await request(h, c, "academic", 3);
    const current = (await h.call(c.root, undefined, c.a)).body;
    assert.equal(
      (
        await h.call(
          c.root + "/corrections",
          {
            instrument: { ...instrument, amountPaise: 13000000 },
            revision: current.revision,
            reason: "Actual input revision invalidation",
          },
          c.a,
        )
      ).status,
      200,
    );
    assert.equal((await accept(h, c, fresh)).status, 409);
    assert(
      (await h.call(c.admin, undefined, c.o)).body.blockers.some(
        (b) => b.code === "STALE",
      ),
    );
    assert.equal(
      (
        await h.call(
          "/clearance/activations",
          {
            version: procedure.version,
            scope: procedure.scope,
            revision: 1,
            reason: "Explicit version reactivation",
          },
          c.s,
        )
      ).status,
      201,
    );
    assert(
      (await h.call(c.admin, undefined, c.o)).body.blockers.some(
        (b) => b.code === "STALE_PROCEDURE_BINDING",
      ),
    );
  } finally {
    await h.close();
  }
});
test("same-supervisor maker checker and unknown client procedure activation are rejected", async () => {
  const h = await harness(options);
  try {
    const c = await setup(h);
    const unknown = await h.call(
      "/clearance/activations",
      {
        version: "invented",
        scope: procedure.scope,
        revision: 1,
        reason: "Must not inject config",
        procedure: { classification: "VERIFIED" },
      },
      c.s,
    );
    assert.equal(unknown.status, 400);
    const proposal = await h.call(
      c.admin + "/proposals",
      {
        outcome: "refer",
        reason: "Refer incomplete evidence for further review",
      },
      c.s,
    );
    assert.equal(proposal.status, 201);
    assert.equal(
      (
        await h.call(
          c.admin + "/confirm",
          {
            entity: proposal.body.entity,
            revision: 1,
            reason: "Self-check attempt",
          },
          c.s,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await h.call(
          c.admin + "/confirm",
          {
            entity: proposal.body.entity,
            revision: 1,
            reason: "Cross-authority attempt",
          },
          await h.login("x"),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await h.call(
          "/clearance/activations",
          {
            version: procedure.version,
            scope: procedure.scope,
            revision: 1,
            reason: "Invalidate pending proposal",
          },
          c.s,
        )
      ).status,
      201,
    );
    // A distinct supervisor is created only within this disposable synthetic fixture.
    h.app.db.prepare("UPDATE users SET role='supervisor' WHERE id='p'").run();
    assert.equal(
      (
        await h.call(
          c.admin + "/confirm",
          {
            entity: proposal.body.entity,
            revision: 1,
            reason: "Stale procedure should block",
          },
          await h.login("p"),
        )
      ).status,
      409,
    );
  } finally {
    await h.close();
  }
});
