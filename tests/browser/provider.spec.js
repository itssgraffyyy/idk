import { test, expect } from "./fixtures.js";
test("local financial provider scenarios are genuine API results and clearly MOCK in officer workspace", async ({
  page,
}) => {
  test.setTimeout(120000);
  let login = await page.request.post("/api/login", {
    data: {
      email: "institution@test.local",
      password: "test-institution-password",
    },
  });
  let headers = { "x-csrf-token": (await login.json()).csrf };
  const instrument = {
    reference: "PROVIDER-UI",
    amountPaise: 12500000,
    bank: "HDFC Bank",
    ifsc: "HDFC0001234",
    issued: "2026-01-01",
    matures: "2031-01-01",
    type: "FDR",
    currency: "INR",
    branch: "Test branch",
    institutionName: "Synthetic College",
    depositor: "Synthetic Trust",
  };
  const created = await page.request.post("/api/cases", {
    headers,
    data: {
      name: "Synthetic provider regression",
      instrument,
      obligation: { amountPaise: 12500000 },
    },
  });
  expect(created.status()).toBe(201);
  await page.request.post("/api/logout", { headers, data: {} });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("officer@test.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-officer-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Open →" }).last().click();
  for (const [scenario, code] of [
    ["unavailable", "bank_confirmation"],
    ["mock_conflict", "external_amountPaise"],
    ["mock_holder_conflict", "external_depositor"],
    ["mock_stale", "external_stale"],
    ["mock_partial", "external_partial"],
    ["mock_missing", "bank_confirmation"],
    ["mock_malformed", "bank_confirmation"],
    ["mock_consent_denied", "bank_confirmation"],
  ]) {
    await page
      .getByLabel("Development evidence scenario")
      .selectOption(scenario);
    await page.getByRole("button", { name: "Retrieve mock evidence" }).click();
    await expect(
      page.locator(".finding").filter({ hasText: code }),
    ).toHaveCount(1);
    await expect(page.locator("#detail")).toContainText(
      "Production bank confirmation: UNCONFIRMED",
    );
    await expect(page.locator("#detail")).toContainText("MOCK");
  }
});
