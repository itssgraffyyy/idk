import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, instrument } from "./support/harness.js";
import {
  syntheticPolicy,
  syntheticProcedure,
} from "./support/clearance-fixtures.js";
import { snapshotHash } from "../src/clearance-procedure.js";
import { runScenario } from "../src/scenario-analysis.js";
import { evidenceRelationships } from "../src/evidence-relationships.js";
const data = {
  ...instrument,
  currency: "INR",
  type: "FDR",
  depositor: "Synthetic Trust",
  institutionName: "Synthetic College",
};
const changes = {
  asOf: "2026-10-27",
  starts: "2026-01-01",
  ends: "2032-01-01",
};
const persistentTables = [
  "cases",
  "evidence",
  "documents",
  "document_versions",
  "obligations",
  "instruments",
  "case_operations",
  "case_domains",
  "case_instruments",
  "instrument_relationships",
  "clearance_events",
  "policy_capsules",
];
function operationalHash(db) {
  return snapshotHash(
    Object.fromEntries(
      persistentTables.map((t) => [
        t,
        db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all(),
      ]),
    ),
  );
}
test("source version disagreements, concurrent sponsor revisions and corrupted replacement cycles remain reviewable", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      admin = await h.login("admin"),
      id = await h.create(a, { instrument: data }),
      path = "/cases/" + id;
    for (const amount of [125000, 130000]) {
      const body = {
        mime: "text/plain",
        base64: Buffer.from(
          "Reference: PHASE12-TEST\nDeposit Amount: INR " +
            amount +
            "\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssue Date: 2026-01-01\nMaturity Date: 2031-01-01",
        ).toString("base64"),
      };
      assert.equal((await h.call(path + "/documents", body, a)).status, 201);
      assert.equal((await h.call(path + "/process", {}, a)).status, 200);
    }
    let graph = (await h.call(path + "/relationships", undefined, a)).body;
    assert.ok(
      graph.signals.some((s) => s.code === "DOCUMENT_VERSION_FACT_CONFLICT"),
    );
    assert.ok(
      graph.links.some((l) => l.relationship === "supported_by_source"),
    );
    const claim = {
      revision: 0,
      name: "Concurrent Trust",
      jurisdiction: "IN",
      registration: "SYNTHETIC",
      sourceReference: "Test only declaration",
    };
    const results = await Promise.all([
      h.call(path + "/legal-entity", claim, admin),
      h.call(path + "/legal-entity", claim, admin),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const link = h.app.db
      .prepare("SELECT * FROM case_domains WHERE case_id=?")
      .get(id);
    h.app.db
      .prepare(
        "INSERT INTO instruments(id,tenant,obligation_id,data) VALUES(?,?,?,?)",
      )
      .run(
        "synthetic-successor",
        "college-a",
        link.obligation_id,
        JSON.stringify({
          ...data,
          reference: "NEXT",
          issued: "2032-01-01",
          matures: "2033-01-01",
        }),
      );
    h.app.db
      .prepare("INSERT INTO case_instruments VALUES(?,?)")
      .run(id, "synthetic-successor");
    const insert = h.app.db.prepare(
      "INSERT INTO instrument_relationships VALUES(?,?,?,?,?)",
    );
    insert.run(
      link.instrument_id,
      "synthetic-successor",
      "Test replacement",
      "a",
      new Date().toISOString(),
    );
    assert.throws(
      () =>
        insert.run(
          "synthetic-successor",
          link.instrument_id,
          "Test cycle",
          "a",
          new Date().toISOString(),
        ),
      /cyclic/,
    );
    // Deliberate synthetic corruption checks the reader too; normal writes remain guarded.
    h.app.db.exec("DROP TRIGGER instrument_relationship_guard");
    insert.run(
      "synthetic-successor",
      link.instrument_id,
      "Deliberate fixture corruption",
      "a",
      new Date().toISOString(),
    );
    graph = (await h.call(path + "/relationships", undefined, a)).body;
    for (const code of ["CYCLIC_REPLACEMENT", "REPLACEMENT_TIMING_CONFLICT"])
      assert.ok(
        graph.signals.some((s) => s.code === code),
        code,
      );
  } finally {
    await h.close();
  }
});
test("hypothetical clearance assumptions retain source trust and do not resolve administrative evidence blockers", () => {
  const snapshot = {
    domain: { instrument_id: "one" },
    obligation: { amount_paise: 10000000 },
    instruments: [{ id: "one", data }],
    documents: [],
    evidenceReferences: [],
    policyFacts: { context: {}, proofs: [] },
    capsule: {
      sha256: "synthetic-config",
      configuration: { policies: [syntheticPolicy], scope: "synthetic-test" },
    },
    clearance: {
      procedure: syntheticProcedure,
      responses: [],
      readiness: { blockers: [{ code: "SOURCE_FDR_DOCUMENT_MISSING" }] },
    },
  };
  const result = runScenario(snapshot, {
    ...changes,
    clearances: [
      { requirementId: "academic", status: "accepted" },
      { requirementId: "parallel", status: "accepted" },
    ],
  });
  assert.equal(result.clearance.readyForInternalReview, true);
  assert.ok(
    result.recordedAdministrativeBlockers.some(
      (b) => b.code === "SOURCE_FDR_DOCUMENT_MISSING",
    ),
  );
  assert.equal(result.administrativeApproval, false);
  assert.equal(result.baseline.clearance.readyForInternalReview, false);
  assert.throws(
    () =>
      runScenario(snapshot, {
        ...changes,
        clearances: [{ requirementId: "invented", status: "accepted" }],
      }),
    /Unknown/,
  );
  snapshot.clearance.procedure = {
    ...syntheticProcedure,
    classification: "UNVERIFIED_OFFICIAL",
  };
  assert.ok(
    runScenario(snapshot, {
      ...changes,
      clearances: [
        { requirementId: "academic", status: "accepted" },
        { requirementId: "parallel", status: "accepted" },
      ],
    }).clearance.blockers.some(
      (b) => b.code === "OFFICIAL_PROCEDURE_UNVERIFIED",
    ),
  );
});
test("authorized relationships detect conflicts, legitimate repeated bytes and declared multi-institution sponsor without privacy expansion", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      admin = await h.login("admin"),
      b = await h.login("b"),
      o = await h.login("o"),
      p = await h.login("p"),
      s = await h.login("s");
    const root = await h.create(a, { instrument: data }),
      other = await h.create(b, {
        instrument: {
          ...data,
          amountPaise: 13000000,
          depositor: "Other Holder",
        },
      });
    const path = "/cases/" + root;
    const claim = {
      revision: 0,
      name: "Example Trust",
      jurisdiction: "IN",
      registration: "SYNTHETIC-123",
      sourceReference: "Self-declaration test fixture only",
    };
    assert.equal((await h.call(path + "/legal-entity", claim, a)).status, 403);
    assert.equal(
      (await h.call(path + "/legal-entity", claim, admin)).status,
      201,
    );
    assert.equal(
      (await h.call(path + "/legal-entity", claim, admin)).status,
      409,
    );
    // Test-only role elevation of the second institution. No operational access follows from a claim.
    h.app.db
      .prepare("UPDATE users SET role='institution_admin' WHERE id='b'")
      .run();
    const badmin = await h.login("b");
    assert.equal(
      (await h.call("/cases/" + other + "/legal-entity", claim, badmin)).status,
      201,
    );
    const upload = {
      mime: "text/plain",
      base64: Buffer.from(
        "Reference: PHASE12-TEST\nAmount: INR 125000",
      ).toString("base64"),
    };
    for (const [id, auth] of [
      [root, a],
      [other, badmin],
    ])
      assert.equal(
        (await h.call("/cases/" + id + "/documents", upload, auth)).status,
        201,
      );
    let graph = (await h.call(path + "/relationships", undefined, a)).body;
    assert.ok(!JSON.stringify(graph).includes(other));
    assert.ok(!graph.signals.some((x) => x.code === "CONFLICTING_AMOUNT"));
    assert.equal(
      (await h.call(path + "/relationships", undefined, p)).status,
      404,
    );
    graph = (await h.call(path + "/relationships", undefined, s)).body;
    for (const code of [
      "CONFLICTING_AMOUNT",
      "CONFLICTING_HOLDER",
      "RELATED_OBLIGATIONS",
      "REPEATED_DOCUMENT_BYTES",
      "SHARED_DECLARED_SPONSOR",
    ])
      assert.ok(
        graph.signals.some((x) => x.code === code),
        code,
      );
    assert.ok(
      graph.signals.every(
        (x) => x.classification === "REVIEW_SIGNAL_NOT_FRAUD",
      ),
    );
    assert.ok(
      graph.nodes.some(
        (n) =>
          n.type === "legal_entity" &&
          n.classification === "INSTITUTION_DECLARED_UNVERIFIED",
      ),
    );
    const read = await h.call(path + "/relationships", undefined, o);
    assert.equal(read.status, 200);
    h.app.db.prepare("UPDATE cases SET assigned='p' WHERE id=?").run(other);
    graph = (await h.call(path + "/relationships", undefined, o)).body;
    assert.ok(!JSON.stringify(graph).includes(other));
    assert.equal(
      h.app.db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='relationships_read' AND case_id=?",
        )
        .get(root).n,
      4,
    );
    assert.throws(
      () =>
        h.app.db.prepare("UPDATE legal_entity_claims SET payload='{}'").run(),
      /immutable/,
    );
  } finally {
    await h.close();
  }
});
test("scenario API freezes inputs, rejects stale capture, preserves operational rows and reproduces after changes with access rechecked", async () => {
  const h = await harness({
    policies: [syntheticPolicy],
    policyScope: "synthetic-test",
  });
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      r = await h.login("r"),
      o = await h.login("o");
    const id = await h.create(a, { instrument: data }),
      path = "/cases/" + id;
    const ops = (await h.call(path + "/operations", undefined, a)).body;
    assert.equal(
      (await h.call(path + "/analysis/snapshots", { inputRevision: 999 }, a))
        .status,
      409,
    );
    assert.equal(
      (
        await h.call(
          path + "/analysis/snapshots",
          { inputRevision: ops.input_revision },
          r,
        )
      ).status,
      403,
    );
    const before = operationalHash(h.app.db);
    const snap = await h.call(
      path + "/analysis/snapshots",
      { inputRevision: ops.input_revision },
      a,
    );
    assert.equal(snap.status, 201, JSON.stringify(snap.body));
    const run = await h.call(
      path + "/analysis/scenarios",
      { snapshotId: snap.body.id, changes },
      a,
    );
    assert.equal(run.status, 201, JSON.stringify(run.body));
    assert.equal(operationalHash(h.app.db), before);
    assert.equal(run.body.payload.result.bankRelease, false);
    assert.equal(run.body.payload.result.administrativeApproval, false);
    assert.ok(
      run.body.payload.result.missingEvidence.includes("SOURCE_FDR_DOCUMENT"),
    );
    assert.ok(
      run.body.payload.result.continuity.segments.some(
        (x) => x.status === "POTENTIAL_DECLARED_SHORTFALL",
      ),
    );
    assert.equal(
      (
        await h.call(
          path + "/analysis/scenarios",
          {
            snapshotId: snap.body.id,
            changes: { ...changes, amountPaise: 1.5 },
          },
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call(
          path + "/analysis/scenarios",
          {
            snapshotId: snap.body.id,
            changes: {
              ...changes,
              updates: [
                { id: snap.body.payload.domain.instrument_id, currency: "USD" },
              ],
            },
          },
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call(
          path + "/analysis/scenarios",
          {
            snapshotId: snap.body.id,
            changes: { ...changes, provider: "CONFIRMED" },
          },
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call(
          path + "/analysis/scenarios",
          {
            snapshotId: snap.body.id,
            changes: { ...changes, policyVersion: "attacker" },
          },
          a,
        )
      ).status,
      400,
    );
    h.app.db.prepare("UPDATE cases SET revision=revision+1 WHERE id=?").run(id);
    const replay = await h.call(
      path + "/analysis/records/" + run.body.id + "/replay",
      undefined,
      a,
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.reproduced, true);
    assert.deepEqual(replay.body.result, run.body.payload.result);
    assert.equal(
      (await h.call(path + "/analysis/records/" + run.body.id, undefined, b))
        .status,
      404,
    );
    assert.equal(
      (await h.call(path + "/analysis/records/" + run.body.id, undefined, r))
        .status,
      200,
    );
    const page = (
      await h.call(path + "/analysis/history?limit=1", undefined, a)
    ).body;
    assert.equal(page.items.length, 1);
    assert.ok(page.nextCursor);
    assert.equal(page.items[0].payload, undefined);
    h.app.db.prepare("UPDATE cases SET assigned='p' WHERE id=?").run(id);
    assert.equal(
      (await h.call(path + "/analysis/records/" + run.body.id, undefined, o))
        .status,
      404,
    );
    assert.throws(
      () => h.app.db.prepare("DELETE FROM analysis_records").run(),
      /immutable/,
    );
  } finally {
    await h.close();
  }
});
test("pure simulation forbids pooling and counts duplicate identities once, retains effective policy dates and missing facts", () => {
  const snapshot = {
    domain: { instrument_id: "one" },
    obligation: { amount_paise: 20000000 },
    instruments: [{ id: "one", data }],
    documents: [],
    evidenceReferences: [],
    policyFacts: { context: { programme: "Engineering" }, proofs: [] },
    capsule: {
      sha256: "test",
      configuration: {
        policies: [syntheticPolicy],
        scope: "synthetic-test",
        verifiedSourceHashes: [],
      },
    },
    clearance: {
      procedure: null,
      responses: [],
      readiness: { blockers: [{ code: "PROCEDURE_NOT_BOUND" }] },
    },
  };
  const result = runScenario(snapshot, {
    ...changes,
    add: [{ ...data, reference: "SECOND" }],
  });
  assert.equal(result.continuity.pooling, "DISALLOWED");
  assert.ok(
    result.continuity.segments.every(
      (s) => s.status !== "POTENTIAL_DECLARED_COVERAGE",
    ),
  );
  const duplicate = runScenario(snapshot, { ...changes, add: [data] });
  assert.ok(
    duplicate.continuity.issues.some(
      (i) => i.code === "DUPLICATE_COUNTED_ONCE",
    ),
  );
  const conflict = runScenario(snapshot, {
    ...changes,
    add: [{ ...data, amountPaise: 100 }],
  });
  assert.ok(
    conflict.continuity.issues.some((i) => i.code === "CONFLICTING_DUPLICATE"),
  );
  const removal = runScenario(snapshot, { ...changes, remove: ["one"] });
  assert.ok(removal.missingEvidence.includes("PRIMARY_INSTRUMENT_REMOVED"));
  assert.equal(removal.policy.outcome, "INSUFFICIENT_EVIDENCE");
  const outside = runScenario(snapshot, { ...changes, asOf: "2200-01-01" });
  assert.notEqual(outside.policy.outcome, "COMPLIANT");
  assert.deepEqual(snapshot.instruments, [{ id: "one", data }]);
});
test("relationship expansion fails explicitly for large authorized scope and never substitutes a partial clean result", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      root = h.app.db.prepare("SELECT * FROM cases WHERE id=?").get(id);
    const insert = h.app.db.prepare(
      "INSERT INTO cases(id,tenant,assigned,name,obligation,instrument) VALUES(?,?,?,?,?,?)",
    );
    h.app.db.exec("BEGIN");
    for (let i = 0; i < 500; i++)
      insert.run(
        "synthetic-" + i,
        root.tenant,
        root.assigned,
        "Bounded synthetic",
        root.obligation,
        root.instrument,
      );
    h.app.db.exec("COMMIT");
    assert.throws(
      () =>
        evidenceRelationships(
          h.app.db,
          { id: "a", role: "institution", tenant: root.tenant },
          root,
        ),
      /exceeds 500 authorized/,
    );
    const response = await h.call(
      "/cases/" + id + "/relationships",
      undefined,
      a,
    );
    assert.equal(response.status, 413);
  } finally {
    await h.close();
  }
});
