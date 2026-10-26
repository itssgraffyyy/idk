import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessAICTE,
  validateContext,
  ruleRegister,
} from "../src/regulatory.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const context = {
    academicYear: "2024-25",
    programme: "engineering",
    level: "ug",
    entity: "technical",
    ownership: "private",
    application: "new_institution",
    property: "owned",
    concession: "none",
    applicationDate: "2024-04-01",
  },
  instrument = { amountPaise: 999999999 };
const proof = (type) => ({
    type,
    decision: "accepted",
    documentId: "source-id",
  }),
  run = (c = {}, proofs = [proof("applicability")]) =>
    assessAICTE(instrument, { ...context, ...c }, proofs, "2026-10-26");
test("every registered rule has clause, applicability, source hash, pinned document and tested behavior", () => {
  for (const r of ruleRegister.rules) {
    assert(r.source.clause);
    assert(r.applicability);
    const bytes = readFileSync(r.source.path);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      r.source.sha256,
    );
    assert.equal(r.source.issuerHostConfirmed, false);
  }
});
test("all supported programme table cells use exact integer paise", () => {
  const table = {
    engineering: [15, 35, 15],
    planning: [15, 15, 15],
    applied_arts: [15, 15, 15],
    design: [15, 15, 15],
    hmct: [15, 15, 15],
    computer_applications: [null, 5, 15],
    management: [null, 5, 15],
  };
  for (const [programme, values] of Object.entries(table))
    for (const [i, level] of ["diploma", "ug", "pg"].entries()) {
      const r = run({ programme, level });
      assert.equal(
        r.requiredAmountPaise,
        values[i] === null ? null : values[i] * 10000000,
      );
      assert.equal(r.status, "human_review_required");
      assert.equal(r.authorityVerified, false);
    }
});
test("academic-year lease amendments and concessions are selected without unsafe interaction assumptions", () => {
  assert.equal(
    run({ property: "private_lease" }).requiredAmountPaise,
    700000000,
  );
  assert.equal(
    run({ property: "government_lease" }).requiredAmountPaise,
    350000000,
  );
  assert.equal(
    run({ academicYear: "2026-27", property: "government_lease" })
      .requiredAmountPaise,
    700000000,
  );
  assert.equal(
    run({ academicYear: "2026-27", concession: "women_only" }, [
      proof("applicability"),
      proof("special_category"),
    ]).requiredAmountPaise,
    175000000,
  );
  assert.equal(
    run(
      {
        academicYear: "2026-27",
        property: "private_lease",
        concession: "women_only",
      },
      [proof("special_category")],
    ).requiredAmountPaise,
    null,
  );
  assert.equal(
    run({ concession: "women_only" }).requiredAmountPaise,
    350000000,
  );
});
test("conditional government, regulator, NOC and amended university exemptions require referenced proof", () => {
  assert.equal(
    run({ ownership: "government" }, [proof("government_status")])
      .requiredAmountPaise,
    0,
  );
  assert.notEqual(run({ ownership: "government" }, []).requiredAmountPaise, 0);
  const university = {
    entity: "private_university",
    application: "new_programme",
    ugcRecognitionDate: "2000-01-01",
  };
  assert.equal(
    run(university, [proof("ugc_recognition")]).requiredAmountPaise,
    350000000,
  );
  assert.equal(
    run({ ...university, academicYear: "2025-26" }, [proof("ugc_recognition")])
      .requiredAmountPaise,
    0,
  );
  assert.equal(
    run(
      { application: "clause_1_3_3", regulatorRecognitionDate: "2010-01-01" },
      [proof("prior_regulator")],
    ).requiredAmountPaise,
    0,
  );
  assert.notEqual(
    run(
      { application: "clause_1_3_3", regulatorRecognitionDate: "2019-04-01" },
      [proof("prior_regulator")],
    ).requiredAmountPaise,
    0,
  );
  assert.equal(
    run({}, [proof("prior_release_noc")]).requiredAmountPaise,
    350000000,
  );
  assert.equal(
    run({ entity: "private_university" }, [proof("prior_release_noc")])
      .requiredAmountPaise,
    0,
  );
});
test("holding clock uses Council deposit date, administrative proof interval is checked and release never automatic", () => {
  const r = run({
    application: "new_programme",
    depositDate: "2020-03-01",
    intimationDate: "2026-01-01",
    paymentDate: "2026-01-20",
  });
  assert.equal(
    r.checks.find((x) => x.id === "holding_period").referenceHoldingEnd,
    "2030-03-01",
  );
  assert.equal(
    r.checks.find((x) => x.id === "payment_and_affidavit").status,
    "review",
  );
  const good = run(
    {
      application: "new_programme",
      intimationDate: "2026-01-01",
      paymentDate: "2026-01-10",
    },
    [proof("payment_affidavit3")],
  );
  assert.equal(
    good.checks.find((x) => x.id === "payment_and_affidavit").status,
    "reference_supported",
  );
  assert.equal(run({ application: "release" }).requiredAmountPaise, null);
});
test("unsupported years, missing facts and invalid dates stay reviewable", () => {
  assert.equal(assessAICTE(instrument, {}).requiredAmountPaise, null);
  assert.equal(run({ academicYear: "2027-28" }).requiredAmountPaise, null);
  assert.throws(() => validateContext({ applicationDate: "2026-02-30" }));
  assert.throws(() => validateContext({ unexpected: true }));
  assert.equal(
    run({ academicYear: "2025-26", level: "pg_certificate" })
      .requiredAmountPaise,
    150000000,
  );
});
