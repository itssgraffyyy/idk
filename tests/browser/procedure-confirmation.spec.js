import { test, expect } from "./fixtures.js";
import {
  syntheticProcedure,
  syntheticPolicy,
} from "../support/clearance-fixtures.js";
import { snapshotHash } from "../../src/clearance-procedure.js";
const procedure = {
  ...syntheticProcedure,
  classification: "UNVERIFIED_OFFICIAL",
  source: "https://issuer.example.invalid/synthetic-ui-contract.pdf",
  sourceSHA256: "b".repeat(64),
  interpretationReviewReference: "SYNTHETIC-UI-INTERPRETATION-NOT-AICTE",
};
const confirmation = {
  id: "synthetic-ui-contract",
  scope: procedure.scope,
  procedureSHA256: snapshotHash(procedure),
  sourceSHA256: procedure.sourceSHA256,
  sourceURL: procedure.source,
  issuerConfirmationReference: "SYNTHETIC-UI-CONTRACT-NO-REAL-ISSUER",
  interpretationReviewReference: procedure.interpretationReviewReference,
  reviewedBy: "synthetic-reviewer",
  confirmedAt: "2025-01-01T00:00:00Z",
  expiresOn: "2035-12-31",
  verificationContext: "SYNTHETIC_CONTRACT_TEST",
};
test.use({
  appOptions: {
    procedures: [procedure],
    procedureConfirmations: [confirmation],
    policies: [syntheticPolicy],
    policyScope: "synthetic-test",
  },
});
test("officer sees exact confirmation provenance with an explicit synthetic-only authority label", async ({
  page,
  browser,
  baseURL,
}) => {
  const institution = await browser.newContext({ baseURL }),
    supervisor = await browser.newContext({ baseURL });
  const login = async (request, user) => {
    const r = await request.post("/api/login", {
      data: {
        email: user + "@test.local",
        password: "test-" + user + "-password",
      },
    });
    expect(r.status()).toBe(200);
    return { "x-csrf-token": (await r.json()).csrf };
  };
  try {
    const a = await login(institution.request, "institution"),
      s = await login(supervisor.request, "supervisor"),
      o = await login(page.request, "officer");
    const created = await institution.request.post("/api/cases", {
      headers: a,
      data: {
        name: "Synthetic confirmation UI case",
        instrument: {
          reference: "SYNTHETIC-CONFIRM-UI",
          amountPaise: 12500000,
          bank: "HDFC Bank",
          ifsc: "HDFC0001234",
          issued: "2026-01-01",
          matures: "2031-01-01",
        },
        obligation: { amountPaise: 12500000 },
      },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;
    expect(
      (
        await supervisor.request.post("/api/clearance/activations", {
          headers: s,
          data: {
            version: procedure.version,
            scope: procedure.scope,
            revision: 0,
            reason: "Activate synthetic confirmation UI fixture",
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await page.request.post("/api/clearance/cases/" + id + "/bind", {
          headers: o,
          data: {
            scope: procedure.scope,
            revision: 0,
            reason: "Bind explicitly synthetic issuer contract",
          },
        })
      ).status(),
    ).toBe(201);
    await page.goto("/");
    await page.getByRole("button", { name: "Open →" }).last().click();
    await page
      .getByText("Department clearances and internal decision", { exact: true })
      .click();
    await page
      .getByText("Procedure source and confirmation record", { exact: true })
      .click();
    await expect(
      page.getByText(
        "Synthetic issuer contract test only — no real issuer confirmation.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Issuer reference: " + confirmation.issuerConfirmationReference,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Source: " + procedure.source, { exact: true }),
    ).toBeVisible();
  } finally {
    await institution.close();
    await supervisor.close();
  }
});
