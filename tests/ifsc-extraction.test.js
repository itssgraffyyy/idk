import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeIFSC,
  normalizeIFSCCandidate,
  validIFSC,
} from "../src/ifsc-extraction.js";
import { extract } from "../src/extraction.js";
import { IFSCProvider } from "../src/ifsc.js";
const now = "2026-10-26";
test("IFSC candidates separate normalization, syntax, reference, confidence and provenance", () => {
  assert(validIFSC("ABCD0ABC123"));
  assert(!validIFSC("ABCD1ABC123"));
  assert.equal(normalizeIFSCCandidate("(hdfc-0001234)."), "HDFC0001234");
  for (const text of [
    "IFSC Code : (hdfc-0001234).",
    "IFSC : HDFC 000 1234",
    "IFSC : HDFC\n0001234",
    "IFSC Code:\nHDFC0001234",
  ]) {
    const r = analyzeIFSC(text, { asOf: now });
    assert.equal(r.value, "HDFC0001234");
    assert.equal(r.candidates[0].reference.bank, "HDFC Bank");
    assert.equal(r.independentDepositConfirmation, false);
  }
  const unknown = analyzeIFSC("IFSC: ZZZZ0123456", { asOf: now });
  assert.equal(unknown.value, "ZZZZ0123456");
  assert.equal(unknown.status, "REQUIRES_REVIEW");
  assert.equal(unknown.candidates[0].reference.status, "not_found");
  assert.equal(analyzeIFSC("no identifier").status, "MISSING");
  assert.equal(analyzeIFSC("IFSC: wrong").value, undefined);
});
test("confusion suggestions never replace raw identifier, including structurally valid suffix ambiguity", () => {
  const lookup = (code) => ({
    status: code === "ABCD0123456" ? "reference_match" : "not_found",
    bank: "Fixture",
    releaseDate: now,
    version: "MOCK",
  });
  const r = analyzeIFSC("IFSC: ABCDO123456", { lookup, asOf: now });
  assert.equal(r.status, "REQUIRES_REVIEW");
  assert.equal(r.value, undefined);
  assert.equal(r.rawValue, "ABCDO123456");
  assert.equal(r.candidates[0].suggestions[0].value, "ABCD0123456");
  const suffix = analyzeIFSC("IFSC: ABCD012O456", { lookup, asOf: now });
  assert.equal(suffix.value, "ABCD012O456");
  assert.equal(suffix.status, "REQUIRES_REVIEW");
});
test("multiple, conflicting, low-confidence, bank-mismatched and outdated references require review", () => {
  for (const text of [
    "IFSC: HDFC0001234; ICIC0001234",
    "IFSC: HDFC0001234\nIFSC: ICIC0001234",
  ]) {
    const r = analyzeIFSC(text, { asOf: now });
    assert.equal(r.status, "REQUIRES_REVIEW");
    assert.equal(r.value, undefined);
    assert.equal(r.candidates.length, 2);
  }
  assert(
    analyzeIFSC("IFSC: HDFC0001234", { bank: "Other", asOf: now }).reasons.some(
      (x) => x.includes("Bank"),
    ),
  );
  assert(
    analyzeIFSC("IFSC: HDFC0001234", {
      engineConfidence: 12,
      asOf: now,
    }).reasons.some((x) => x.includes("confidence")),
  );
  assert(
    analyzeIFSC("IFSC: HDFC0001234", { asOf: "2099-01-01" }).reasons.some((x) =>
      x.includes("freshness"),
    ),
  );
  assert.equal(extract("IFSC: ABCDO123456").ifsc.value, undefined);
});
test("offline fallback preserves reference version and never authenticates the deposit", async () => {
  const r = await new IFSCProvider({
    fetcher: async () => {
      throw Error("network unavailable");
    },
  }).lookup("HDFC0001234");
  assert.equal(r.mode, "offline_fallback");
  assert.equal(r.status, "reference_match");
  assert.equal(r.independentDepositConfirmation, false);
});
test("candidate processing is bounded and never selects from a truncated candidate set", () => {
  const r = analyzeIFSC("IFSC: HDFC0001234\n".repeat(10000));
  assert.equal(r.value, undefined);
  assert.equal(r.status, "REQUIRES_REVIEW");
  assert(r.candidates.length <= 8);
  assert(r.reasons.some((s) => s.includes("resource limit")));
  assert.equal(
    analyzeIFSC("IFSC: HDFC0001234" + " ".repeat(400) + "; ICIC0001234").value,
    undefined,
  );
});
