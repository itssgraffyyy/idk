import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support/harness.js";
import { buildPDF } from "../scripts/pdf-fixtures.js";
test("portable PDF preview preserves readable financial glyphs through genuine raster OCR", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      root = "/cases/" + id;
    const source = await h.call(
      root + "/documents",
      { mime: "application/pdf", base64: buildPDF().toString("base64") },
      a,
    );
    assert.equal(source.status, 201);
    const rendered = await fetch(
      h.base +
        "/api" +
        root +
        "/documents/" +
        source.body.id +
        "?preview=1&page=1",
      { headers: a },
    );
    assert.equal(rendered.status, 200);
    assert.equal(
      rendered.headers.get("x-document-font-mode"),
      "pdf-embedded-or-bundled-standard",
    );
    const png = Buffer.from(await rendered.arrayBuffer());
    assert.equal(
      (
        await h.call(
          root + "/documents",
          { mime: "image/png", base64: png.toString("base64") },
          a,
        )
      ).status,
      201,
    );
    const recognized = await h.call(root + "/process", {}, a);
    assert.equal(recognized.status, 200);
    assert.equal(recognized.body.status, "completed");
    assert.equal(recognized.body.fields.reference.value, "PDF-TEST");
    assert.equal(recognized.body.fields.amountPaise.value, 10000000);
    assert.equal(recognized.body.fields.ifsc.value, "HDFC0001234");
    assert.equal(recognized.body.fields.issued.value, "2026-01-01");
    assert.equal(recognized.body.fields.matures.value, "2030-01-01");
  } finally {
    await h.close();
  }
});
