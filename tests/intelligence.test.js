import { test } from "node:test";
import assert from "node:assert/strict";
import { extract } from "../src/extraction.js";
import { harness, instrument } from "./support/harness.js";
test("ten-field extraction preserves exact page identity and coordinates and withholds cross-page conflicts", () => {
  const text =
    "Institution Name: Test College\nDepositor Name: Test Trust\nBranch Name: Test Branch\nCurrency: INR\nIFSC: HDFC0001234";
  const items = text
    .split("\n")
    .map((text, i) => ({
      text,
      transform: [12, 0, 0, 12, 30, 700 - i * 30],
      width: 200,
      height: 12,
    }));
  const fields = extract("", {
    pages: [{ page: 2, text, items }],
    documentVersionId: "immutable-version",
    processedAt: "2026-10-26T00:00:00Z",
  });
  assert.equal(fields.depositor.value, "Test Trust");
  assert.equal(fields.branch.page, 2);
  assert.equal(fields.ifsc.documentVersionId, "immutable-version");
  assert.equal(fields.currency.coordinateSystem, "pdf-points-bottom-left");
  assert.equal(fields.currency.bbox.y0, 610);
  const conflicts = extract("", {
    pages: [
      { page: 1, text: "Depositor: First" },
      { page: 3, text: "Depositor: Second" },
    ],
  });
  assert.equal(conflicts.depositor.value, undefined);
  assert.equal(conflicts.depositor.status, "REQUIRES_REVIEW");
  assert.equal(conflicts.depositor.observations[1].page, 3);
});
test("secondary OCR proposal retains primary recognition and never bypasses review", () => {
  const x = extract("IFSC: SYNBOOOOOO1", {
    fieldAttempts: {
      ifsc: {
        value: "SYNB0000001",
        reliable: true,
        method: "visual-glyph-templates-v1",
        bbox: { x0: 1, y0: 1, x1: 100, y1: 30 },
        glyphs: [],
      },
    },
  });
  assert.equal(x.ifsc.value, "SYNB0000001");
  assert.equal(x.ifsc.rawValue, "SYNBOOOOOO1");
  assert.equal(x.ifsc.status, "REQUIRES_REVIEW");
  assert.equal(x.ifsc.correctionProposal.from, "SYNBOOOOOO1");
});
test("actual local mock provider scenarios flow through API, evaluations and preserved trust", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      o = await h.login("o"),
      full = {
        ...instrument,
        type: "FDR",
        currency: "INR",
        branch: "Test",
        institutionName: "Test College",
        depositor: "Test Trust",
      },
      id = await h.create(a, { instrument: full });
    for (const [scenario, expected] of [
      ["mock_holder_conflict", "external_depositor"],
      ["mock_stale", "external_stale"],
      ["mock_partial", "external_partial"],
      ["mock_missing", "bank_confirmation"],
      ["mock_malformed", "bank_confirmation"],
      ["mock_consent_denied", "bank_confirmation"],
      ["unavailable", "bank_confirmation"],
    ]) {
      const r = await h.call("/cases/" + id + "/external", { scenario }, o);
      assert.equal(r.status, 200);
      assert.equal(r.body.classification, "MOCK");
      assert.equal(r.body.independentDepositConfirmation, false);
      const c = (await h.call("/cases/" + id, undefined, a)).body;
      assert(
        c.history
          .filter((e) => e.kind === "evaluation")
          .at(-1)
          .payload.findings.some((f) => f.code === expected),
        scenario,
      );
    }
  } finally {
    await h.close();
  }
});
