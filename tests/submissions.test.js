import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harness, instrument } from "./support/harness.js";
import { createApp } from "../src/server.js";
const document = Buffer.from(
  "Reference: DRAFT-REAL\nDeposit Amount: INR 125000\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssue Date: 2026-01-01\nMaturity Date: 2031-01-01\nInstitution: Synthetic Saved College\nDepositor: Synthetic Trust\nBranch: Test Branch\nCurrency: INR",
);
test("new draft document invalidates earlier confirmation without erasing saved values or recognition attempts", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      d = (
        await h.call(
          "/drafts",
          {
            payload: {
              name: "Source binding",
              obligation: { amountPaise: 12500000 },
              instrument,
            },
            step: 2,
          },
          a,
        )
      ).body,
      path = "/drafts/" + d.id;
    const upload = await h.call(
      path + "/documents",
      { mime: "text/plain", base64: document.toString("base64"), revision: 1 },
      a,
    );
    assert.equal(upload.status, 201);
    for (let n = 0; n < 2; n++)
      assert.equal(
        (await h.call(path + "/process", { revision: upload.body.revision }, a))
          .status,
        200,
      );
    assert.equal(
      h.app.db
        .prepare(
          "SELECT count(*) n FROM draft_extraction_attempts WHERE document_id=?",
        )
        .get(upload.body.id).n,
      2,
    );
    const saved = await h.call(
      path,
      {
        payload: {
          name: "Source binding",
          instrument,
          obligation: { amountPaise: 12500000 },
          confirmedDocumentId: upload.body.id,
          confirmedFields: [
            "reference",
            "amountPaise",
            "bank",
            "ifsc",
            "issued",
            "matures",
          ],
        },
        revision: upload.body.revision,
      },
      a,
    );
    assert.equal(saved.status, 200);
    const next = await h.call(
      path + "/documents",
      {
        mime: "text/plain",
        base64: document.toString("base64"),
        revision: saved.body.revision,
      },
      a,
    );
    assert.equal(next.status, 201);
    const current = (await h.call(path, undefined, a)).body;
    assert.deepEqual(current.payload.confirmedFields, []);
    assert.equal(current.payload.instrument.reference, instrument.reference);
    assert.equal(
      (await h.call(path + "/submit", { revision: next.body.revision }, a))
        .status,
      409,
    );
    assert.equal(h.app.db.prepare("SELECT count(*) n FROM cases").get().n, 0);
    assert.throws(() =>
      h.app.db
        .prepare("UPDATE draft_extraction_attempts SET payload='{}'")
        .run(),
    );
  } finally {
    await h.close();
  }
});
test("upload-first saved draft extracts real source, requires confirmation and submits exactly once with original hash/version", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      o = await h.login("o");
    let d = (
      await h.call(
        "/drafts",
        {
          payload: {
            name: "Synthetic Saved College",
            obligation: { amountPaise: 12500000 },
            step: 2,
          },
        },
        a,
      )
    ).body;
    const path = "/drafts/" + d.id;
    assert.equal(
      (
        await h.call(
          path + "/documents",
          {
            mime: "text/plain",
            base64: document.toString("base64"),
            revision: d.revision,
          },
          b,
        )
      ).status,
      404,
    );
    const upload = await h.call(
      path + "/documents",
      {
        mime: "text/plain",
        base64: document.toString("base64"),
        revision: d.revision,
      },
      a,
    );
    assert.equal(upload.status, 201);
    d.revision = upload.body.revision;
    assert.equal(
      (await h.call(path + "/process", { revision: d.revision }, o)).status,
      403,
    );
    const process = await h.call(
      path + "/process",
      { revision: d.revision },
      a,
    );
    assert.equal(process.status, 200);
    assert.equal(process.body.fields.amountPaise.value, 12500000);
    assert.equal(process.body.fields.reference.value, "DRAFT-REAL");
    assert.equal(
      process.body.fields.reference.documentVersionId,
      upload.body.id,
    );
    assert.equal(
      (await h.call(path + "/readiness", undefined, a)).body.outcome,
      "CANNOT_SUBMIT",
    );
    assert.equal(
      (await h.call(path + "/submit", { revision: d.revision }, a)).status,
      409,
    );
    const payload = {
      name: "Synthetic Saved College",
      obligation: { amountPaise: 12500000 },
      instrument: { ...instrument, reference: "DRAFT-REAL" },
      confirmedDocumentId: upload.body.id,
      confirmedFields: [
        "reference",
        "amountPaise",
        "bank",
        "ifsc",
        "issued",
        "matures",
      ],
      step: 5,
    };
    const saved = await h.call(path, { payload, revision: d.revision }, a);
    d.revision = saved.body.revision;
    assert.equal(
      (await h.call(path + "/readiness", undefined, a)).body.outcome,
      "POSSIBLE_WITH_REVIEW_WARNINGS",
    );
    const results = await Promise.all([
      h.call(path + "/submit", { revision: d.revision }, a),
      h.call(path + "/submit", { revision: d.revision }, a),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
    assert.equal(results[0].body.id, results[1].body.id);
    const caseId = results[0].body.id,
      v = h.app.db
        .prepare("SELECT * FROM document_versions WHERE id=?")
        .get(upload.body.id);
    assert.equal(v.sha256, upload.body.sha256);
    assert.equal(h.app.db.prepare("SELECT count(*) n FROM cases").get().n, 1);
    assert.equal(
      (await h.call("/cases/" + caseId + "/operations", undefined, a)).body
        .stage,
      "submitted",
    );
    assert.equal((await h.call(path, { payload, revision: 3 }, a)).status, 409);
    assert.equal(
      (
        await fetch(h.base + "/api" + path + "/documents/" + upload.body.id, {
          headers: b,
        })
      ).status,
      404,
    );
    assert.deepEqual(
      Buffer.from(
        await (
          await fetch(h.base + "/api" + path + "/documents/" + upload.body.id, {
            headers: a,
          })
        ).arrayBuffer(),
      ),
      document,
    );
  } finally {
    await h.close();
  }
});
test("interrupted draft source survives reopening and malformed input does not erase progress", async () => {
  const h = await harness();
  let reopened;
  try {
    const a = await h.login("a");
    const d = (
      await h.call(
        "/drafts",
        {
          payload: {
            name: "Kept draft",
            instrument: { reference: "KEPT" },
            step: 2,
          },
        },
        a,
      )
    ).body;
    const doc = await h.call(
      "/drafts/" + d.id + "/documents",
      { mime: "text/plain", base64: document.toString("base64"), revision: 1 },
      a,
    );
    assert.equal(doc.status, 201);
    assert.equal(
      (
        await h.call(
          "/drafts/" + d.id,
          { payload: { name: 5 }, revision: 2 },
          a,
        )
      ).status,
      400,
    );
    await h.app.close();
    reopened = createApp({ dir: h.dir });
    assert.equal(
      reopened.db
        .prepare("SELECT payload FROM submission_drafts WHERE id=?")
        .get(d.id)
        .payload.includes("KEPT"),
      true,
    );
    assert.equal(
      readFileSync(h.dir + "/private/" + doc.body.id).equals(document),
      true,
    );
    assert.equal(
      reopened.db.prepare("PRAGMA foreign_key_check").all().length,
      0,
    );
  } finally {
    if (reopened) await reopened.close();
    await h.close();
  }
});
