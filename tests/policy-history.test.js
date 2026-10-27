import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, instrument } from "./support/harness.js";
import { syntheticPolicy as policy } from "./support/clearance-fixtures.js";
import { createApp } from "../src/server.js";
import { openStore } from "../src/store.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  capturePolicyConfiguration,
  explainPolicy,
  loadPolicyConfiguration,
} from "../src/policy-history.js";
import { replayPolicySnapshot } from "../src/policy-replay.js";
import { migrationFixture } from "./support/migration-fixture.js";
import { migrate } from "../src/migrations.js";
const options = { policies: [policy], policyScope: "synthetic-test" };
test("failed integrity capture releases owner lock and database so an explicitly restored synthetic fixture can restart", async () => {
  const h = await harness(options);
  let recovered;
  try {
    const original = h.app.db.prepare("SELECT * FROM policy_capsules").get();
    const trigger = h.app.db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='policy_capsules_immutable'",
      )
      .get().sql;
    await h.app.close();
    const corrupt = openStore(h.dir);
    corrupt.exec("DROP TRIGGER policy_capsules_immutable");
    corrupt
      .prepare("UPDATE policy_capsules SET payload=?")
      .run('{"scope":"tampered","policies":[]}');
    corrupt.close();
    const probe = JSON.parse(
      execFileSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("./fixtures/policy-startup-probe.js", import.meta.url),
          ),
          h.dir,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 30000 },
      ),
    );
    assert.equal(probe.status, 409);
    assert.equal(probe.ownerLockRemains, false);
    // Explicit fixture repair only; production startup never rewrites corrupted history.
    const restored = openStore(h.dir);
    restored
      .prepare("UPDATE policy_capsules SET payload=? WHERE sha256=?")
      .run(original.payload, original.sha256);
    restored.exec(trigger);
    restored.close();
    recovered = createApp({ dir: h.dir, ...options });
    assert.equal(
      recovered.db
        .prepare("SELECT payload FROM policy_capsules WHERE sha256=?")
        .get(original.sha256).payload,
      original.payload,
    );
  } finally {
    if (recovered) await recovered.close();
    await h.close();
  }
});
test("historical source viewing uses the exact extraction recorded with that evaluation after later corrections", async () => {
  const h = await harness(options);
  try {
    const c = await source(h),
      refs = c.report.payload.sourceReferences;
    assert.equal(
      (
        await h.call(
          c.root + "/extraction-corrections",
          {
            extractionId: refs.extraction,
            values: { amountPaise: 13000000 },
            reason: "Later recorded manual extraction correction",
          },
          c.o,
        )
      ).status,
      201,
    );
    const original = (
      await h.call(
        c.root + "/policy-decisions?evaluationId=" + c.report.id,
        undefined,
        c.o,
      )
    ).body;
    assert.equal(original.fieldReferences.amountPaise.value, 12500000);
    const selected = (
      await h.call(
        c.root +
          "/viewer/" +
          refs.document +
          "?extractionId=" +
          refs.extraction,
        undefined,
        c.o,
      )
    ).body;
    assert.equal(selected.recorded.fields.amountPaise.value, 12500000);
    assert.equal(selected.latest.fields.amountPaise.value, 13000000);
    assert.equal(
      (
        await h.call(
          c.root + "/viewer/" + refs.document + "?extractionId=" + c.report.id,
          undefined,
          c.o,
        )
      ).status,
      404,
    );
    assert.equal(original.extractionReference.id, refs.extraction);
  } finally {
    await h.close();
  }
});
test("reviewed exemption proof is linked to its exact document and review event without claiming official authority", async () => {
  const exemption = {
    ...policy,
    rules: [
      { id: "minimum", type: "minimum_amount", amountPaise: 20000000 },
      {
        id: "government-exemption",
        type: "exemption",
        conditions: { ownership: "government" },
        proofType: "government_status",
        exempts: ["minimum"],
      },
    ],
  };
  const h = await harness({
    policies: [exemption],
    policyScope: "synthetic-test",
  });
  try {
    const c = await source(h),
      current = (await h.call(c.root, undefined, c.a)).body;
    assert.equal(
      (
        await h.call(
          c.root + "/regulatory-context",
          {
            revision: current.revision,
            context: { ownership: "government", programme: "engineering" },
          },
          c.a,
        )
      ).status,
      201,
    );
    const context = h.app.db
      .prepare(
        "SELECT id FROM evidence WHERE case_id=? AND kind='regulatory_context' ORDER BY rowid DESC LIMIT 1",
      )
      .get(c.id);
    const proof = await h.call(
      c.root + "/documents",
      {
        kind: "proof",
        title: "Fictional government status proof",
        mime: "text/plain",
        base64: Buffer.from(
          "SYNTHETIC government classification proof, no real official standing",
        ).toString("base64"),
      },
      c.a,
    );
    assert.equal(proof.status, 201);
    assert.equal(
      (
        await h.call(
          c.root + "/proof-reviews",
          {
            contextId: context.id,
            documentId: proof.body.id,
            type: "government_status",
            decision: "accepted",
            reason: "Synthetic reviewer acceptance for workflow test",
          },
          c.o,
        )
      ).status,
      201,
    );
    const r = (await h.call(c.root + "/policy-decisions", undefined, c.o)).body;
    assert.equal(r.explanation.checks[0].outcome, "NOT_APPLICABLE");
    assert.equal(
      r.explanation.checks[0].exceptions.appliedReason,
      "Supported explicit exemption",
    );
    assert.deepEqual(r.explanation.checks[1].evidence, [proof.body.id]);
    assert.equal(r.explanation.checks[1].factReferences.proofReviews.length, 1);
    assert(
      r.documents.some((d) => d.id === proof.body.id && d.kind === "proof"),
    );
    assert.equal(r.explanation.authorityCategory, "SYNTHETIC_TEST_POLICY");
    assert.equal(r.explanation.checks[1].sourceVerified, false);
  } finally {
    await h.close();
  }
});
async function source(h) {
  const a = await h.login("a"),
    o = await h.login("o"),
    id = await h.create(a),
    root = "/cases/" + id;
  const uploaded = await h.call(
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
  assert.equal(uploaded.status, 201);
  assert.equal((await h.call(root + "/process", {}, a)).status, 200);
  const report = h.app.db
    .prepare(
      "SELECT id,payload FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
    )
    .get(id);
  return {
    a,
    o,
    id,
    root,
    report: { ...report, payload: JSON.parse(report.payload) },
  };
}
test("policy explanations bind immutable configuration, exact recorded sources and authorized paginated history", async () => {
  const h = await harness(options);
  try {
    const c = await source(h),
      r = await h.call(c.root + "/policy-decisions", undefined, c.a);
    assert.equal(r.status, 200);
    assert.equal(r.body.configuration.matchesCurrentConfiguration, true);
    assert.equal(r.body.explanation.authorityCategory, "SYNTHETIC_TEST_POLICY");
    assert.equal(r.body.explanation.checks[0].outcome, "COMPLIANT");
    assert.equal(r.body.explanation.administrativeApproval, false);
    assert.equal(r.body.explanation.externalRelease, "NOT_CONFIRMED");
    assert(
      r.body.explanation.regulatoryReference.checks.every(
        (rule) =>
          rule.sourceVerified === false &&
          rule.reviewRequirements.includes("issuer_verified_policy_source"),
      ),
    );
    assert.equal(
      r.body.documents[0].id,
      c.report.payload.sourceReferences.document,
    );
    assert.equal(r.body.documents[0].sha256.length, 64);
    assert.equal(
      r.body.fieldReferences.amountPaise.documentVersionId,
      r.body.documents[0].id,
    );
    assert.equal(r.body.fieldReferences.amountPaise.value, 12500000);
    assert.equal(r.body.fieldReferences.amountPaise.page, 1);
    assert.equal(
      (
        await h.call(
          c.root + "/policy-decisions",
          undefined,
          await h.login("b"),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await h.call(
          c.root + "/policy-decisions",
          undefined,
          await h.login("p"),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await h.call(
          c.root + "/policy-decisions",
          undefined,
          await h.login("r"),
        )
      ).status,
      200,
    );
    const page = (
      await h.call(c.root + "/policy-decisions/history?limit=1", undefined, c.o)
    ).body;
    assert.equal(page.items.length, 1);
    assert(page.nextCursor);
    const other = await h.create(await h.login("b"));
    assert.equal(
      (
        await h.call(
          "/cases/" +
            other +
            "/policy-decisions/history?cursor=" +
            encodeURIComponent(page.nextCursor),
          undefined,
          c.o,
        )
      ).status,
      400,
    );
    assert.throws(() =>
      h.app.db.prepare("UPDATE policy_capsules SET scope='tampered'").run(),
    );
    assert.throws(() =>
      h.app.db.prepare("DELETE FROM evaluation_policy_context").run(),
    );
    assert.equal(
      h.app.db
        .prepare(
          "SELECT count(*) n FROM evaluation_policy_context WHERE evaluation_id=? AND capsule_sha256=?",
        )
        .get(c.report.id, r.body.configuration.sha256).n,
      1,
    );
  } finally {
    await h.close();
  }
});
test("recorded configuration survives a real restart while explicit reassessment uses the new trusted policy", async () => {
  const h = await harness(options);
  let restarted;
  try {
    const c = await source(h),
      original = JSON.stringify(c.report.payload),
      next = {
        ...policy,
        version: "SYNTHETIC-NEXT",
        rules: [
          { id: "minimum", type: "minimum_amount", amountPaise: 20000000 },
        ],
      };
    await h.app.close();
    restarted = createApp({
      dir: h.dir,
      policies: [next],
      policyScope: "synthetic-test",
    });
    await new Promise((ok) => restarted.server.listen(0, "127.0.0.1", ok));
    const base = "http://127.0.0.1:" + restarted.server.address().port;
    const replay = async (policyBasis) => {
      const response = await fetch(
        base + "/api" + c.root + "/policy-evaluate",
        {
          method: "POST",
          headers: { ...c.o, "content-type": "application/json" },
          body: JSON.stringify({
            asOf: "2026-01-01",
            evaluationId: c.report.id,
            policyBasis,
          }),
        },
      );
      assert.equal(response.status, 201);
      const body = await response.json();
      return JSON.parse(
        restarted.db
          .prepare("SELECT payload FROM evidence WHERE id=?")
          .get(body.evaluationId).payload,
      );
    };
    const recorded = await replay("recorded"),
      current = await replay("current");
    assert.equal(recorded.operationalPolicy.version, policy.version);
    assert.equal(recorded.operationalPolicy.outcome, "COMPLIANT");
    assert.equal(current.operationalPolicy.version, next.version);
    assert.equal(current.operationalPolicy.outcome, "NON_COMPLIANT");
    assert.equal(
      current.policyConfiguration.basis,
      "CURRENT_CONFIGURATION_REASSESSMENT",
    );
    assert.equal(recorded.policyConfiguration.basis, "RECORDED_CONFIGURATION");
    assert.equal(current.financialAssessmentAsOf, c.report.payload.asOf);
    assert.equal(
      JSON.stringify(
        JSON.parse(
          restarted.db
            .prepare("SELECT payload FROM evidence WHERE id=?")
            .get(c.report.id).payload,
        ),
      ),
      original,
    );
    assert.equal(
      restarted.db.prepare("SELECT count(*) n FROM policy_capsules").get().n,
      2,
    );
    const inspected = await fetch(
      base + "/api" + c.root + "/policy-decisions?evaluationId=" + c.report.id,
      { headers: c.o },
    );
    const oldInspection = await inspected.json();
    assert.equal(oldInspection.explanation.policyVersion, policy.version);
    assert.equal(
      oldInspection.configuration.matchesCurrentConfiguration,
      false,
    );
  } finally {
    if (restarted) await restarted.close();
    await h.close();
  }
});
test("conditional facts, proof references and explicit exemption explanations remain frozen", async () => {
  const conditional = {
    ...policy,
    rules: [
      {
        id: "minimum",
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
    const c = await source(h);
    let revision = (await h.call(c.root, undefined, c.a)).body.revision;
    assert.equal(
      (
        await h.call(
          c.root + "/regulatory-context",
          {
            revision,
            context: { ownership: "private", programme: "engineering" },
          },
          c.a,
        )
      ).status,
      201,
    );
    const old = h.app.db
      .prepare(
        "SELECT id,payload FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
      )
      .get(c.id);
    revision = (await h.call(c.root, undefined, c.a)).body.revision;
    assert.equal(
      (
        await h.call(
          c.root + "/regulatory-context",
          {
            revision,
            context: { ownership: "government", programme: "engineering" },
          },
          c.a,
        )
      ).status,
      201,
    );
    const frozen = (
      await h.call(
        c.root + "/policy-decisions?evaluationId=" + old.id,
        undefined,
        c.o,
      )
    ).body;
    assert.equal(
      frozen.explanation.checks[0].applicability[0].actual,
      "private",
    );
    assert.equal(
      frozen.explanation.checks[0].applicability[0].outcome,
      "MATCH",
    );
    assert.equal(
      frozen.explanation.checks[0].factReferences.regulatoryContext,
      JSON.parse(old.payload).sourceReferences.regulatoryContext,
    );
    const missing = explainPolicy(
      {
        operationalPolicy: {
          version: conditional.version,
          outcome: "UNVERIFIED_POLICY",
          checks: [],
        },
        policyFacts: { instrument, context: {} },
        sourceReferences: {},
        asOf: "2026-01-01",
      },
      {
        policies: [{ ...conditional, verification: "unverified" }],
        scope: "synthetic-test",
      },
    );
    assert.equal(missing.checks[0].outcome, "UNVERIFIED_POLICY");
    assert.equal(missing.checks[0].applicability[0].outcome, "MISSING_FACT");
    assert.equal(missing.checks[0].sourceVerified, false);
  } finally {
    await h.close();
  }
});
test("legacy schema upgrade never invents a historical policy capsule", () => {
  const f = migrationFixture(15);
  try {
    const before = f.snapshot();
    migrate(f.db, f.dir);
    assert.deepEqual(f.snapshot(), before);
    const row = f.db
        .prepare(
          "SELECT * FROM evidence WHERE kind='evaluation' ORDER BY rowid DESC LIMIT 1",
        )
        .get(),
      report = JSON.parse(row.payload);
    assert.equal(report.policyConfiguration, undefined);
    assert(
      explainPolicy(report).uncertainty.some((r) => /not captured/.test(r)),
    );
    const capsule = capturePolicyConfiguration(f.db, {
      policies: [policy],
      scope: "synthetic-test",
      verifiedSourceHashes: [],
      regulatoryRegister: {},
    });
    const replay = replayPolicySnapshot(
      f.db,
      row.case_id,
      row.id,
      "2026-01-01",
      { capsule },
    );
    assert.equal(
      replay.policyConfiguration.originalConfigurationAvailable,
      false,
    );
    assert.equal(
      replay.policyConfiguration.basis,
      "CURRENT_CONFIGURATION_REASSESSMENT",
    );
    assert(
      replay.policyExplanation.uncertainty.some((r) =>
        /Original configuration unavailable/.test(r),
      ),
    );
  } finally {
    f.close();
  }
});
test("capsule content corruption fails closed instead of silently falling back to current policy", async () => {
  const h = await harness(options);
  try {
    const c = await source(h),
      digest = c.report.payload.policyConfiguration.sha256;
    h.app.db.exec("DROP TRIGGER policy_capsules_immutable");
    h.app.db
      .prepare("UPDATE policy_capsules SET payload=? WHERE sha256=?")
      .run('{"scope":"tampered","policies":[]}', digest);
    assert.throws(() => loadPolicyConfiguration(h.app.db, digest), /integrity/);
    assert.equal(
      (await h.call(c.root + "/policy-decisions", undefined, c.o)).status,
      409,
    );
    assert.equal(
      (
        await h.call(
          c.root + "/policy-evaluate",
          { asOf: "2026-01-01", evaluationId: c.report.id },
          c.o,
        )
      ).status,
      409,
    );
  } finally {
    await h.close();
  }
});
