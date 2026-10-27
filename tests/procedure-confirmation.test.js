import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { syntheticProcedure } from "./support/clearance-fixtures.js";
import {
  clearanceReadiness,
  procedureTrust,
  validateProcedureConfirmations,
  snapshotHash,
} from "../src/clearance-procedure.js";
import { runScenario } from "../src/scenario-analysis.js";
const procedure = {
  ...syntheticProcedure,
  classification: "UNVERIFIED_OFFICIAL",
  source: "https://issuer.example.invalid/synthetic-contract.pdf",
  sourceSHA256: "a".repeat(64),
  interpretationReviewReference: "SYNTHETIC-CONTRACT-INTERPRETATION-NOT-AICTE",
};
const confirmation = {
  id: "synthetic-contract-confirmation",
  scope: procedure.scope,
  procedureSHA256: snapshotHash(procedure),
  sourceSHA256: procedure.sourceSHA256,
  sourceURL: procedure.source,
  issuerConfirmationReference: "SYNTHETIC-CONTRACT-ONLY-NOT-AN-ISSUER-LETTER",
  interpretationReviewReference: procedure.interpretationReviewReference,
  reviewedBy: "synthetic-reviewer",
  confirmedAt: "2025-01-01T00:00:00Z",
  expiresOn: "2035-12-31",
  verificationContext: "SYNTHETIC_CONTRACT_TEST",
};
test("procedure confirmation binds exact source, interpretation and version; synthetic contract never becomes real issuer authority", () => {
  const responses = procedure.requirements.map((r) => ({
    requirementId: r.id,
    status: "accepted",
    current: true,
  }));
  assert.equal(
    procedureTrust(procedure, [], "2026-10-27").operationPermitted,
    false,
  );
  const result = clearanceReadiness({
    procedure,
    responses,
    confirmations: [confirmation],
    asOf: "2026-10-27",
  });
  assert.equal(result.readyForInternalReview, true);
  assert.equal(result.classification, "SYNTHETIC");
  assert.equal(result.realRegulatoryAuthority, false);
  assert.equal(result.administrativeApproval, false);
  assert.equal(result.externalRelease, "NOT_CONFIRMED");
  assert.equal(result.procedureTrust.issuerConfirmationRecorded, false);
  for (const changed of [
    { ...procedure, sourceSHA256: "b".repeat(64) },
    { ...procedure, version: "SYNTHETIC-DIFFERENT-VERSION" },
    { ...procedure, interpretationReviewReference: "Changed interpretation" },
    {
      ...procedure,
      requirements: [
        { ...procedure.requirements[0], mandatory: false },
        procedure.requirements[1],
      ],
    },
  ])
    assert.equal(
      procedureTrust(changed, [confirmation], "2026-10-27").operationPermitted,
      false,
    );
  assert.equal(
    procedureTrust(procedure, [confirmation], "2040-01-01").status,
    "CONFIRMATION_NOT_EFFECTIVE",
  );
  assert.equal(
    procedureTrust(procedure, [confirmation], "2024-01-01").operationPermitted,
    false,
  );
  const ambiguous = procedureTrust(
    procedure,
    [confirmation, { ...confirmation, id: "synthetic-conflicting-record" }],
    "2026-10-27",
  );
  assert.equal(ambiguous.status, "AMBIGUOUS_CONFIRMATIONS");
  assert.equal(ambiguous.operationPermitted, false);
});
test("confirmation schema rejects client-like flags, non-synthetic contract scope, missing provenance and fake independent test sources", () => {
  for (const changed of [
    { ...confirmation, issuerConfirmed: true },
    { ...confirmation, scope: "aicte" },
    { ...confirmation, sourceSHA256: "unknown" },
    { ...confirmation, issuerConfirmationReference: "" },
    { ...confirmation, interpretationReviewReference: "" },
    { ...confirmation, sourceURL: "http://issuer.example.invalid/file" },
    { ...confirmation, verificationContext: "INDEPENDENT_ISSUER_CONFIRMATION" },
    { ...confirmation, expiresOn: "2024-01-01" },
  ])
    assert.throws(() => validateProcedureConfirmations([changed]));
  assert.throws(() =>
    validateProcedureConfirmations([confirmation, confirmation]),
  );
});
test("frozen pre-confirmation synthetic and unverified scenario wire results remain exactly reproducible", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/analysis-v1-compatibility.json", import.meta.url),
    ),
  );
  assert.equal(
    fixture.classification,
    "SYNTHETIC_COMPATIBILITY_FIXTURE_NOT_ISSUER_EVIDENCE",
  );
  assert.equal(fixture.sourceCommit, "1bae77b");
  for (const sample of fixture.cases)
    assert.deepEqual(
      JSON.parse(JSON.stringify(runScenario(sample.snapshot, sample.changes))),
      sample.result,
      sample.classification,
    );
});
