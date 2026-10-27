import { test, expect } from "./fixtures.js";
import { writeFileSync } from "node:fs";

async function prepare(page) {
  const login = await page.request.post("/api/login", {
    data: {
      email: "institution@test.local",
      password: "test-institution-password",
    },
  });
  expect(login.status()).toBe(200);
  const headers = { "x-csrf-token": (await login.json()).csrf };
  const due = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < 3; i++) {
    const response = await page.request.post("/api/cases", {
      headers,
      data: {
        name: i === 2 ? "Synthetic maturity task" : "Synthetic inventory " + i,
        instrument: {
          reference: "UX-TASK-" + i,
          amountPaise: 10000000,
          bank: "HDFC Bank",
          ifsc: "HDFC0001234",
          issued: "2026-01-01",
          matures: i === 2 ? due : "2031-01-01",
        },
        obligation: { amountPaise: 10000000 },
      },
    });
    expect(response.status()).toBe(201);
  }
  return { headers, due };
}

test("mobile overview supports keyboard navigation, scoped analytics and optional content-free task measurement", async ({
  page,
}) => {
  test.setTimeout(90000);
  await prepare(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#attention-overview")).toContainText(
    "Maturity within 30 days",
  );
  const nav = page.getByRole("button", {
    name: "Overview and analytics",
    exact: true,
  });
  await expect(nav).toBeVisible();
  await nav.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Operational analytics", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByText("Optional workflow measurement", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Task to measure" })
    .selectOption("evidence");
  await page
    .getByRole("button", { name: "Start task measurement", exact: true })
    .click();
  await page
    .getByText("Metric definitions and limits", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Analytics history window" })
    .selectOption("7");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await page
    .getByRole("button", { name: "Finish and save measurement", exact: true })
    .click();
  await expect(page.locator("#measurement-controls")).toContainText(
    "Measurement saved",
  );
  const data = await (await page.request.get("/api/analytics?days=7")).json();
  expect(data.cases).toBe(3);
  expect(data.measurements.evidence.samples).toBe(1);
  expect(data.measurements.evidence.manualFields).toBe(1);
  expect(data.measurements.evidence.help).toBeGreaterThanOrEqual(1);
  expect(data.measurements.evidence.clicks).toBeGreaterThan(0);
  await page.screenshot({
    path: "docs/evaluation/phase-4d-mobile-analytics.png",
    fullPage: true,
  });
});

test("paired scripted maturity navigation records actual timings without claiming human productivity gains", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { due } = await prepare(page);
  const trials = [];
  for (const mode of [
    "registry",
    "overview",
    "overview",
    "registry",
    "registry",
    "overview",
  ]) {
    await page.goto("/");
    await expect(page.locator("#registry tbody tr")).toHaveCount(3);
    await expect(page.locator("#attention-overview")).toContainText(
      "Maturity within 30 days",
    );
    let apiRequests = 0;
    const count = (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests++;
    };
    page.on("request", count);
    const started = performance.now();
    if (mode === "registry")
      await page
        .locator("#registry tbody tr")
        .filter({ hasText: due })
        .getByRole("button", { name: /Open/ })
        .click();
    else
      await page
        .locator("#attention-overview li")
        .filter({ hasText: "Maturity within 30 days" })
        .getByRole("button", { name: "Synthetic maturity task", exact: true })
        .click();
    await expect(page.locator("#detail h1")).toHaveText(
      "Synthetic maturity task",
    );
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    trials.push({
      mode,
      elapsedMs: performance.now() - started,
      clicks: 1,
      apiRequests,
    });
    page.off("request", count);
  }
  writeFileSync(
    "docs/evaluation/phase-4d-task-comparison.json",
    JSON.stringify(
      {
        method:
          "Same three synthetic cases, same authorized account, same maturity identification and opening task, alternating conventional registry and new attention overview within current build. Automated selectors, warm browser; setup excluded. No human study, historical-version comparison or productivity claim.",
        trials,
      },
      null,
      2,
    ) + "\n",
  );
  await page.screenshot({
    path: "docs/evaluation/phase-4d-case-workspace.png",
    fullPage: true,
  });
});
