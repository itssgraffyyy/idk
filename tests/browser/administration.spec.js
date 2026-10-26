import { test, expect } from "@playwright/test";
test("institution administrator edits profile, programme/history, independent obligation and account through backend UI", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("admin@test.local");
  await page
    .getByLabel("Password", { exact: true })
    .fill("test-admin-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page
    .getByRole("button", { name: "Institution records", exact: true })
    .click();
  const form = page.locator("#profile-form");
  await form
    .getByLabel("Institution name", { exact: true })
    .fill("Synthetic Administration College");
  await form.getByLabel("Classification", { exact: true }).fill("private");
  await form.getByRole("button", { name: "Add programme" }).click();
  await form.getByLabel("Programme", { exact: true }).fill("engineering");
  await form.getByLabel("Programme level", { exact: true }).fill("ug");
  await form.getByRole("button", { name: "Add approval", exact: true }).click();
  await form.getByLabel("Approval reference").fill("TEST-APPROVAL");
  await form.getByLabel("Approval date").fill("2026-01-01");
  await form.getByLabel("Approval status").fill("claimed");
  await form.getByRole("button", { name: "Save institution profile" }).click();
  await page
    .getByRole("button", { name: "Institution records", exact: true })
    .click();
  await expect(
    page
      .locator("#profile-form")
      .getByLabel("Institution name", { exact: true }),
  ).toHaveValue("Synthetic Administration College");
  const obligation = page.locator("#obligation-form");
  await obligation.getByLabel("Programme", { exact: true }).fill("engineering");
  await obligation.getByLabel("Qualification level").fill("ug");
  await obligation.getByLabel("Required amount (paise)").fill("350000000");
  await obligation.getByLabel("Period start").fill("2026-01-01");
  await obligation.getByLabel("Period end").fill("2036-01-01");
  await obligation.getByRole("button", { name: "Save obligation" }).click();
  await page
    .getByRole("button", { name: "Institution records", exact: true })
    .click();
  await expect(page.locator("#obligation-list")).toContainText("350000000");
  const account = page.locator("#account-form");
  await account
    .getByLabel("New account email")
    .fill("created-via-ui@test.local");
  await account.getByLabel("Initial password").fill("test-created-password");
  await account.getByRole("button", { name: "Create account" }).click();
  await page
    .getByRole("button", { name: "Institution records", exact: true })
    .click();
  await expect(page.locator("#account-list")).toContainText(
    "created-via-ui@test.local",
  );
});
