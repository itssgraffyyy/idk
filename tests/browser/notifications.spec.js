import { test, expect } from "./fixtures.js";
test.describe.configure({ timeout: 180000 });
test("saved notification categories survive reload and the real scheduler produces a visible immutable delivery", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.log("Notification browser page error:", error.message);
  });
  const auth = await page.request.post("/api/login", {
    data: {
      email: "institution@test.local",
      password: "test-institution-password",
    },
  });
  expect(auth.status()).toBe(200);
  const headers = { "x-csrf-token": (await auth.json()).csrf };
  const created = await page.request.post("/api/cases", {
    headers,
    data: {
      name: "Scheduled missing evidence",
      instrument: {
        reference: "REMINDER-BROWSER",
        amountPaise: 10000000,
        bank: "HDFC Bank",
        ifsc: "HDFC0001234",
        issued: "2026-01-01",
        matures: "2031-01-01",
      },
      obligation: { amountPaise: 10000000 },
    },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id,
    root = "/api/cases/" + id;
  const open = async () => {
    const response = await page.goto("/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    expect(response.status()).toBe(200);
    await expect(page.locator("#registry")).toBeVisible();
    await page.getByRole("button", { name: "Open →" }).last().click();
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    const p = page.getByRole("region", { name: "Case review workflow" });
    await p
      .locator("summary")
      .filter({ hasText: "Instrument continuity and replacement" })
      .click();
    return p;
  };
  let panel = await open();
  await panel.getByLabel("Reminder day windows").fill("0");
  await panel.getByLabel("Enable my in-app reminders", { exact: true }).check();
  await panel.getByLabel("Declared maturity", { exact: true }).uncheck();
  await panel
    .getByLabel("Awaiting clarification response", { exact: true })
    .uncheck();
  await panel
    .getByLabel("Missing instrument evidence", { exact: true })
    .check();
  await panel.getByRole("button", { name: "Save my reminders" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(root + "/reminders")).json()).categories,
    )
    .toEqual(["missing_evidence"]);
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  panel = await open();
  await expect(
    panel.getByLabel("Missing instrument evidence", { exact: true }),
  ).toBeChecked();
  await expect(
    panel.getByLabel("Declared maturity", { exact: true }),
  ).not.toBeChecked();
  // Exercise the actual one-minute worker, not an injected notification or a fake clock API.
  await expect
    .poll(
      async () =>
        (await (await page.request.get(root + "/reminders/history")).json())
          .items.length,
      { timeout: 90000, intervals: [1000] },
    )
    .toBe(1);
  await panel
    .locator("summary")
    .filter({ hasText: "My reminder delivery history" })
    .click();
  await panel.getByRole("button", { name: "Load reminder deliveries" }).click();
  await expect(panel).toContainText("missing_evidence");
  await expect(panel).toContainText("Operational as-of");
  const records = await (
    await page.request.get(root + "/reminders/history")
  ).json();
  expect(records.items[0].context.source.instrumentId).toBeTruthy();
  expect(records.items[0].context.dateBasis).toBe("Asia/Kolkata civil date");
  expect(errors).toEqual([]);
});
