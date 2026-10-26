import { test, expect } from "./fixtures.js";
test("reviewer targets a finding; institution corrects only disputed amount and reviewer closes the response", async ({
  page,
}) => {
  test.setTimeout(120000);
  const login = async (role) => {
    const r = await page.request.post("/api/login", {
      data: {
        email: role + "@test.local",
        password: "test-" + role + "-password",
      },
    });
    expect(r.status()).toBe(200);
    return { "x-csrf-token": (await r.json()).csrf };
  };
  let headers = await login("institution");
  const created = await page.request.post("/api/cases", {
    headers,
    data: {
      name: "Targeted resolution browser",
      instrument: {
        reference: "TARGETED-UI",
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
  await page.request.post("/api/cases/" + id + "/documents", {
    headers,
    data: {
      mime: "text/plain",
      base64: Buffer.from(
        "Reference: TARGETED-UI\nDeposit Amount: INR 150000\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssued: 2026-01-01\nMatures: 2031-01-01",
      ).toString("base64"),
    },
  });
  await page.request.post("/api/cases/" + id + "/process", {
    headers,
    data: {},
  });
  await login("officer");
  await page.goto("/");
  await page.getByRole("button", { name: "Open →" }).last().click();
  await page
    .getByText("Request a targeted clarification", { exact: true })
    .click();
  await page
    .getByLabel("Disputed finding")
    .selectOption("mismatch_amountPaise");
  await page
    .getByLabel("Editable request")
    .fill("Please compare the source amount and correct only that amount.");
  await page.getByRole("button", { name: "Send targeted request" }).click();
  await login("institution");
  await page.goto("/");
  await page.getByRole("button", { name: "Open →" }).last().click();
  const panel = page.getByRole("region", { name: "Case review workflow" });
  await panel
    .locator("summary")
    .filter({ hasText: "mismatch_amountPaise · open" })
    .click();
  await panel
    .getByLabel("Correct amountPaise", { exact: true })
    .fill("15000000");
  await panel
    .getByLabel("Correction explanation")
    .fill("Compared the original deposit amount");
  await panel
    .getByRole("button", { name: "Save disputed fields only" })
    .click();
  await panel
    .locator("summary")
    .filter({ hasText: "mismatch_amountPaise · open" })
    .click();
  await panel
    .getByLabel("Targeted response")
    .fill("Corrected the disputed amount; other fields unchanged");
  await panel
    .getByRole("button", { name: "Submit clarification response" })
    .click();
  const state = await (await page.request.get("/api/cases/" + id)).json();
  expect(state.instrument.amountPaise).toBe(15000000);
  expect(state.instrument.bank).toBe("HDFC Bank");
  await login("officer");
  await page.goto("/");
  await page.getByRole("button", { name: "Open →" }).last().click();
  const reviewed = page.getByRole("region", { name: "Case review workflow" });
  await reviewed
    .locator("summary")
    .filter({ hasText: "mismatch_amountPaise · responded" })
    .click();
  await reviewed
    .getByLabel("Review explanation")
    .fill("Compared correction and original evidence");
  await reviewed
    .getByRole("button", { name: "Record clarification review" })
    .click();
  await expect(reviewed).toContainText("mismatch_amountPaise · closed");
});
