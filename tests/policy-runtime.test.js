import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, validatePolicies } from "../src/policy-runtime.js";
import { harness, instrument } from "./support/harness.js";
import { replayPolicySnapshot } from "../src/policy-replay.js";
test("frozen replay restores nested regulatory context rather than current context or its envelope", async () => {
  const conditional = {
    ...policy,
    rules: [
      {
        id: "private-minimum",
        type: "minimum_amount",
        amountPaise: 20000000,
        conditions: { ownership: "private" },
      },
    ],
  };
  const h = await harness({
    policies: [conditional],
    policyScope: "synthetic-test",
  });
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      root = "/cases/" + id;
    let c = (await h.call(root, undefined, a)).body;
    assert.equal(
      (
        await h.call(
          root + "/regulatory-context",
          {
            context: { ownership: "private", programme: "engineering" },
            revision: c.revision,
          },
          a,
        )
      ).status,
      201,
    );
    const frozen = h.app.db
      .prepare(
        "SELECT id FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
      )
      .get(id).id;
    c = (await h.call(root, undefined, a)).body;
    assert.equal(
      (
        await h.call(
          root + "/regulatory-context",
          {
            context: { ownership: "government", programme: "engineering" },
            revision: c.revision,
          },
          a,
        )
      ).status,
      201,
    );
    const config = { policies: [conditional], scope: "synthetic-test" };
    const replay = replayPolicySnapshot(
      h.app.db,
      id,
      frozen,
      "2026-01-01",
      config,
    );
    assert.equal(replay.operationalPolicy.outcome, "NON_COMPLIANT");
    assert.equal(replay.operationalPolicy.checks[0].outcome, "NON_COMPLIANT");
    const latest = h.app.db
      .prepare(
        "SELECT id FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
      )
      .get(id).id;
    assert.equal(
      replayPolicySnapshot(h.app.db, id, latest, "2026-01-01", config)
        .operationalPolicy.outcome,
      "NOT_APPLICABLE",
    );
  } finally {
    await h.close();
  }
});
const policy = {
  version: "SYNTHETIC-2025",
  scope: "synthetic-test",
  classification: "SYNTHETIC",
  source: "fictional:test-only",
  reviewReference: "automated-fixture-review",
  verification: "verified",
  effectiveFrom: "2025-01-01",
  effectiveTo: "2027-12-31",
  rules: [
    {
      id: "minimum",
      type: "minimum_amount",
      amountPaise: 10000000,
      severity: "HIGH",
    },
  ],
};
test("trusted declarative versions select deterministically and map all outcomes without administrative approval", () => {
  assert.throws(() =>
    validatePolicies([{ ...policy, effectiveFrom: "2025-02-30" }]),
  );
  const run = (facts = {}, p = [policy], asOf = "2026-01-01") =>
    evaluatePolicy(facts, {
      policies: validatePolicies(p),
      scope: "synthetic-test",
      asOf,
    });
  assert.equal(run({ amountPaise: 10000000 }).outcome, "COMPLIANT");
  assert.equal(run({ amountPaise: 99 }).outcome, "NON_COMPLIANT");
  assert.equal(run().outcome, "INSUFFICIENT_EVIDENCE");
  assert.equal(run({}, [policy], "2024-12-31").outcome, "NOT_APPLICABLE");
  assert.equal(
    run({}, [{ ...policy, verification: "unverified" }]).outcome,
    "UNVERIFIED_POLICY",
  );
  assert.equal(
    run({}, [{ ...policy, rules: [{ id: "unknown", type: "execute-code" }] }])
      .outcome,
    "NEEDS_HUMAN_REVIEW",
  );
  const next = {
    ...policy,
    version: "SYNTHETIC-2026",
    effectiveFrom: "2026-01-01",
    rules: [{ id: "minimum", type: "minimum_amount", amountPaise: 20000000 }],
  };
  assert.equal(
    run({ amountPaise: 12500000 }, [policy, { ...next, active: false }])
      .version,
    policy.version,
  );
  assert.equal(
    run({ amountPaise: 12500000 }, [policy, next]).version,
    next.version,
  );
  assert.equal(
    run({ amountPaise: 12500000 }, [policy], "2025-01-01").outcome,
    "COMPLIANT",
  );
  assert.equal(
    run({ amountPaise: 12500000 }, [policy], "2027-12-31").outcome,
    "COMPLIANT",
  );
  assert.equal(
    run({ amountPaise: 15000000 }, [policy, next]).version,
    next.version,
  );
  assert.equal(
    run({ amountPaise: 15000000 }, [policy, next], "2025-12-31").version,
    policy.version,
  );
  const ex = {
    ...policy,
    rules: [
      ...policy.rules,
      {
        id: "exemption",
        type: "exemption",
        proofType: "synthetic-proof",
        exempts: ["minimum"],
      },
    ],
  };
  assert.equal(
    run(
      {
        amountPaise: 1,
        proofs: [
          {
            type: "synthetic-proof",
            decision: "accepted",
            documentId: "test-proof",
          },
        ],
      },
      [ex],
    ).outcome,
    "COMPLIANT",
  );
  assert.equal(run({ amountPaise: 999999999 }).administrativeApproval, false);
  assert.equal(run({ amountPaise: 999999999 }).realRegulatoryAuthority, false);
  assert.equal(
    run({ amountPaise: 999999999 }, [
      {
        ...policy,
        classification: "OFFICIAL",
        issuerConfirmed: true,
        sourceSHA256: "invented",
      },
    ]).outcome,
    "UNVERIFIED_POLICY",
  );
  assert.throws(() =>
    validatePolicies([
      {
        ...policy,
        rules: [{ id: "bad", type: "minimum_amount", amountPaise: 1.2 }],
      },
    ]),
  );
});
test("historical replay is persisted independently and cannot activate policy from client data", async () => {
  const h = await harness({
    policies: [policy],
    policyScope: "synthetic-test",
  });
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      id = await h.create(a),
      path = "/cases/" + id;
    const before = (await h.call(path, undefined, a)).body.history
      .filter((e) => e.kind === "evaluation")
      .at(-1);
    assert.equal(
      (
        await h.call(
          path + "/policy-evaluate",
          { asOf: "2025-07-01", policies: [{ verification: "verified" }] },
          a,
        )
      ).status,
      403,
    );
    const replay = await h.call(
      path + "/policy-evaluate",
      { asOf: "2025-07-01" },
      o,
    );
    assert.equal(replay.status, 201);
    const history = (await h.call(path, undefined, a)).body.history,
      record = history.find((e) => e.id === replay.body.evaluationId);
    assert.equal(record.kind, "evaluation_replay");
    assert.equal(record.payload.operationalPolicy.version, policy.version);
    assert.equal(
      record.payload.operationalPolicy.administrativeApproval,
      false,
    );
    assert.equal(
      history.filter((e) => e.kind === "evaluation").at(-1).id,
      before.id,
    );
    assert(
      record.payload.findings.every((f) =>
        ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(f.severity),
      ),
    );
    assert.equal(
      (
        await h.call(
          path + "/corrections",
          {
            instrument: { ...instrument, amountPaise: 100 },
            revision: 1,
            reason: "Test frozen replay after correction",
          },
          a,
        )
      ).status,
      200,
    );
    const currentId = (
      await h.call(path, undefined, a)
    ).body.currentEvidence.find((e) => e.kind === "evaluation").id;
    const frozen = await h.call(
      path + "/policy-evaluate",
      { asOf: "2025-07-01", evaluationId: before.id },
      o,
    );
    assert.equal(frozen.status, 201);
    const frozenRecord = JSON.parse(
      h.app.db
        .prepare("SELECT payload FROM evidence WHERE id=?")
        .get(frozen.body.evaluationId).payload,
    );
    assert.equal(frozenRecord.replayMode, "FROZEN_FACTS_POLICY_ONLY");
    assert.equal(frozenRecord.sources.instrument.amountPaise, 12500000);
    assert.equal(frozenRecord.operationalPolicy.outcome, "COMPLIANT");
    assert.equal(
      (await h.call(path, undefined, a)).body.currentEvidence.find(
        (e) => e.kind === "evaluation",
      ).id,
      currentId,
    );
  } finally {
    await h.close();
  }
});
