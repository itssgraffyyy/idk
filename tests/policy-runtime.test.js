import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, validatePolicies } from "../src/policy-runtime.js";
import { harness, instrument } from "./support/harness.js";
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
  } finally {
    await h.close();
  }
});
