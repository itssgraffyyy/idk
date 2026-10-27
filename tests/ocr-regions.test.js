import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { boxInSource, sourceCoordinateBlocks } from "../src/ocr-regions.js";
import { harness } from "./support/harness.js";
import {
  syntheticPolicy,
  syntheticProcedure,
} from "./support/clearance-fixtures.js";
test("inverse right-angle transforms retain original recognition boxes without mutating OCR provenance", () => {
  const bbox = { x0: 10, y0: 20, x1: 30, y1: 40 };
  assert.deepEqual(boxInSource(bbox, 90, 100, 80), {
    x0: 20,
    y0: 50,
    x1: 40,
    y1: 70,
  });
  assert.deepEqual(boxInSource(bbox, 180, 100, 80), {
    x0: 70,
    y0: 40,
    x1: 90,
    y1: 60,
  });
  assert.deepEqual(boxInSource(bbox, 270, 100, 80), {
    x0: 60,
    y0: 10,
    x1: 80,
    y1: 30,
  });
  assert.equal(boxInSource(bbox, 45, 100, 80), null);
  const original = [
    {
      bbox,
      paragraphs: [{ lines: [{ bbox, words: [{ text: "source", bbox }] }] }],
    },
  ];
  const mapped = sourceCoordinateBlocks(original, 90, 100, 80);
  assert.deepEqual(original[0].bbox, bbox);
  assert.deepEqual(mapped[0].recognitionBBox, bbox);
  assert.deepEqual(
    mapped[0].paragraphs[0].lines[0].words[0].bbox,
    mapped[0].bbox,
  );
});
test("actual rotated-document ROI proposal preserves primary OCR, maps to original pixels and blocks approval until explicit correction", async () => {
  const manifest = JSON.parse(readFileSync("datasets/v4/manifest.json")),
    sample = manifest.cases.find((c) => c.id === "ocr-v4-27");
  assert.equal(sample.split, "validation");
  const h = await harness({
    policies: [syntheticPolicy],
    policyScope: "synthetic-test",
    procedures: [syntheticProcedure],
  });
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      s = await h.login("s"),
      id = await h.create(a, { instrument: sample.groundTruth.extracted }),
      root = "/cases/" + id;
    const upload = await h.call(
      root + "/documents",
      {
        mime: "image/png",
        base64: readFileSync(
          "datasets/v4/documents/" + sample.id + ".png",
        ).toString("base64"),
      },
      a,
    );
    assert.equal(upload.status, 201);
    assert.equal((await h.call(root + "/process", {}, a)).status, 200);
    let c = (await h.call(root, undefined, o)).body,
      extraction = c.currentEvidence.find((e) => e.kind === "extraction");
    const field = extraction.payload.fields.institutionName;
    assert.equal(field.rawValue, "Fictional Academy 277");
    assert.equal(field.value, undefined);
    assert.equal(field.primaryValue, "Fictional Academy 277");
    assert.equal(field.secondaryOCR.value, "Fictional Academy 27");
    assert.equal(field.status, "REQUIRES_REVIEW");
    assert.equal(field.method, "tesseract-roi-psm7");
    assert.match(extraction.payload.raw.text, /Fictional Academy 277/);
    assert.equal(field.secondaryOCR.cropSHA256.length, 64);
    assert.equal(
      extraction.payload.raw.coordinateSpace,
      "source-raster-pixels",
    );
    const expected = boxInSource(
      sample.groundTruth.originalUnrotatedLineBoxes.institutionName,
      extraction.payload.raw.rotation,
      sample.dimensions.width,
      sample.dimensions.height,
    );
    const center = {
      x: (field.bbox.x0 + field.bbox.x1) / 2,
      y: (field.bbox.y0 + field.bbox.y1) / 2,
    };
    assert(
      center.x >= expected.x0 &&
        center.x <= expected.x1 &&
        center.y >= expected.y0 &&
        center.y <= expected.y1,
    );
    const image = await loadImage(
      readFileSync("datasets/v4/documents/" + sample.id + ".png"),
    );
    const left = Math.floor(field.bbox.x0),
      top = Math.floor(field.bbox.y0),
      width = Math.ceil(field.bbox.x1) - left,
      height = Math.ceil(field.bbox.y1) - top;
    const canvas = createCanvas(width, height),
      pixelsContext = canvas.getContext("2d");
    pixelsContext.drawImage(
      image,
      left,
      top,
      width,
      height,
      0,
      0,
      width,
      height,
    );
    const pixels = pixelsContext.getImageData(0, 0, width, height).data;
    let sourceInk = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100)
        sourceInk++;
    assert(
      sourceInk > 20,
      "normalized field box must overlap actual original-image glyph ink",
    );
    assert(
      c.currentEvidence
        .find((e) => e.kind === "evaluation")
        .payload.findings.some(
          (f) => f.code === "ocr_extraction_review_institutionName",
        ),
    );
    assert.equal(
      (
        await h.call(
          "/clearance/activations",
          {
            version: syntheticProcedure.version,
            scope: syntheticProcedure.scope,
            revision: 0,
            reason: "Synthetic ROI approval gate test",
          },
          s,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await h.call(
          "/clearance/cases/" + id + "/bind",
          {
            scope: syntheticProcedure.scope,
            revision: 0,
            reason: "Check current extraction review blockers",
          },
          o,
        )
      ).status,
      201,
    );
    let readiness = (await h.call("/clearance/cases/" + id, undefined, o)).body;
    assert(
      readiness.blockers.some(
        (b) =>
          b.code === "EXTRACTION_PROPOSAL_REQUIRES_REVIEW" &&
          b.field === "institutionName",
      ),
    );
    assert.equal(
      (
        await h.call(
          root + "/extraction-corrections",
          {
            extractionId: extraction.id,
            values: { institutionName: field.secondaryOCR.value },
            reason:
              "Reviewer explicitly inspected original pixels and confirmed the ROI proposal",
          },
          o,
        )
      ).status,
      201,
    );
    readiness = (await h.call("/clearance/cases/" + id, undefined, o)).body;
    assert(
      !readiness.blockers.some(
        (b) =>
          b.code === "EXTRACTION_PROPOSAL_REQUIRES_REVIEW" &&
          b.field === "institutionName",
      ),
    );
    c = (await h.call(root, undefined, o)).body;
    assert.equal(
      c.currentEvidence.find((e) => e.kind === "extraction").payload.fields
        .institutionName.status,
      "HUMAN_CORRECTED",
    );
    assert.equal(
      JSON.parse(
        h.app.db
          .prepare("SELECT payload FROM evidence WHERE id=?")
          .get(extraction.id).payload,
      ).fields.institutionName.rawValue,
      "Fictional Academy 277",
    );
    const viewer = (
      await h.call(root + "/viewer/" + upload.body.id, undefined, o)
    ).body;
    assert.equal(viewer.latest.rotation, 0);
    assert.equal(
      viewer.latest.recognitionRotation,
      extraction.payload.raw.rotation,
    );
    assert.equal(viewer.latest.geometryUnavailable, false);
  } finally {
    await h.close();
  }
});
