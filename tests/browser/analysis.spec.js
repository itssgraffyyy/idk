import { test, expect } from "./fixtures.js";
test("institution explores relationships, freezes a read-only scenario and verifies saved replay", async ({
  page,
}) => {
  const login = await page.request.post("/api/login", {
    data: {
      email: "institution@test.local",
      password: "test-institution-password",
    },
  });
  const headers = { "x-csrf-token": (await login.json()).csrf };
  const created = await page.request.post("/api/cases", {
    headers,
    data: {
      name: "Synthetic scenario college",
      instrument: {
        reference: "SCENARIO-UI",
        amountPaise: 12500000,
        bank: "HDFC Bank",
        ifsc: "HDFC0001234",
        issued: "2026-01-01",
        matures: "2031-01-01",
        currency: "INR",
        type: "FDR",
      },
      obligation: { amountPaise: 12500000 },
    },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id;
  const before = await (await page.request.get("/api/cases/" + id)).json();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Open →" }).last().click();
  await page.getByText("Relationships and scenarios", { exact: true }).click();
  await expect(
    page.getByText(
      "No cross-record signals within the bounded authorized scope.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByText("Read-only what-if analysis", { exact: true }).click();
  await page
    .getByRole("button", { name: "Freeze analysis snapshot", exact: true })
    .click();
  await page.getByLabel("Coverage start", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Coverage end", { exact: true }).fill("2032-01-01");
  await page
    .getByLabel("Obligation amount (integer paise)", { exact: true })
    .fill("13000000");
  await page
    .getByRole("button", { name: "Run hypothetical scenario", exact: true })
    .click();
  await expect(
    page.getByText("Hypothetical result — no approval or bank confirmation", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".analysis-content")).toContainText(
    "POTENTIAL_DECLARED_SHORTFALL",
  );
  await page
    .getByRole("button", { name: "Verify exact replay", exact: true })
    .click();
  await expect(
    page.getByText("Stored snapshot reproduced exactly.", { exact: true }),
  ).toBeVisible();
  const after = await (await page.request.get("/api/cases/" + id)).json();
  expect(after.instrument).toEqual(before.instrument);
  expect(after.revision).toBe(before.revision);
  expect(after.currentEvidence).toEqual(before.currentEvidence);
  expect(errors).toEqual([]);
});
