import { test, expect } from "@playwright/test";
test("guided upload-first draft survives reload, prefills only chosen proposals and receives persisted acknowledgement", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page
    .getByLabel("Email", { exact: true })
    .fill("institution@test.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-institution-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page
    .getByRole("button", { name: "Guided submission", exact: true })
    .click();
  await page.getByRole("button", { name: "Start a saved draft" }).click();
  await page
    .getByLabel("Submission institution name")
    .fill("Guided Synthetic College");
  await page
    .getByLabel("Submission obligation amount (paise)")
    .fill("12500000");
  await page
    .getByRole("button", { name: "Save progress", exact: true })
    .click();
  await expect(page.locator("#draft-save-status")).toHaveText(
    "Saved privately",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Guided submission", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Continue saved draft · Guided Synthetic College",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Submission institution name")).toHaveValue(
    "Guided Synthetic College",
  );
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page
    .getByLabel("Draft source document")
    .setInputFiles({
      name: "synthetic-draft.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Reference: GUIDED-BROWSER\nDeposit Amount: INR 125000\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssue Date: 2026-01-01\nMaturity Date: 2031-01-01",
      ),
    });
  await page.getByRole("button", { name: "Save private source" }).click();
  await page.getByRole("button", { name: "Extract draft fields" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();
  for (const key of [
    "reference",
    "amountPaise",
    "bank",
    "ifsc",
    "issued",
    "matures",
  ]) {
    await page
      .getByRole("button", { name: "Use " + key + " proposal", exact: true })
      .click();
    await page
      .getByLabel("I confirmed " + key + " against its source", { exact: true })
      .check();
  }
  await expect(
    page.getByLabel("Submission reference", { exact: true }),
  ).toHaveValue("GUIDED-BROWSER");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.locator("#draft-step")).toContainText(
    "POSSIBLE WITH REVIEW WARNINGS",
  );
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("button", { name: "Submit confirmed draft" }).click();
  await expect(page.locator("#notice")).toContainText(
    "Submission acknowledged",
  );
  await expect(
    page.getByRole("region", { name: "Case review workflow" }),
  ).toContainText("submitted");
});
