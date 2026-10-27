import { test, expect } from "./fixtures.js";
import { syntheticPolicy } from "../support/clearance-fixtures.js";
test.use({
  appOptions: { policies: [syntheticPolicy], policyScope: "synthetic-test" },
});
test("reviewer inspects explained synthetic rules and the exact historical extraction after a later correction", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const institution = await browser.newContext({ baseURL });
  try {
    const login = async (request, name) => {
      const r = await request.post("/api/login", {
        data: {
          email: name + "@test.local",
          password: "test-" + name + "-password",
        },
      });
      expect(r.status()).toBe(200);
      return { "x-csrf-token": (await r.json()).csrf };
    };
    const a = await login(institution.request, "institution"),
      o = await login(page.request, "officer");
    expect((await page.request.get("/policy-decisions.js")).status()).toBe(200);
    const created = await institution.request.post("/api/cases", {
      headers: a,
      data: {
        name: "Fictional explained policy case",
        instrument: {
          reference: "POLICY-UI",
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
    const id = (await created.json()).id,
      root = "/api/cases/" + id;
    expect(
      (
        await institution.request.post(root + "/documents", {
          headers: a,
          data: {
            mime: "text/plain",
            base64: Buffer.from(
              "Reference: POLICY-UI\nDeposit Amount: INR 125000\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssue Date: 2026-01-01\nMaturity Date: 2031-01-01",
            ).toString("base64"),
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await institution.request.post(root + "/process", {
          headers: a,
          data: {},
        })
      ).status(),
    ).toBe(200);
    const current = await (await page.request.get(root)).json(),
      original = current.currentEvidence.find((e) => e.kind === "evaluation");
    expect(
      (
        await page.request.post(root + "/extraction-corrections", {
          headers: o,
          data: {
            extractionId: original.payload.sourceReferences.extraction,
            values: { amountPaise: 13000000 },
            reason:
              "Later synthetic correction to distinguish historical extraction",
          },
        })
      ).status(),
    ).toBe(201);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open →" }).last().click();
    await page
      .getByText("Rule explanations and policy history", { exact: true })
      .click();
    await expect(
      page.getByText("Synthetic test policy — no real regulatory authority", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Recorded policy evaluation", { exact: true })
      .selectOption(original.id);
    await expect(
      page.getByRole("heading", {
        name: "minimum · Configured condition satisfied",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Inspect recorded fdr source version 1",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Evidence comparison", { exact: true }),
    ).toHaveValue("recorded");
    await expect(page.locator("#viewer-text")).toContainText("POLICY-UI");
    await expect(page.locator("#viewer-facts")).toContainText("12500000");
    await page
      .getByLabel("Historical evaluation date", { exact: true })
      .fill("2026-02-01");
    await page.locator('select[name="evaluationId"]').selectOption(original.id);
    await page.locator('select[name="policyBasis"]').selectOption("recorded");
    await page
      .getByRole("button", { name: "Replay policy evaluation", exact: true })
      .click();
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    const after = await (await page.request.get(root)).json(),
      replay = after.history
        .filter((e) => e.kind === "evaluation_replay")
        .at(-1);
    expect(replay.payload.policyConfiguration.basis).toBe(
      "RECORDED_CONFIGURATION",
    );
    expect(replay.payload.financialAssessmentAsOf).toBe(original.payload.asOf);
    await page
      .getByText("Rule explanations and policy history", { exact: true })
      .click();
    await page
      .getByLabel("Recorded policy evaluation", { exact: true })
      .selectOption(replay.id);
    await expect(
      page.getByText("Configuration basis: recorded configuration", {
        exact: true,
      }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await institution.close();
  }
});
