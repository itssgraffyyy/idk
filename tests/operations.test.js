import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, instrument } from "./support/harness.js";
import { resolutionDelta, targetedCorrection } from "../src/resolution.js";
test("operational workflow readiness, separate dimensions, role guards and concurrent transitions", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      b = await h.login("b"),
      r = await h.login("r"),
      id = await h.create(a),
      path = "/cases/" + id;
    let s = (await h.call(path + "/operations", undefined, a)).body;
    const move = (action, auth, expected = s) =>
      h.call(
        path + "/operations",
        {
          action,
          reason: "Test authorized case step",
          revision: expected.revision,
          inputRevision: expected.input_revision,
        },
        auth,
      );
    assert.equal(s.stage, "draft");
    assert.equal(s.readiness.outcome, "CANNOT_SUBMIT");
    assert.equal((await move("submit", a)).status, 409);
    assert.equal(
      (await h.call(path + "/operations", undefined, b)).status,
      404,
    );
    assert.equal(
      (
        await h.call(
          path + "/documents",
          {
            mime: "text/plain",
            base64: Buffer.from(
              "Reference: PHASE12-TEST\nAmount: INR 125000\nIFSC: HDFC0001234",
            ).toString("base64"),
          },
          a,
        )
      ).status,
      201,
    );
    assert.equal((await move("submit", a)).status, 409);
    s = (await h.call(path + "/operations", undefined, a)).body;
    assert.equal((await move("submit", o)).status, 403);
    const attempts = await Promise.all([move("submit", a), move("submit", a)]);
    assert.deepEqual(attempts.map((x) => x.status).sort(), [200, 409]);
    const receipt = attempts.find((x) => x.status === 200).body.acknowledgement;
    assert(receipt.caseId === id && receipt.documentVersionId);
    s = (await h.call(path + "/operations", undefined, o)).body;
    assert.equal(s.dimensions.release, "NOT_REQUESTED");
    assert.equal(s.dimensions.financial, "UNCONFIRMED");
    assert.equal((await move("intake", r)).status, 403);
    assert.equal((await move("intake", o)).status, 200);
    s = (await h.call(path + "/operations", undefined, o)).body;
    assert.equal((await move("ready", o)).status, 200);
    s = (await h.call(path + "/operations", undefined, o)).body;
    assert.equal((await move("review", o)).status, 200);
    assert.equal(
      (await h.call("/work-queue?queue=review", undefined, o)).body.items[0].id,
      id,
    );
    assert.equal(
      (await h.call("/work-queue?queue=review", undefined, b)).body.items
        .length,
      0,
    );
  } finally {
    await h.close();
  }
});
test("finding-linked clarification changes only requested facts and preserves resolved/outstanding provenance", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      b = await h.login("b"),
      id = await h.create(a),
      path = "/cases/" + id;
    await h.call(
      path + "/documents",
      {
        mime: "text/plain",
        base64: Buffer.from(
          "Reference: PHASE12-TEST\nDeposit Amount: INR 150000\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssue Date: 2026-01-01\nMaturity Date: 2031-01-01",
        ).toString("base64"),
      },
      a,
    );
    await h.call(path + "/process", {}, a);
    const before = h.app.db
      .prepare(
        "SELECT id,payload FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
      )
      .get(id);
    const template = (
      await h.call(path + "/clarification-templates", undefined, o)
    ).body.find((t) => t.findingCode === "mismatch_amountPaise");
    assert(template);
    assert(template.fields.includes("amountPaise"));
    assert.equal(
      (
        await h.call(
          path + "/clarifications",
          { ...template, text: template.text, deadline: "2026-02-30" },
          o,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call(
          path + "/clarifications",
          { ...template, text: template.text, deadline: "2026-01-01" },
          o,
        )
      ).status,
      201,
    );
    let q = (await h.call(path + "/operations", undefined, a)).body
      .clarifications[0];
    assert.equal(
      (
        await h.call(
          path + "/disputed-fields",
          {
            requestId: q.id,
            values: { bank: "Injected change" },
            reason: "Invalid field",
            revision: 1,
          },
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call(
          path + "/disputed-fields",
          {
            requestId: q.id,
            values: { amountPaise: 15000000 },
            reason: "Compared source amount",
            revision: 1,
          },
          b,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await h.call(
          path + "/disputed-fields",
          {
            requestId: q.id,
            values: { amountPaise: 15000000 },
            reason: "Compared source amount",
            revision: 1,
          },
          a,
        )
      ).status,
      200,
    );
    const state = (await h.call(path, undefined, a)).body;
    assert.equal(state.instrument.bank, instrument.bank);
    const delta = (await h.call(path + "/operations", undefined, a)).body
      .resolution;
    assert(delta.changes.resolved.includes("mismatch_amountPaise"));
    assert(delta.independentVerificationRequired.length);
    assert.equal(delta.administrativeApproval, false);
    assert.equal(
      h.app.db.prepare("SELECT payload FROM evidence WHERE id=?").get(before.id)
        .payload,
      before.payload,
    );
    assert.equal(
      (
        await h.call(
          path + "/responses",
          {
            requestId: q.id,
            revision: q.revision,
            text: "Corrected only the disputed amount",
          },
          a,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await h.call(
          path + "/responses",
          { requestId: q.id, revision: q.revision, text: "Duplicate response" },
          a,
        )
      ).status,
      409,
    );
    q = (await h.call(path + "/operations", undefined, a)).body
      .clarifications[0];
    assert.equal(
      (
        await h.call(
          path + "/clarifications/" + q.id + "/review",
          {
            decision: "close",
            reason: "Reviewed corrected amount",
            revision: q.revision,
          },
          o,
        )
      ).status,
      200,
    );
    const notes = (await h.call("/notifications", undefined, a)).body.items;
    assert(notes.length);
    assert.equal(new Set(notes.map((n) => n.dedupe_key)).size, notes.length);
    assert.equal(
      (await h.call("/notifications", undefined, b)).body.items.length,
      0,
    );
    assert.equal(
      (await h.call("/notifications/" + notes[0].id + "/read", {}, b)).status,
      404,
    );
    assert.throws(() =>
      h.app.db.prepare("UPDATE evaluation_resolutions SET payload='{}'").run(),
    );
  } finally {
    await h.close();
  }
});
test("persisted drafts use owner, tenant and optimistic revisions without overwriting confirmed form data", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      o = await h.login("o"),
      payload = {
        name: "Partial synthetic submission",
        instrument: { reference: "SAVED-REFERENCE" },
        confirmedFields: ["reference"],
        step: 2,
      };
    const draft = await h.call("/drafts", { payload }, a);
    assert.equal(draft.status, 201);
    const path = "/drafts/" + draft.body.id;
    assert.deepEqual((await h.call(path, undefined, a)).body.payload, payload);
    assert.equal((await h.call(path, undefined, b)).status, 404);
    assert.equal((await h.call("/drafts", undefined, o)).status, 403);
    assert.equal(
      (await h.call(path, { payload: { ...payload, step: 3 }, revision: 1 }, a))
        .status,
      200,
    );
    assert.equal((await h.call(path, { payload, revision: 1 }, a)).status, 409);
    assert.equal(
      (await h.call(path, undefined, a)).body.payload.instrument.reference,
      "SAVED-REFERENCE",
    );
  } finally {
    await h.close();
  }
});
test("resolution dependency descriptors and full recomputation fallback never imply administrative approval", () => {
  const before = {
      sources: { instrument: { amountPaise: 100 } },
      findings: [
        {
          code: "amount",
          sources: [{ type: "declaration", field: "amountPaise" }],
        },
      ],
    },
    after = {
      version: 2,
      sources: { instrument: { amountPaise: 200 } },
      findings: [
        {
          code: "verification",
          sources: [{ type: "provider" }],
          missingEvidence: ["authorized_independent_bank_confirmation"],
        },
      ],
    };
  const delta = resolutionDelta(before, after);
  assert.deepEqual(delta.changes.resolved, ["amount"]);
  assert.deepEqual(delta.changes.introduced, ["verification"]);
  assert.equal(delta.dependencies[0].findingCode, "verification");
  assert.equal(delta.administrativeApproval, false);
  assert.equal(delta.strategy, "FULL_RECOMPUTATION_SAFE_FALLBACK");
  assert.deepEqual(
    targetedCorrection(
      { amountPaise: 100, bank: "Preserved" },
      { amountPaise: 200 },
      ["amountPaise"],
    ),
    { amountPaise: 200, bank: "Preserved" },
  );
});
