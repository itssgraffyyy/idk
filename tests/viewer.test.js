import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { harness } from "./support/harness.js";
import "../public/viewer-geometry.js";
import { buildPDF } from "../scripts/pdf-fixtures.js";
import { loadImage, createCanvas } from "@napi-rs/canvas";
test("rotated embedded text highlights overlap actual rendered source ink", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      path = "/cases/" + id,
      bytes = buildPDF({
        width: 650,
        height: 900,
        matrix: [0, 1, -1, 0, 200, 35],
      });
    const uploaded = await h.call(
      path + "/documents",
      { mime: "application/pdf", base64: bytes.toString("base64") },
      a,
    );
    assert.equal(uploaded.status, 201);
    assert.equal(
      (await h.call(path + "/process", {}, a)).body.status,
      "completed",
    );
    const meta = (
      await h.call(path + "/viewer/" + uploaded.body.id, undefined, a)
    ).body;
    const response = await fetch(
      h.base +
        "/api" +
        path +
        "/documents/" +
        uploaded.body.id +
        "?preview=1&page=1",
      { headers: a },
    );
    assert.equal(response.status, 200);
    const viewport = {
        ...JSON.parse(response.headers.get("x-document-viewport")),
        page: 1,
      },
      box = globalThis.projectEvidenceBox(
        meta.latest.fields.reference,
        viewport,
      );
    assert(box && box.height > box.width);
    const img = await loadImage(Buffer.from(await response.arrayBuffer())),
      canvas = createCanvas(img.width, img.height);
    canvas.getContext("2d").drawImage(img, 0, 0);
    const pixels = canvas
      .getContext("2d")
      .getImageData(
        Math.floor(box.x),
        Math.floor(box.y),
        Math.ceil(box.width),
        Math.ceil(box.height),
      ).data;
    let ink = 0;
    for (let n = 0; n < pixels.length; n += 4)
      if (pixels[n] + pixels[n + 1] + pixels[n + 2] < 600) ink++;
    assert(
      ink > 20,
      "Highlight must overlap source glyph pixels, not an invented empty region",
    );
  } finally {
    await h.close();
  }
});
test("highlights apply exact viewport transform, page bounds and orientation without inventing coordinates", () => {
  const f = {
      page: 2,
      bbox: { x0: 10, y0: 100, x1: 20, y1: 120 },
      coordinateSystem: "pdf-points-bottom-left",
    },
    v = {
      page: 2,
      width: 1200,
      height: 1600,
      transform: [2, 0, 0, -2, 0, 1600],
    };
  assert.deepEqual(globalThis.projectEvidenceBox(f, v), {
    x: 20,
    y: 1360,
    width: 20,
    height: 40,
  });
  assert.equal(globalThis.projectEvidenceBox(f, { ...v, page: 1 }), null);
  assert.equal(globalThis.projectEvidenceBox(f, { ...v, rotation: 90 }), null);
  assert.equal(globalThis.projectEvidenceBox({ ...f, bbox: null }, v), null);
  assert.deepEqual(
    globalThis.projectEvidenceBox(f, { ...v, transform: [0, 2, 2, 0, 0, 0] }),
    { x: 200, y: 20, width: 40, height: 20 },
  );
  assert.equal(
    globalThis.projectEvidenceBox(
      { ...f, bbox: { x0: 10000, y0: 10000, x1: 11000, y1: 11000 } },
      v,
    ),
    null,
  );
});
test("protected version metadata separates original/corrected extraction and exposes actual PDF viewport for page highlights", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      o = await h.login("o"),
      id = await h.create(a),
      path = "/cases/" + id,
      upload = () =>
        h.call(
          path + "/documents",
          {
            mime: "application/pdf",
            base64: readFileSync(
              "datasets/v2/pdf/embedded-synthetic.pdf",
            ).toString("base64"),
          },
          a,
        );
    const doc = await upload();
    assert.equal(doc.status, 201);
    assert.equal(
      (await h.call(path + "/process", {}, a)).body.status,
      "completed",
    );
    let meta = (await h.call(path + "/viewer/" + doc.body.id, undefined, o))
      .body;
    assert(meta.latest.fields.reference.bbox);
    assert.equal(meta.latest.fields.reference.page, 1);
    const response = await fetch(
      h.base +
        "/api" +
        path +
        "/documents/" +
        doc.body.id +
        "?preview=1&page=1",
      { headers: o },
    );
    assert.equal(response.status, 200);
    const viewport = {
      ...JSON.parse(response.headers.get("x-document-viewport")),
      page: 1,
    };
    assert(
      globalThis.projectEvidenceBox(meta.latest.fields.reference, viewport),
    );
    await response.arrayBuffer();
    assert.equal(
      (await h.call(path + "/viewer/" + doc.body.id, undefined, b)).status,
      404,
    );
    assert.equal(
      (
        await h.call(
          path + "/extraction-corrections",
          {
            extractionId: meta.latest.id,
            values: { reference: "HUMAN-CORRECTED" },
            reason: "Reviewer compared source reference",
          },
          o,
        )
      ).status,
      201,
    );
    meta = (await h.call(path + "/viewer/" + doc.body.id, undefined, a)).body;
    assert.equal(meta.original.fields.reference.value, "PDF-TEST");
    assert.equal(meta.latest.fields.reference.value, "HUMAN-CORRECTED");
    assert.deepEqual(
      meta.latest.fields.reference.bbox,
      meta.original.fields.reference.bbox,
    );
    assert.equal((await upload()).status, 201);
    const page = await h.call(path + "/viewer/versions?limit=1", undefined, a);
    assert.equal(page.body.items.length, 1);
    assert(page.body.nextCursor);
    assert.equal(
      (
        await h.call(
          path +
            "/viewer/versions?cursor=" +
            encodeURIComponent(page.body.nextCursor),
          undefined,
          o,
        )
      ).status,
      400,
    );
    writeFileSync(h.dir + "/private/" + doc.body.id, "tampered");
    assert.equal(
      (await h.call(path + "/viewer/" + doc.body.id, undefined, a)).status,
      409,
    );
  } finally {
    await h.close();
  }
});
