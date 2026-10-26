import { test, expect } from "./fixtures.js";
import { readFileSync } from "node:fs";
test("reviewer compares original/corrected fields across protected PDF versions with measured highlights and zoom", async ({
  page,
}) => {
  test.setTimeout(120000);
  let login = await page.request.post("/api/login", {
      data: {
        email: "institution@test.local",
        password: "test-institution-password",
      },
    }),
    headers = { "x-csrf-token": (await login.json()).csrf };
  const created = await page.request.post("/api/cases", {
    headers,
    data: {
      name: "Viewer version acceptance",
      instrument: {
        reference: "VIEWER-DECLARATION",
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
    path = "/api/cases/" + id;
  const upload = async () => {
    const r = await page.request.post(path + "/documents", {
      headers,
      data: {
        mime: "application/pdf",
        base64: readFileSync("datasets/v2/pdf/embedded-synthetic.pdf").toString(
          "base64",
        ),
      },
    });
    expect(r.status()).toBe(201);
    return (await r.json()).id;
  };
  const first = await upload();
  let processed = await page.request.post(path + "/process", {
    headers,
    data: {},
  });
  expect((await processed.json()).status).toBe("completed");
  const meta = await (await page.request.get(path + "/viewer/" + first)).json();
  expect(
    (
      await page.request.post(path + "/extraction-corrections", {
        headers,
        data: {
          extractionId: meta.latest.id,
          values: { reference: "REVIEWER-CORRECTED" },
          reason: "Source comparison regression",
        },
      })
    ).status(),
  ).toBe(201);
  const second = await upload();
  processed = await page.request.post(path + "/process", { headers, data: {} });
  expect((await processed.json()).status).toBe("completed");
  login = await page.request.post("/api/login", {
    data: { email: "officer@test.local", password: "test-officer-password" },
  });
  expect(login.status()).toBe(200);
  await page.goto("/");
  await page.getByRole("button", { name: "Open →" }).last().click();
  await page.getByRole("button", { name: "Preview latest source" }).click();
  await expect(page.locator("#pdf-image")).toBeVisible();
  await page
    .getByLabel("Document version", { exact: true })
    .selectOption(first);
  await expect(page.locator("#viewer-facts")).toContainText(
    "REVIEWER-CORRECTED",
  );
  await page.getByLabel("Highlight extracted field").selectOption("reference");
  await expect(page.locator("#viewer-overlay rect")).toHaveCount(1);
  await expect(page.locator("#viewer-status")).toContainText("source page 1");
  const width = await page
    .locator(".viewer-canvas")
    .evaluate((e) => e.getBoundingClientRect().width);
  await page.getByLabel("Evidence zoom (%)").focus();
  await page.getByLabel("Evidence zoom (%)").press("ArrowRight");
  await expect
    .poll(() =>
      page
        .locator(".viewer-canvas")
        .evaluate((e) => e.getBoundingClientRect().width),
    )
    .toBeGreaterThan(width);
  await page.getByLabel("Evidence comparison").selectOption("original");
  await expect(page.locator("#viewer-facts")).toContainText("PDF-TEST");
  await expect(page.locator("#viewer-facts")).not.toContainText(
    "REVIEWER-CORRECTED",
  );
  await page
    .getByLabel("Document version", { exact: true })
    .selectOption(second);
  await expect(page.locator("#viewer-facts")).toContainText("PDF-TEST");
});
