import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonical,
  snapshotHash,
  validateProcedure,
  clearanceReadiness,
} from "../src/clearance-procedure.js";
export const procedure = {
  version: "SYNTHETIC-CLEARANCE-1",
  scope: "synthetic-test",
  classification: "SYNTHETIC",
  source: "fictional:test-only; not an AICTE procedure",
  effectiveFrom: "2025-01-01",
  effectiveTo: "2035-12-31",
  requirements: [
    {
      id: "academic",
      label: "Synthetic academic review",
      department: "academic",
      mandatory: true,
      dependsOn: [],
      conditions: {},
      evidenceKinds: ["FDR"],
    },
    {
      id: "vigilance",
      label: "Synthetic vigilance review",
      department: "vigilance",
      mandatory: true,
      dependsOn: [],
      conditions: { government: false },
      evidenceKinds: ["SUPPORTING"],
    },
    {
      id: "final",
      label: "Synthetic coordinating review",
      department: "coordination",
      mandatory: true,
      dependsOn: ["academic", "vigilance"],
      conditions: {},
      evidenceKinds: [],
    },
    {
      id: "optional",
      label: "Optional advisory",
      department: "advisory",
      mandatory: false,
      dependsOn: [],
      conditions: {},
      evidenceKinds: [],
    },
  ],
};
const accepted = (requirementId, extra = {}) => ({
  requirementId,
  status: "accepted",
  current: true,
  ...extra,
});
const run = (overrides = {}) =>
  clearanceReadiness({
    procedure,
    asOf: "2026-10-27",
    facts: { government: false },
    ...overrides,
  });
test("bounded closed procedure schema rejects cycles, unknown facts, unsupported authority and invalid versions", () => {
  assert.deepEqual(validateProcedure(procedure), procedure);
  const mutate = (fn) => {
    const p = structuredClone(procedure);
    fn(p);
    assert.throws(() => validateProcedure(p));
  };
  mutate((p) => p.requirements[0].dependsOn.push("final"));
  mutate((p) => p.requirements[0].dependsOn.push("absent"));
  mutate((p) => (p.requirements[0].conditions.execute = "code"));
  mutate((p) => delete p.version);
  mutate((p) => delete p.requirements[0].department);
  mutate((p) => (p.effectiveTo = "2035-02-30"));
  mutate((p) => (p.classification = "ISSUER_VERIFIED"));
  mutate((p) => p.requirements.push(p.requirements[0]));
  mutate((p) => (p.requirements[0].evidenceKinds = ["anything"]));
  mutate((p) => (p.requirements = Array(51).fill(p.requirements[0])));
  const clone = validateProcedure(procedure);
  clone.requirements[0].label = "changed";
  assert.notEqual(clone.requirements[0].label, procedure.requirements[0].label);
});
test("parallel requests, conditional exemption and missing applicability facts explain exact mandatory blockers", () => {
  const missing = run();
  assert.equal(missing.items[0].status, "NOT_REQUESTED");
  assert.equal(missing.items[1].status, "NOT_REQUESTED");
  assert.equal(missing.items[2].status, "BLOCKED_PREREQUISITE");
  assert.equal(missing.blockers.length, 3);
  const unknown = run({ facts: {}, responses: [accepted("academic")] });
  assert.equal(unknown.items[1].status, "REVIEW_APPLICABILITY");
  assert.deepEqual(unknown.items[1].missingFacts, ["government"]);
  const exempt = run({
    facts: { government: true },
    responses: [accepted("academic"), accepted("final")],
  });
  assert.equal(exempt.items[1].status, "NOT_APPLICABLE");
  assert.equal(exempt.readyForInternalReview, true);
  assert.equal(exempt.items[3].status, "NOT_REQUESTED");
  assert.equal(exempt.administrativeApproval, false);
  assert.equal(exempt.externalRelease, "NOT_CONFIRMED");
  assert.equal(exempt.realRegulatoryAuthority, false);
});
test("rejected, withdrawn, pending and stale responses never satisfy dependent steps", () => {
  for (const status of ["rejected", "withdrawn", "pending"]) {
    const r = run({
      responses: [
        accepted("academic"),
        accepted("vigilance", { status }),
        accepted("final"),
      ],
    });
    assert.equal(r.readyForInternalReview, false);
    assert.equal(r.items[1].status, status.toUpperCase());
    assert.equal(r.items[2].status, "BLOCKED_PREREQUISITE");
  }
  const responses = [
    accepted("academic"),
    accepted("vigilance"),
    accepted("final"),
  ];
  assert.equal(run({ responses }).readyForInternalReview, true);
  assert.equal(
    run({
      responses: [
        accepted("academic", { current: false }),
        ...responses.slice(1),
      ],
    }).items[0].status,
    "STALE",
  );
  assert.equal(
    run({ responses, currentBinding: false }).blockers.at(-1).code,
    "STALE_PROCEDURE_BINDING",
  );
  assert.equal(
    run({ responses, asOf: "2040-01-01" }).blockers.at(-1).code,
    "PROCEDURE_OUTSIDE_EFFECTIVE_PERIOD",
  );
  assert.equal(
    run({
      responses,
      procedure: { ...procedure, classification: "UNVERIFIED_OFFICIAL" },
    }).blockers.at(-1).code,
    "OFFICIAL_PROCEDURE_UNVERIFIED",
  );
  assert.throws(() => run({ responses: [...responses, responses[0]] }));
});
test("canonical evidence snapshots are key-order independent and change with every bound fact", () => {
  assert.equal(
    canonical({ b: 2, a: [1, { d: true, c: false }] }),
    canonical({ a: [1, { c: false, d: true }], b: 2 }),
  );
  assert.equal(snapshotHash(procedure), run().procedureHash);
  assert.notEqual(
    snapshotHash(procedure),
    snapshotHash({ ...procedure, effectiveTo: "2034-12-31" }),
  );
  assert.throws(() => canonical({ bad: undefined }));
});
