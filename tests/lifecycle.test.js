import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, instrument } from "./support/harness.js";
test("lifecycle binds document amount observations to current immutable versions without implying bank or release confirmation", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      id = await h.create(a),
      root = "/cases/" + id;
    let r = await h.call(root + "/lifecycle?asOf=2031-01-02", undefined, a);
    assert.equal(r.status, 200);
    assert.equal(r.body.instruments[0].amountObservation, "DECLARATION_ONLY");
    assert.equal(
      r.body.instruments[0].declaredDateState,
      "DECLARED_MATURITY_PASSED",
    );
    assert.equal(r.body.release.bankReleaseCompleted, false);
    assert.equal(r.body.obligation.status, "registered");
    const upload = await h.call(
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
    assert.equal(upload.status, 201);
    assert.equal((await h.call(root + "/process", {}, a)).status, 200);
    r = await h.call(root + "/lifecycle", undefined, a);
    const matching = r.body.instruments[0];
    assert.equal(
      matching.amountObservation,
      "DOCUMENT_AMOUNT_MATCHES_DECLARATION",
    );
    assert.equal(
      matching.amountEvidence.documentVersionId,
      matching.documentVersionId,
    );
    assert.equal(
      matching.amountEvidence.documentSHA256,
      matching.documentSHA256,
    );
    assert.equal(matching.bankVerification, "UNCONFIRMED");
    const current = await h.call(root, undefined, a);
    assert.equal(
      (
        await h.call(
          root + "/corrections",
          {
            instrument: { ...instrument, amountPaise: 13000000 },
            revision: current.body.revision,
            reason: "Historical declaration correction",
          },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (await h.call(root + "/lifecycle", undefined, a)).body.instruments[0]
        .amountObservation,
      "DOCUMENT_AMOUNT_CONFLICT",
    );
    assert.equal(
      (
        await h.call(
          root + "/documents",
          {
            mime: "text/plain",
            base64: Buffer.from("New version without extraction").toString(
              "base64",
            ),
          },
          a,
        )
      ).status,
      201,
    );
    const next = (await h.call(root + "/lifecycle", undefined, a)).body
      .instruments[0];
    assert.equal(next.amountObservation, "DOCUMENT_AMOUNT_REQUIRES_REVIEW");
    assert.equal(next.amountEvidence, null);
    assert.notEqual(next.documentVersionId, matching.documentVersionId);
    assert.equal((await h.call(root + "/lifecycle", undefined, b)).status, 404);
    assert.equal(
      (await h.call(root + "/lifecycle?asOf=2026-02-30", undefined, a)).status,
      400,
    );
  } finally {
    await h.close();
  }
});
test("lifecycle timeline uses stable scoped snapshots with evidence links and immutable relationship references", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      id = await h.create(a),
      other = await h.create(a),
      root = "/cases/" + id;
    const first = await h.call(
      root + "/lifecycle/timeline?limit=1",
      undefined,
      a,
    );
    assert.equal(first.status, 200);
    assert.ok(first.body.nextCursor);
    const ceiling = first.body.snapshotCeiling;
    assert.equal((await h.call(root + "/evaluate", {}, a)).status, 201);
    const second = await h.call(
      root +
        "/lifecycle/timeline?limit=100&cursor=" +
        encodeURIComponent(first.body.nextCursor),
      undefined,
      a,
    );
    assert.equal(second.status, 200);
    assert.ok(second.body.items.every((v) => v.sequence <= ceiling));
    assert.ok(
      second.body.items.some((v) => v.evidence?.kind === "declaration"),
    );
    assert.equal(
      (
        await h.call(
          "/cases/" +
            other +
            "/lifecycle/timeline?cursor=" +
            encodeURIComponent(first.body.nextCursor),
          undefined,
          a,
        )
      ).status,
      400,
    );
    assert.equal(
      (await h.call(root + "/lifecycle/timeline", undefined, b)).status,
      404,
    );
  } finally {
    await h.close();
  }
});
