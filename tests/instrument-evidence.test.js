import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, instrument } from "./support/harness.js";
test("replacement selection cannot inherit another instrument document, extraction or financial evidence", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      id = await h.create(a),
      path = "/cases/" + id;
    const doc = await h.call(
      path + "/documents",
      {
        mime: "text/plain",
        base64: Buffer.from("Reference: ORIGINAL").toString("base64"),
      },
      a,
    );
    assert.equal(doc.status, 201);
    await h.call(path + "/process", {}, a);
    await h.call(path + "/external", { scenario: "mock_confirmed" }, o);
    const original = (await h.call(path, undefined, a)).body,
      oldId = original.domain.instrument_id;
    const next = await h.call(
      path + "/instruments",
      {
        instrument: {
          ...instrument,
          reference: "REPLACEMENT",
          type: "FDR",
          currency: "INR",
          branch: "Synthetic",
        },
      },
      a,
    );
    assert.equal(next.status, 201);
    const newRevision = h.app.db
      .prepare("SELECT revision FROM instruments WHERE id=?")
      .get(next.body.id).revision;
    assert.equal(
      (
        await h.call(
          path + "/instrument-primary",
          {
            instrumentId: next.body.id,
            revision: original.revision,
            reason: "Replacement selection",
          },
          a,
        )
      ).status,
      200,
    );
    let current = (await h.call(path, undefined, a)).body;
    assert.equal(
      h.app.db
        .prepare("SELECT revision FROM instruments WHERE id=?")
        .get(next.body.id).revision,
      newRevision,
    );
    assert(
      !current.currentEvidence.some((e) =>
        ["document", "extraction", "external"].includes(e.kind),
      ),
    );
    assert.equal((await h.call(path + "/process", {}, a)).status, 409);
    assert.equal(
      (
        await h.call(
          path + "/documents",
          {
            documentId: doc.body.logicalDocumentId,
            mime: "text/plain",
            base64: Buffer.from("bad association").toString("base64"),
          },
          a,
        )
      ).status,
      409,
    );
    const newDoc = await h.call(
      path + "/documents",
      {
        mime: "text/plain",
        base64: Buffer.from("Reference: REPLACEMENT").toString("base64"),
      },
      a,
    );
    assert.equal(newDoc.status, 201);
    assert.notEqual(newDoc.body.logicalDocumentId, doc.body.logicalDocumentId);
    current = (await h.call(path, undefined, a)).body;
    assert.equal(
      (
        await h.call(
          path + "/instrument-primary",
          {
            instrumentId: oldId,
            revision: current.revision,
            reason: "Replay prior instrument",
          },
          a,
        )
      ).status,
      200,
    );
    current = (await h.call(path, undefined, a)).body;
    assert.equal(
      current.currentEvidence.find((e) => e.kind === "document").id,
      doc.body.id,
    );
    assert(current.currentEvidence.some((e) => e.kind === "external"));
    assert(
      current.currentEvidence.some(
        (e) => e.kind === "extraction" && e.payload.documentId === doc.body.id,
      ),
    );
    assert(
      h.app.db
        .prepare("SELECT 1 FROM document_versions WHERE id=?")
        .get(newDoc.body.id),
    );
  } finally {
    await h.close();
  }
});
