import { test, expect } from "./fixtures.js";
import { totp } from "../../src/mfa.js";
test.use({ appOptions: { mfaRequiredRoles: ["institution_admin"] } });
test("required administrator completes masked authenticator setup and signs in using a single-use recovery code", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const login = page.locator("#login-form");
  await login.getByLabel("Email", { exact: true }).fill("admin@test.local");
  await login
    .getByLabel("Password", { exact: true })
    .fill("test-admin-password");
  await login.getByRole("button", { name: "Sign in securely →" }).click();
  await expect(
    page.getByRole("heading", { name: "Account security", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Institution records", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Current account password", { exact: true })
    .fill("test-admin-password");
  await page
    .getByRole("button", { name: "Begin authenticator setup", exact: true })
    .click();
  const key = page.getByLabel("Authenticator setup key", { exact: true });
  await expect(key).toHaveAttribute("type", "password");
  const secret = await key.inputValue();
  await page
    .getByLabel("Current account password", { exact: true })
    .fill("test-admin-password");
  await page
    .getByLabel("Fresh authenticator code", { exact: true })
    .fill(totp(secret, Date.now()));
  await page
    .getByRole("button", {
      name: "Confirm authenticator enrollment",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Save these recovery codes privately",
      exact: true,
    }),
  ).toBeVisible();
  const code = page.getByLabel("Recovery code 1", { exact: true });
  await expect(code).toHaveAttribute("type", "password");
  const recovery = await code.inputValue();
  await expect(
    page.getByRole("button", { name: "Disable MFA and sign out", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login.getByLabel("Email", { exact: true }).fill("admin@test.local");
  await login
    .getByLabel("Password", { exact: true })
    .fill("test-admin-password");
  await login
    .getByText("Authenticator or recovery code", { exact: true })
    .click();
  await login.getByLabel("Recovery code", { exact: true }).fill(recovery);
  await login.getByRole("button", { name: "Sign in securely →" }).click();
  await expect(
    page.getByRole("button", { name: "Institution records", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Account security", exact: true })
    .click();
  await expect(
    page.getByText(
      "Unused recovery codes: 7. Use a new authenticator code for each successful verification.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
