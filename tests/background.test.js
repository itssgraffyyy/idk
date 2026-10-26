import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness } from "./support/harness.js";
test("bytes changed during OCR fail the durable job and cannot become accepted extraction", async () => {
  let release;
  const gate = new Promise((r) => (release = r)),
    h = await harness({
      ocrRunner: async () => {
        await gate;
        return {
          stdout: JSON.stringify({
            text: "Reference: MUST-NOT-ACCEPT",
            blocks: [],
          }),
        };
      },
    });
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      path = "/cases/" + id,
      doc = await h.call(
        path + "/documents",
        {
          mime: "image/png",
          base64: readFileSync("datasets/v3/documents/ocr-v3-01.png").toString(
            "base64",
          ),
        },
        a,
      );
    assert.equal(doc.status, 201);
    const pending = await h.call(path + "/process", { background: true }, a);
    assert.equal(pending.status, 202);
    writeFileSync(join(h.dir, "private", doc.body.id), "tampered");
    release();
    let job;
    for (let n = 0; n < 100; n++) {
      job = (await h.call(path + "/jobs/" + pending.body.jobId, undefined, a))
        .body;
      if (job.status !== "processing") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(job.status, "failed");
    assert.equal(
      h.app.db
        .prepare(
          "SELECT count(*) n FROM evidence WHERE case_id=? AND kind='extraction'",
        )
        .get(id).n,
      0,
    );
  } finally {
    release();
    await h.close();
  }
});
test("background OCR exposes tenant-protected durable job polling and persists extraction", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const h = await harness({
    ocrRunner: async () => {
      await gate;
      return {
        stdout: JSON.stringify({
          text: "Reference: BACKGROUND\nAmount: INR 125000\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssue Date: 2026-01-01\nMaturity Date: 2031-01-01",
          blocks: [],
        }),
      };
    },
  });
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      id = await h.create(a);
    assert.equal(
      (
        await h.call(
          "/cases/" + id + "/documents",
          {
            mime: "image/png",
            base64: readFileSync(
              "datasets/v3/documents/ocr-v3-01.png",
            ).toString("base64"),
          },
          a,
        )
      ).status,
      201,
    );
    const result = await h.call(
      "/cases/" + id + "/process",
      { background: true },
      a,
    );
    assert.equal(result.status, 202);
    const path = "/cases/" + id + "/jobs/" + result.body.jobId;
    assert.equal((await h.call(path, undefined, a)).body.status, "processing");
    assert.equal((await h.call(path, undefined, b)).status, 404);
    release();
    let status;
    for (let i = 0; i < 100; i++) {
      status = (await h.call(path, undefined, a)).body.status;
      if (status !== "processing") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(status, "completed");
    const state = (await h.call("/cases/" + id, undefined, a)).body;
    assert(
      state.history.some(
        (e) => e.kind === "extraction" && e.payload.jobId === result.body.jobId,
      ),
    );
  } finally {
    release();
    await h.close();
  }
});
test("account and obligation pagination never returns credentials and rejects cross-role cursors", async () => {
  const h = await harness();
  try {
    const admin = await h.login("admin"),
      a = await h.login("a"),
      s = await h.login("s");
    const first = await h.call("/accounts?limit=1", undefined, admin);
    assert.equal(first.status, 200);
    assert.equal(first.body.length, 1);
    assert(!JSON.stringify(first.body).includes("password"));
    const cursor = first.headers.get("x-next-cursor");
    assert(cursor);
    assert.equal(
      (
        await h.call(
          "/accounts?cursor=" + encodeURIComponent(cursor),
          undefined,
          s,
        )
      ).status,
      400,
    );
    for (let n = 0; n < 3; n++) await h.create(a);
    const obligations = await h.call("/obligations?limit=1", undefined, a);
    assert.equal(obligations.body.length, 1);
    assert(obligations.headers.get("x-next-cursor"));
  } finally {
    await h.close();
  }
});
