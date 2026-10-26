import { test, expect } from "./fixtures.js";
import { readFileSync } from "node:fs";
test("private PDF is rendered as protected page image in institution workspace", async ({
  page,
}) => {
  test.setTimeout(120000);
  const login = await page.request.post("/api/login", {
      data: {
        email: "institution@test.local",
        password: "test-institution-password",
      },
    }),
    headers = { "x-csrf-token": (await login.json()).csrf };
  const created = await page.request.post("/api/cases", {
    headers,
    data: {
      name: "PDF preview acceptance",
      instrument: {
        reference: "PDF-PREVIEW-UI",
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
  const id = (await created.json()).id;
  expect(
    (
      await page.request.post("/api/cases/" + id + "/documents", {
        headers,
        data: {
          mime: "application/pdf",
          base64: readFileSync(
            "datasets/v2/pdf/embedded-synthetic.pdf",
          ).toString("base64"),
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: "Open →" }).last().click();
  const response = page.waitForResponse((r) =>
    r.url().includes("preview=1&page=1"),
  );
  await page.getByRole("button", { name: "Preview latest source" }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  expect(result.headers()["content-type"]).toBe("image/png");
  await expect(page.locator("#pdf-image")).toBeVisible();
  await expect
    .poll(() => page.locator("#pdf-image").evaluate((img) => img.naturalWidth))
    .toBeGreaterThan(0);
});
