import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harness, instrument } from "./support/harness.js";
import {
  resolveApplicability,
  evaluateApplicablePolicy,
} from "../src/applicability.js";
import {
  syntheticPolicy,
  syntheticProcedure,
} from "./support/clearance-fixtures.js";
import { clarificationTemplate } from "../src/operations.js";
import { replayPolicySnapshot } from "../src/policy-replay.js";
import { runScenario } from "../src/scenario-analysis.js";
import { clearanceService } from "../src/clearance-service.js";
const policy = {
  ...syntheticPolicy,
  rules: [
    {
      ...syntheticPolicy.rules[0],
      conditions: { programme: "engineering", level: "ug" },
    },
  ],
};
test("programme and level contradictions are not silently resolved or treated as non-applicable conditions", () => {
  const registered = {
      id: "synthetic-obligation",
      revision: 2,
      programme: "pharmacy",
      level: "pg",
    },
    declared = { programme: "engineering", level: "ug", ownership: "private" },
    resolved = resolveApplicability(registered, declared);
  assert.equal(resolved.conflicts.length, 2);
  assert.equal(resolved.context.programme, undefined);
  assert.equal(resolved.context.level, undefined);
  assert.equal(declared.programme, "engineering");
  assert.equal(registered.programme, "pharmacy");
  const result = evaluateApplicablePolicy(
    { amountPaise: 12500000, ...resolved.context },
    { policies: [policy], scope: "synthetic-test", asOf: "2026-10-27" },
    resolved.conflicts,
  );
  assert.equal(result.outcome, "NEEDS_HUMAN_REVIEW");
  assert.equal(result.checks[0].outcome, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.administrativeApproval, false);
  assert.equal(
    resolveApplicability(
      { programme: "Engineering", level: "UG" },
      { programme: "engineering", level: "ug" },
    ).conflicts.length,
    0,
  );
});
test("authorized corrections append new evaluations while conflicted facts, severity, provenance and frozen historical replay remain intact", async () => {
  const h = await harness({
    policies: [policy],
    policyScope: "synthetic-test",
  });
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      id = await h.create(a),
      root = "/cases/" + id,
      link = h.app.db
        .prepare("SELECT * FROM case_domains WHERE case_id=?")
        .get(id);
    const obligation = {
      amountPaise: instrument.amountPaise,
      programme: "pharmacy",
      level: "pg",
      policyVersion: policy.version,
      starts: "2026-01-01",
      ends: "2032-01-01",
      revision: 1,
    };
    assert.equal(
      (await h.call("/obligations/" + link.obligation_id, obligation, a))
        .status,
      200,
    );
    let c = (await h.call(root, undefined, a)).body;
    assert.equal(
      (
        await h.call(
          root + "/regulatory-context",
          {
            revision: c.revision,
            context: {
              academicYear: "2026-27",
              programme: "engineering",
              level: "ug",
              entity: "technical",
              ownership: "private",
              application: "new_institution",
            },
          },
          a,
        )
      ).status,
      201,
    );
    c = (await h.call(root, undefined, a)).body;
    const original = c.currentEvidence.find((e) => e.kind === "evaluation");
    assert.equal(
      original.payload.operationalPolicy.outcome,
      "NEEDS_HUMAN_REVIEW",
    );
    assert.equal(original.payload.policyFacts.applicabilityConflicts.length, 2);
    const findings = original.payload.findings.filter((f) =>
      f.code.startsWith("applicability_conflict_"),
    );
    assert.equal(findings.length, 2);
    assert.ok(
      findings.every((f) => f.severity === "HIGH" && f.status === "unresolved"),
    );
    const programme = findings.find((f) => f.code.endsWith("_programme"));
    assert.deepEqual(
      programme.values.map((v) => v.value),
      ["pharmacy", "engineering"],
    );
    assert.ok(
      programme.sources.some(
        (s) =>
          s.type === "regulatory_context" &&
          s.evidenceId === original.payload.sourceReferences.regulatoryContext,
      ),
    );
    const template = clarificationTemplate(programme);
    assert.deepEqual(template.fields, []);
    assert.ok(template.text.includes("obligation"));
    assert.equal(
      (
        await h.call(
          root + "/clarifications",
          {
            text: template.text,
            findingCode: programme.code,
            fields: [],
            documents: [],
          },
          o,
        )
      ).status,
      201,
    );
    const frozen = JSON.stringify(
      h.app.db.prepare("SELECT * FROM evidence WHERE id=?").get(original.id),
    );
    assert.equal(
      (
        await h.call(
          "/obligations/" + link.obligation_id,
          { ...obligation, programme: "engineering", level: "ug", revision: 2 },
          a,
        )
      ).status,
      200,
    );
    c = (await h.call(root, undefined, a)).body;
    const current = c.currentEvidence.find((e) => e.kind === "evaluation");
    assert.equal(current.payload.operationalPolicy.outcome, "COMPLIANT");
    assert.ok(
      !current.payload.findings.some((f) =>
        f.code.startsWith("applicability_conflict_"),
      ),
    );
    assert.equal(
      JSON.stringify(
        h.app.db.prepare("SELECT * FROM evidence WHERE id=?").get(original.id),
      ),
      frozen,
    );
    const replay = replayPolicySnapshot(
      h.app.db,
      id,
      original.id,
      "2026-10-27",
    );
    assert.equal(replay.operationalPolicy.outcome, "NEEDS_HUMAN_REVIEW");
    assert.ok(
      replay.policyExplanation.uncertainty.some((s) =>
        s.includes("Contradictory programme"),
      ),
    );
  } finally {
    await h.close();
  }
});
test("conditional department requirements remain reviewable when programme or level sources conflict", async () => {
  const procedure = {
      ...syntheticProcedure,
      requirements: [
        {
          ...syntheticProcedure.requirements[0],
          conditions: { programme: "engineering", level: "ug" },
        },
      ],
    },
    h = await harness();
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      root = "/cases/" + id,
      link = h.app.db
        .prepare("SELECT * FROM case_domains WHERE case_id=?")
        .get(id);
    h.app.db
      .prepare(
        "UPDATE obligations SET programme='pharmacy',level='pg' WHERE id=?",
      )
      .run(link.obligation_id);
    const c = (await h.call(root, undefined, a)).body;
    assert.equal(
      (
        await h.call(
          root + "/regulatory-context",
          {
            revision: c.revision,
            context: { programme: "engineering", level: "ug" },
          },
          a,
        )
      ).status,
      201,
    );
    const service = clearanceService({
        db: h.app.db,
        audit: () => {},
        procedures: [procedure],
        policyConfig: {
          policies: [policy],
          scope: "synthetic-test",
          verifiedSourceHashes: [],
        },
      }),
      s = { id: "s", role: "supervisor", tenant: "authority" },
      o = { id: "o", role: "officer", tenant: "authority" };
    service.activate(s, {
      scope: procedure.scope,
      version: procedure.version,
      revision: 0,
      reason: "Synthetic applicability test",
    });
    service.bind(o, id, {
      scope: procedure.scope,
      revision: 0,
      reason: "Synthetic conditional requirement",
    });
    const readiness = service.readiness(o, id);
    assert.equal(readiness.items[0].status, "REVIEW_APPLICABILITY");
    assert.ok(
      readiness.blockers.some((b) => b.code === "APPLICABILITY_FACT_CONFLICT"),
    );
    assert.equal(readiness.readyForInternalReview, false);
  } finally {
    await h.close();
  }
});
test("stored legacy conflicted scenarios retain their exact original wire result after applicability version upgrade", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/analysis-conflict-v1-compatibility.json",
        import.meta.url,
      ),
    ),
  );
  assert.equal(
    fixture.classification,
    "SYNTHETIC_CONFLICT_COMPATIBILITY_FIXTURE",
  );
  assert.equal(fixture.sourceCommit, "3a8dfb6");
  assert.deepEqual(
    JSON.parse(JSON.stringify(runScenario(fixture.snapshot, fixture.changes))),
    fixture.result,
  );
});
