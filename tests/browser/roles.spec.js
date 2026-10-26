import { test, expect } from "@playwright/test";
test("supervisor performs guarded review transition and auditor can only inspect the same authority case", async ({
  page,
}) => {
  test.setTimeout(120000);
  const login = async (email, password) => {
    const r = await page.request.post("/api/login", {
      data: { email, password },
    });
    expect(r.status()).toBe(200);
    return { "x-csrf-token": (await r.json()).csrf };
  };
  let headers = await login(
    "institution@test.local",
    "test-institution-password",
  );
  const created = await page.request.post("/api/cases", {
    headers,
    data: {
      name: "Role acceptance institution",
      instrument: {
        reference: "ROLE-BROWSER",
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
      await page.request.post("/api/cases/" + id + "/lifecycle", {
        headers,
        data: { action: "submit", reason: "Ready for review", revision: 1 },
      })
    ).status(),
  ).toBe(200);
  await page.request.post("/api/logout", { headers, data: {} });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("supervisor@test.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-supervisor-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Open →" }).last().click();
  await page.getByLabel("Lifecycle action").selectOption("start_review");
  await page.getByLabel("Transition reason").fill("Supervisor begins review");
  await page
    .getByRole("button", { name: "Record lifecycle transition" })
    .click();
  await expect(page.locator("#detail")).toContainText("under_review");
  await page.getByLabel("Historical evaluation date").fill("2026-01-01");
  const replay = page.waitForResponse(
    (r) =>
      r.url().endsWith("/policy-evaluate") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Replay policy evaluation" }).click();
  expect((await replay).status()).toBe(201);
  headers = await login("auditor@test.local", "test-auditor-password");
  await page.goto("/");
  await page.getByRole("button", { name: "Open →" }).last().click();
  await expect(page.locator("#detail")).toContainText("under_review");
  await expect(page.locator("#lifecycle-form")).toHaveCount(0);
  await expect(page.locator("#evaluate")).toBeHidden();
  expect(
    (
      await page.request.post("/api/cases/" + id + "/evaluate", {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(403);
});
