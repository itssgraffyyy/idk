import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPolicy } from "../src/policy.js";
const p = {
  version: "synthetic-1",
  scope: "synthetic-test",
  verification: "verified",
  source: "fictional:test-only",
  reviewReference: "test-fixture-review",
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  rules: [
    { id: "test-minimum", type: "minimum_amount", amountPaise: 100 },
    {
      id: "test-exemption",
      type: "exemption",
      proofType: "fictional-eligibility",
    },
  ],
};
test("effective dates and scope prevent unsupported policy selection", () => {
  for (const asOf of ["2025-12-31", "2027-01-01"])
    assert.equal(
      assessPolicy({}, { asOf, policies: [p], scope: "synthetic-test" }).status,
      "unconfirmed",
    );
  assert.equal(
    assessPolicy({}, { asOf: "2026-10-26", policies: [p], scope: "aicte" })
      .status,
    "unconfirmed",
  );
});
test("unverified rules and unsupported operators fail closed", () => {
  assert.equal(
    assessPolicy(
      {},
      {
        asOf: "2026-10-26",
        policies: [{ ...p, verification: "unverified" }],
        scope: "synthetic-test",
      },
    ).status,
    "unconfirmed",
  );
  const r = assessPolicy(
    {},
    {
      asOf: "2026-10-26",
      policies: [{ ...p, rules: [{ id: "x", type: "execute" }] }],
      scope: "synthetic-test",
    },
  );
  assert.equal(r.checks[0].status, "unresolved");
});
test("synthetic minimum and evidence-backed exemption retain explanation", () => {
  const run = (proofs) =>
    assessPolicy(
      { amountPaise: 50, proofs },
      { asOf: "2026-10-26", policies: [p], scope: "synthetic-test" },
    );
  assert.equal(run([]).checks[0].status, "review");
  assert.equal(
    run([
      { type: "fictional-eligibility", verified: false, evidenceId: "fake" },
    ]).checks[1].status,
    "unresolved",
  );
  assert.equal(
    run([
      {
        type: "fictional-eligibility",
        verified: true,
        evidenceId: "fixture-evidence",
      },
    ]).checks[1].status,
    "supported",
  );
});
