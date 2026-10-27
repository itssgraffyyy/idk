import { test, expect } from "./fixtures.js";
import { syntheticPolicy } from "../support/clearance-fixtures.js";
test.use({
  appOptions: {
    policies: [
      {
        ...syntheticPolicy,
        rules: [
          {
            ...syntheticPolicy.rules[0],
            conditions: { programme: "engineering", level: "ug" },
          },
        ],
      },
    ],
    policyScope: "synthetic-test",
  },
});
test("officer sees contradictory applicability and requests reconciliation without offering financial-field edits", async ({
  page,
  browser,
  baseURL,
}) => {
  const institution = await browser.newContext({ baseURL });
  const login = async (request, name) => {
    const r = await request.post("/api/login", {
      data: {
        email: name + "@test.local",
        password: "test-" + name + "-password",
      },
    });
    expect(r.status()).toBe(200);
    return { "x-csrf-token": (await r.json()).csrf };
  };
  try {
    const a = await login(institution.request, "institution");
    await login(page.request, "officer");
    const created = await institution.request.post("/api/cases", {
      headers: a,
      data: {
        name: "Synthetic applicability case",
        instrument: {
          reference: "SYNTHETIC-APPLICABILITY",
          amountPaise: 12500000,
          bank: "HDFC Bank",
          ifsc: "HDFC0001234",
          issued: "2026-01-01",
          matures: "2031-01-01",
        },
        obligation: { amountPaise: 12500000 },
      },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id,
      root = "/api/cases/" + id;
    let c = await (await institution.request.get(root)).json();
    expect(
      (
        await institution.request.post(
          "/api/obligations/" + c.domain.obligation.id,
          {
            headers: a,
            data: {
              revision: 1,
              amountPaise: 12500000,
              programme: "pharmacy",
              level: "pg",
              policyVersion: syntheticPolicy.version,
              starts: "2026-01-01",
              ends: "2032-01-01",
            },
          },
        )
      ).status(),
    ).toBe(200);
    c = await (await institution.request.get(root)).json();
    expect(
      (
        await institution.request.post(root + "/regulatory-context", {
          headers: a,
          data: {
            revision: c.revision,
            context: { programme: "engineering", level: "ug" },
          },
        })
      ).status(),
    ).toBe(201);
    await page.goto("/");
    await page.getByRole("button", { name: "Open →" }).last().click();
    await expect(
      page.locator(".finding").filter({
        hasText:
          "Registered obligation and regulatory context disagree on programme",
      }),
    ).toBeVisible();
    const panel = page.getByRole("region", {
      name: "Case review workflow",
      exact: true,
    });
    await panel
      .getByText("Request a targeted clarification", { exact: true })
      .click();
    await panel
      .getByRole("combobox", { name: "Disputed finding", exact: true })
      .selectOption("applicability_conflict_programme");
    await expect(
      panel.getByLabel("Editable request", { exact: true }),
    ).toHaveValue(/obligation administration/);
    await panel
      .getByRole("button", { name: "Send targeted request", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Case review workflow", exact: true }),
    ).toContainText("applicability_conflict_programme");
    const saved = await (await page.request.get(root)).json();
    const request = saved.currentEvidence.find(
      (e) => e.kind === "clarifications",
    );
    expect(request.payload.fields).toEqual([]);
    expect(saved.instrument.reference).toBe("SYNTHETIC-APPLICABILITY");
  } finally {
    await institution.close();
  }
});
