import { test, expect } from "./fixtures.js";
test("ambiguous IFSC is visible and requires a reasoned manual correction", async ({
  page,
}) => {
  test.setTimeout(60000);
  const login = await page.request.post("/api/login", {
    data: {
      email: "institution@test.local",
      password: "test-institution-password",
    },
  });
  expect(login.status()).toBe(200);
  const headers = { "x-csrf-token": (await login.json()).csrf };
  const instrument = {
    reference: "AMBIGUITY-UI",
    amountPaise: 10000000,
    bank: "HDFC Bank",
    ifsc: "HDFC0001234",
    issued: "2026-01-01",
    matures: "2030-01-01",
  };
  const created = await page.request.post("/api/cases", {
    headers,
    data: {
      name: "IFSC review regression",
      instrument,
      obligation: { amountPaise: 10000000 },
    },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id;
  const text = Object.entries(instrument)
    .map(([k, v]) => k + ": " + (k === "ifsc" ? "HDFC0001234; ICIC0001234" : v))
    .join("\n");
  const upload = await page.request.post("/api/cases/" + id + "/documents", {
    headers,
    data: {
      name: "synthetic.txt",
      mime: "text/plain",
      base64: Buffer.from(text).toString("base64"),
    },
  });
  expect(upload.status()).toBe(201);
  expect(
    (
      await page.request.post("/api/cases/" + id + "/process", {
        headers,
        data: {},
      })
    ).status(),
  ).toBe(200);
  await page.goto("/");
  await page.getByRole("button", { name: "Open →" }).last().click();
  const card = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "IFSC extraction review" }),
  });
  await expect(card).toContainText("REQUIRES_REVIEW");
  await expect(card).toContainText("Multiple or conflicting IFSC candidates");
  await expect(card).toContainText("Suggestions are not applied automatically");
  const form = page.locator("#extracted-correction");
  await expect(form.locator("[name=ifsc]")).toHaveValue("");
  await form.locator("[name=ifsc]").fill("HDFC0001234");
  await form
    .locator("[name=reason]")
    .fill(
      "Compared synthetic source; explicitly selected the first fixture identifier",
    );
  await form
    .getByRole("button", { name: "Save extraction correction" })
    .click();
  await expect(
    page.locator(".finding").filter({ hasText: "missing_ifsc" }),
  ).toHaveCount(0);
  await expect(page.locator("#detail")).toContainText("Preserved history");
  const state = await page.request.get("/api/cases/" + id);
  const history = (await state.json()).history;
  expect(history.filter((e) => e.kind === "extraction")).toHaveLength(2);
  expect(
    history.filter((e) => e.kind === "extraction")[0].payload.fields.ifsc
      .candidates,
  ).toHaveLength(2);
});
test("institution submits evidence; officer compares, requests clarification; institution responds", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByLabel("Email", { exact: true })
    .fill("institution@test.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-institution-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(
    page.getByRole("heading", { name: "Case registry", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Register submission" }).click();
  const form = page.locator("#register-form");
  await form
    .getByLabel("Fictional institution")
    .fill("Fictional Meridian Institute");
  await form.getByLabel("Obligation amount (paise)").fill("10000000");
  const values = {
    reference: "SYN-BROWSER-001",
    amountPaise: "10000000",
    bank: "Synthetic Bank",
    ifsc: "SYNB0000001",
    issued: "2026-01-01",
    matures: "2030-01-01",
  };
  for (const [k, v] of Object.entries(values))
    await form.locator('[name="' + k + '"]').fill(v);
  await form.getByRole("button", { name: "Create case" }).click();
  await expect(
    page.getByRole("heading", { name: "Fictional Meridian Institute" }),
  ).toBeVisible();
  const text =
    "SYNTHETIC ONLY\n" +
    Object.entries(values)
      .map(([k, v]) => k + ": " + v)
      .join("\n");
  await page.locator("input[type=file]").setInputFiles({
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  await page.getByRole("button", { name: "Upload privately" }).click();
  await expect(
    page.getByRole("link", { name: "Download version 1" }),
  ).toBeVisible();
  await page.route(
    "**/api/cases/*/process",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary OCR service failure" }),
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Process latest document" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Temporary OCR service failure",
  );
  await expect(
    page.getByRole("button", { name: "Process latest document" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Process latest document" }).click();
  await expect(
    page.locator("#detail table tbody tr").first().locator("td").nth(2),
  ).toHaveText("SYN-BROWSER-001");
  await page.getByRole("button", { name: "Check IFSC" }).click();
  await expect(page.locator("#ifsc-result")).toContainText("not_found");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/evaluation/institution-workspace.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email", { exact: true }).fill("officer@test.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-officer-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Open →" }).last().click();
  await page.locator("#scenario").selectOption("mock_conflict");
  await page.getByRole("button", { name: "Retrieve mock evidence" }).click();
  await expect(
    page.locator(".finding").filter({ hasText: "external_amountPaise" }),
  ).toBeVisible();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Please confirm the declared amount.");
  await page.getByRole("button", { name: "Record message" }).click();
  await expect(
    page
      .locator("#detail p")
      .filter({ hasText: "Please confirm the declared amount." }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "docs/evaluation/officer-workspace.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("institution@test.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-institution-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Open →" }).last().click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Declaration checked; awaiting independent evidence.");
  await page.getByRole("button", { name: "Record message" }).click();
  await expect(
    page.locator("#detail p").filter({
      hasText: "Declaration checked; awaiting independent evidence.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview latest source" }).click();
  await expect(page.locator("#document-preview pre")).toContainText(
    "SYNTHETIC ONLY",
  );
  const extractionForm = page.locator("#extracted-correction");
  await extractionForm.locator("[name=ifsc]").fill("OTHR0000001");
  await extractionForm
    .locator("[name=reason]")
    .fill("Source reviewed; changed fixture value for correction journey");
  await extractionForm
    .getByRole("button", { name: "Save extraction correction" })
    .click();
  await expect(
    page
      .locator("#detail table tbody tr")
      .filter({ hasText: "ifsc" })
      .locator("td")
      .nth(2),
  ).toHaveText("OTHR0000001");
  const declarationForm = page.locator("#correction");
  await declarationForm
    .locator("[name=reference]")
    .fill("SYN-BROWSER-CORRECTED");
  await declarationForm
    .locator("[name=reason]")
    .fill("Corrected fictional declaration");
  await declarationForm
    .getByRole("button", { name: "Save new revision" })
    .click();
  await expect(page.locator("#detail .title-row").first()).toContainText(
    "Revision 2",
  );
  const applicability = page.locator("#policy-context");
  const facts = {
    academicYear: "2026-27",
    programme: "engineering",
    level: "ug",
    entity: "technical",
    ownership: "private",
    application: "new_institution",
    property: "owned",
    concession: "none",
  };
  for (const [k, v] of Object.entries(facts))
    await applicability.locator('[name="' + k + '"]').selectOption(v);
  await applicability.locator("[name=applicationDate]").fill("2026-01-01");
  await applicability
    .getByRole("button", { name: "Save applicability claims" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Regulatory reference findings" }),
  ).toBeVisible();
  await expect(page.locator("#detail")).toContainText(
    "APH-2026-27-reviewed-copy-v2",
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email", { exact: true }).fill("officer@test.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-officer-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("button", { name: "Open →" }).last().click();
  const proof = page.locator("#policy-proof");
  await proof
    .locator("[name=reason]")
    .fill("Applicability checked against uploaded synthetic source");
  await proof.getByRole("button", { name: "Record evidence review" }).click();
  await expect(page.locator("#detail")).toContainText("proof_review");
  expect(errors).toEqual([]);
});
test("responsive login and rejected credentials", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("unknown@test.local");
  await page.getByLabel("Password", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("status")).toContainText("Invalid credentials");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
