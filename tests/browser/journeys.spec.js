import { test, expect } from "@playwright/test";
test("institution submits evidence; officer compares, requests clarification; institution responds", async ({
  page,
}) => {
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
  await page.getByRole("button", { name: "Process latest document" }).click();
  await expect(
    page.locator("#detail table tbody tr").first().locator("td").nth(2),
  ).toHaveText("SYN-BROWSER-001");
  await page.getByRole("button", { name: "Check IFSC" }).click();
  await expect(page.locator("#ifsc-result")).toContainText(
    "fictional_reference_match",
  );
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
