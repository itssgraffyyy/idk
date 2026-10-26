import { test } from "node:test";
import assert from "node:assert/strict";
import { SetuSandboxProvider } from "../src/setu.js";
import { DevelopmentDepositProvider } from "../src/financial.js";
import { evaluate } from "../src/engine.js";
import { assessAICTE, ruleRegister } from "../src/regulatory.js";
const now = Date.parse("2026-10-26T12:00:00Z");
const range = { from: "2026-10-01T00:00:00Z", to: "2026-10-26T11:00:00Z" };
function fixture() {
  return {
    c: {
      id: "consent-test",
      status: "ACTIVE",
      detail: {
        fiTypes: ["TERM_DEPOSIT"],
        consentExpiry: "2027-01-01",
        dataRange: range,
      },
    },
    s: {
      id: "session-test",
      consentId: "consent-test",
      format: "json",
      status: "COMPLETED",
      dataRange: range,
      fips: [
        {
          fipID: "TEST-FIP",
          accounts: [
            {
              linkRefNumber: "account-test",
              FIstatus: "DELIVERED",
              data: {
                account: {
                  type: "term_deposit",
                  version: "2.0.0",
                  linkedAccRef: "account-test",
                  summary: {
                    principalAmount: "125000.00",
                    currency: "INR",
                    ifsc: "HDFC0001234",
                    openingDate: "2026-01-01",
                    maturityDate: "2030-01-01",
                  },
                },
              },
            },
          ],
        },
      ],
    },
  };
}
async function retrieve(f = fixture()) {
  return new SetuSandboxProvider({
    now: () => now,
    accessToken: "MOCK-only",
    productInstanceId: "MOCK-product",
    fetcher: async (url) =>
      new Response(JSON.stringify(url.includes("/consents/") ? f.c : f.s)),
  }).retrieve({
    consentId: "consent-test",
    sessionId: "session-test",
    linkRefNumber: "account-test",
  });
}
const instrument = {
  reference: "TEST-ONLY",
  amountPaise: 12500000,
  ifsc: "HDFC0001234",
  bank: "HDFC Bank",
  issued: "2026-01-01",
  matures: "2030-01-01",
};
const assessment = (external) =>
  evaluate({
    instrument,
    obligation: { amountPaise: 12500000 },
    external,
    asOf: "2026-10-26",
  });
test("Setu matching/amount-conflict/partial records retain explicit trust and missing instrument identity", async () => {
  let r = await retrieve();
  assert.equal(r.status, "sandbox_evidence");
  assert.equal(r.values.amountPaise, 12500000);
  assert.equal(r.classification, "SANDBOX");
  assert.equal(r.productionBankConfirmation, "UNCONFIRMED");
  assert.equal(r.values.reference, undefined);
  assert.equal(r.values.bank, undefined);
  assert.equal(r.freshness.status, "RANGE_RECENT_SNAPSHOT_UNCONFIRMED");
  assert(
    !assessment(r).findings.some((f) => f.code === "external_amountPaise"),
  );
  let f = fixture();
  f.s.fips[0].accounts[0].data.account.summary.principalAmount = "124999.99";
  assert(
    assessment(await retrieve(f)).findings.some(
      (f) => f.code === "external_amountPaise",
    ),
  );
  f = fixture();
  f.s.status = "PARTIAL";
  delete f.s.fips[0].accounts[0].data.account.summary.ifsc;
  r = await retrieve(f);
  assert(r.partial);
  assert.equal(r.values.ifsc, undefined);
  assert(assessment(r).findings.some((f) => f.code === "external_partial"));
  assert(
    assessment(r)
      .findings.find((f) => f.code === "bank_confirmation")
      .missingEvidence.includes("provider_reference"),
  );
});
test("denied/expired, missing/different/duplicate/conflicting/invalid accounts and sessions fail safely", async () => {
  const mutations = [
    (f) => (f.c.status = "REJECTED"),
    (f) => (f.c.detail.consentExpiry = "2025-01-01"),
    (f) => (f.s.status = "EXPIRED"),
    (f) => (f.s.status = "FAILED"),
    (f) => (f.s.fips = []),
    (f) => (f.s.fips[0].accounts[0].data.account.linkedAccRef = "different"),
    (f) => (f.s.fips[0].accounts[0].linkRefNumber = "different"),
    (f) => (f.s.fips[0].accounts[0].FIstatus = "DENIED"),
    (f) => {
      const a = structuredClone(f.s.fips[0].accounts[0]);
      a.data.account.summary.principalAmount = "999.99";
      f.s.fips[0].accounts.push(a);
    },
    (f) => delete f.s.fips[0].fipID,
    (f) =>
      (f.s.fips[0].accounts[0].data.account.summary.principalAmount = "12.001"),
    (f) => (f.s.fips[0].accounts[0].data.account.summary.currency = "USD"),
    (f) =>
      (f.s.fips[0].accounts[0].data.account.summary.maturityDate =
        "2030-02-30"),
    (f) => (f.s.dataRange = { from: "2020-01-01", to: "2026-10-01" }),
    (f) => delete f.s.dataRange,
    (f) => (f.s.dataRange = { from: "2026-10-26", to: "2099-01-01" }),
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    const r = await retrieve(f);
    assert.equal(r.status, "unavailable");
    assert.equal(r.values, null);
    assert.equal(r.independentDepositConfirmation, false);
  }
});
test("stale provider ranges are not refreshed by retrieval and cannot drive current mismatch findings", async () => {
  const f = fixture();
  f.s.dataRange = { from: range.from, to: "2026-10-02T00:00:00Z" };
  f.s.fips[0].accounts[0].data.account.summary.principalAmount = "1.00";
  const r = await retrieve(f);
  assert.equal(r.freshness.status, "STALE");
  const result = assessment(r);
  assert(result.findings.some((f) => f.code === "external_stale"));
  assert(!result.findings.some((f) => f.code === "external_amountPaise"));
});
test("deterministic development records remain MOCK and different instrument identifiers produce conflicts", async () => {
  const p = new DevelopmentDepositProvider(),
    r = await p.retrieve(instrument, "mock_confirmed");
  assert.equal(r.classification, "MOCK");
  assert.equal(r.productionBankConfirmation, "UNCONFIRMED");
  assert.equal(assessment(r).outcome, "human_review_required");
  const different = { ...r, values: { ...r.values, reference: "DIFFERENT" } };
  const finding = assessment(different).findings.find(
    (f) => f.code === "external_reference",
  );
  assert(finding);
  assert.deepEqual(
    finding.values.map((v) => v.value),
    ["DIFFERENT", "TEST-ONLY"],
  );
  assert(finding.suggestedAction);
  assert(finding.reason);
});
test("regulatory metadata, unsupported history, government overlap, no blanket NOC and maturity do not authorize release", () => {
  for (const rule of ruleRegister.rules) {
    assert(rule.id);
    assert("officialSource" in rule);
    assert(rule.source.documentVersion);
    assert(rule.documentVersion);
    assert(rule.effectiveAcademicYears.length);
    assert(rule.requiredEvidence.length);
    assert(rule.testReferences.length);
    assert.equal(rule.validationStatus, "UNVERIFIED_POLICY");
  }
  const context = {
    academicYear: "2024-25",
    programme: "engineering",
    level: "ug",
    entity: "government_university",
    ownership: "government",
    application: "new_programme",
    property: "owned",
    concession: "none",
    applicationDate: "2024-04-01",
  };
  let r = assessAICTE(instrument, context, [
    { type: "government_status", decision: "accepted", documentId: "proof" },
  ]);
  assert.equal(r.requiredAmountPaise, null);
  assert.equal(r.authorityVerified, false);
  r = assessAICTE(
    instrument,
    {
      ...context,
      entity: "technical",
      ownership: "private",
      application: "new_institution",
    },
    [{ type: "prior_release_noc", decision: "accepted", documentId: "proof" }],
  );
  assert.equal(r.requiredAmountPaise, 350000000);
  r = assessAICTE(
    { ...instrument, matures: "2020-01-01" },
    { ...context, application: "release" },
  );
  assert(
    r.checks.some(
      (c) => c.id === "release_clearances" && c.status === "unresolved",
    ),
  );
  assert.equal(r.status, "human_review_required");
  assert.equal(
    assessAICTE(instrument, { ...context, academicYear: "2020-21" })
      .requiredAmountPaise,
    null,
  );
});
test("active findings are unique per code even when regulatory calculation has several steps", () => {
  const r = evaluate({
    instrument,
    obligation: { amountPaise: 12500000 },
    regulatoryContext: {
      academicYear: "2026-27",
      programme: "engineering",
      level: "ug",
      entity: "technical",
      ownership: "private",
      application: "new_institution",
      property: "owned",
      concession: "none",
      applicationDate: "2026-01-01",
    },
  });
  assert.equal(new Set(r.findings.map((f) => f.code)).size, r.findings.length);
  const rule = r.findings.find((f) => f.code === "regulatory_programme_amount");
  assert(rule.details.checks.length > 1);
  assert.equal(rule.status, "unresolved");
  assert.equal(rule.policyRule, "programme_amount");
});
