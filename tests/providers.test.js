import { test } from "node:test";
import assert from "node:assert/strict";
import { IFSCProvider, lookupIFSC, ifscManifest } from "../src/ifsc.js";
import { SetuSandboxProvider, paise } from "../src/setu.js";
test("pinned real IFSC directory has expected coverage and branch provenance", () => {
  assert.equal(ifscManifest.records, 183214);
  const r = lookupIFSC("hdfc0000001");
  assert.equal(r.status, "reference_match");
  assert.equal(r.bank, "HDFC Bank");
  assert(r.branch);
  assert.equal(r.independentDepositConfirmation, false);
  assert.equal(lookupIFSC("../private").status, "invalid");
  assert.equal(lookupIFSC("ZZZZ0000001").status, "not_found");
});
test("real IFSC service transport contract validates response and falls back offline", async () => {
  const known = lookupIFSC("HDFC0000001"),
    calls = [];
  const provider = new IFSCProvider({
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(known.record));
    },
  });
  const live = await provider.lookup("HDFC0000001");
  assert.equal(live.mode, "public_service");
  assert.equal(calls[0].url, "https://ifsc.razorpay.com/HDFC0000001");
  assert.equal(calls[0].init.redirect, "error");
  for (const fetcher of [
    async () => {
      throw Error("offline");
    },
    async () => new Response("{}"),
    async () => new Response("no", { status: 503 }),
    async () =>
      new Response(JSON.stringify({ ...known.record, IFSC: "OTHER" })),
  ]) {
    const r = await new IFSCProvider({ fetcher }).lookup("HDFC0000001");
    assert.equal(r.status, "reference_match");
    assert.equal(r.mode, "offline_fallback");
    assert.equal(r.version, ifscManifest.version);
  }
});
const consentId = "00000000-0000-4000-8000-000000000001",
  sessionId = "00000000-0000-4000-8000-000000000002",
  linkRefNumber = "fixture-account",
  dataRange = { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" };
const consent = {
  id: consentId,
  status: "ACTIVE",
  detail: {
    fiTypes: ["TERM_DEPOSIT"],
    consentExpiry: "2099-01-01T00:00:00Z",
    dataRange,
  },
};
const session = {
  id: sessionId,
  consentId,
  status: "COMPLETED",
  format: "json",
  dataRange,
  fips: [
    {
      fipID: "setu-fip",
      accounts: [
        {
          linkRefNumber,
          FIstatus: "DELIVERED",
          data: {
            account: {
              type: "term_deposit",
              version: "2.0.0",
              linkedAccRef: linkRefNumber,
              summary: {
                currency: "INR",
                principalAmount: "123456.78",
                ifsc: "HDFC0000001",
                openingDate: "2026-01-01",
                maturityDate: "2030-01-01",
              },
            },
          },
        },
      ],
    },
  ],
};
function fixture({ c = consent, s = session } = {}) {
  const calls = [];
  return {
    calls,
    provider: new SetuSandboxProvider({
      accessToken: "fixture-token",
      productInstanceId: "fixture-product",
      fetcher: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(url.includes("/consents/") ? c : s));
      },
    }),
  };
}
test("sandbox data normalizes actual term-deposit schema without inventing FDR reference or bank name", async () => {
  const { provider, calls } = fixture(),
    r = await provider.retrieve({ consentId, sessionId, linkRefNumber });
  assert.equal(r.status, "sandbox_evidence");
  assert.equal(r.values.amountPaise, 12345678);
  assert.equal(r.values.ifsc, "HDFC0000001");
  assert.equal(r.values.reference, undefined);
  assert.equal(r.values.bank, undefined);
  assert.equal(r.realBankEvidence, false);
  assert.equal(calls[0].init.headers.Authorization, "Bearer fixture-token");
  assert.equal(
    calls[0].init.headers["x-product-instance-id"],
    "fixture-product",
  );
  assert.equal(
    calls[1].url,
    "https://fiu-sandbox.setu.co/v2/sessions/" + sessionId,
  );
});
test("unconfigured, expired/revoked consent, unavailable sessions and mismatched evidence never confirm a deposit", async () => {
  assert.equal(
    (
      await new SetuSandboxProvider({
        accessToken: "",
        productInstanceId: "",
      }).retrieve({ consentId, sessionId, linkRefNumber })
    ).reason,
    "not_configured",
  );
  for (const c of [
    { ...consent, status: "REVOKED" },
    { ...consent, detail: { ...consent.detail, consentExpiry: "2020-01-01" } },
    { ...consent, detail: { ...consent.detail, fiTypes: ["DEPOSIT"] } },
  ])
    assert.equal(
      (
        await fixture({ c }).provider.retrieve({
          consentId,
          sessionId,
          linkRefNumber,
        })
      ).status,
      "unavailable",
    );
  for (const s of [
    { ...session, consentId: "different" },
    { ...session, id: "different" },
    { ...session, status: "PENDING" },
    { ...session, fips: [] },
  ])
    assert.equal(
      (
        await fixture({ s }).provider.retrieve({
          consentId,
          sessionId,
          linkRefNumber,
        })
      ).status,
      "unavailable",
    );
});
test("partial and legacy schema evidence preserves missing currency instead of guessing", async () => {
  const s = structuredClone(session);
  s.status = "PARTIAL";
  const a = s.fips[0].accounts[0].data.account;
  a.version = "1.2";
  delete a.summary.currency;
  const r = await fixture({ s }).provider.retrieve({
    consentId,
    sessionId,
    linkRefNumber,
  });
  assert.equal(r.status, "sandbox_evidence");
  assert.equal(r.partial, true);
  assert.equal(r.values.amountPaise, undefined);
  assert(r.limitations.some((x) => x.includes("Currency absent")));
});
test("sandbox transport failures, invalid money and unsupported FI schema fail safely", async () => {
  for (const v of ["1.001", "-1", "Infinity", "900719925474099100"])
    assert.throws(() => paise(v));
  assert.equal(paise("100.05"), 10005);
  const p = new SetuSandboxProvider({
    accessToken: "x",
    productInstanceId: "x",
    fetcher: async () => {
      throw Error("secret should never leak");
    },
  });
  assert.equal(
    (await p.retrieve({ consentId, sessionId, linkRefNumber })).reason,
    "provider_failure_or_invalid_evidence",
  );
  const s = structuredClone(session);
  s.fips[0].accounts[0].data.account.version = "99";
  assert.equal(
    (
      await fixture({ s }).provider.retrieve({
        consentId,
        sessionId,
        linkRefNumber,
      })
    ).status,
    "unavailable",
  );
});
test("consent/session creation uses pinned official request field names and checks ranges", async () => {
  const requests = [];
  const provider = new SetuSandboxProvider({
    accessToken: "x",
    productInstanceId: "x",
    fetcher: async (url, init) => {
      requests.push({ url, init });
      if (init.method === "POST" && url.endsWith("/consents"))
        return new Response(
          JSON.stringify({
            id: consentId,
            status: "PENDING",
            url: "https://fiu-sandbox.setu.co/v2/consents/webview/" + consentId,
          }),
        );
      if (url.includes("/consents/"))
        return new Response(JSON.stringify(consent));
      return new Response(JSON.stringify(session));
    },
  });
  await provider.createConsent({ vua: "9999999999@setu", dataRange });
  assert.deepEqual(JSON.parse(requests[0].init.body).fiTypes, ["TERM_DEPOSIT"]);
  await provider.createSession(consentId, dataRange);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), {
    consentId,
    dataRange,
    format: "json",
  });
  await assert.rejects(() =>
    provider.createSession(consentId, { from: "2020-01-01", to: "2030-01-01" }),
  );
});
