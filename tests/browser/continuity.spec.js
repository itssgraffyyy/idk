import { test, expect } from "./fixtures.js";
test("institution proposes a documented replacement and officer records an internal relationship without bank release", async ({
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
  const headers = await login("institution");
  const instrument = {
    reference: "CONTINUITY-OLD",
    amountPaise: 10000000,
    bank: "HDFC Bank",
    ifsc: "HDFC0001234",
    currency: "INR",
    issued: "2026-01-01",
    matures: "2031-01-01",
  };
  const created = await page.request.post("/api/cases", {
    headers,
    data: {
      name: "Continuity browser",
      instrument,
      obligation: { amountPaise: 10000000 },
    },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id,
    root = "/api/cases/" + id;
  const current = await (await page.request.get(root)).json(),
    predecessor = current.domain.instruments[0].id;
  const added = await page.request.post(root + "/instruments", {
    headers,
    data: {
      instrument: {
        ...instrument,
        reference: "CONTINUITY-NEW",
        type: "FDR",
        branch: "Synthetic branch",
      },
    },
  });
  expect(added.status()).toBe(201);
  const successor = (await added.json()).id;
  expect(
    (
      await page.request.post(root + "/documents", {
        headers,
        data: {
          instrumentId: successor,
          mime: "text/plain",
          base64: Buffer.from(
            "Synthetic replacement documentary evidence",
          ).toString("base64"),
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: "Open →" }).last().click();
  let panel = page.getByRole("region", { name: "Case review workflow" });
  await panel
    .locator("summary")
    .filter({ hasText: "Instrument continuity and replacement" })
    .click();
  await panel.getByLabel("Scenario starts").fill("2026-01-01");
  await panel.getByLabel("Scenario ends").fill("2031-01-02");
  await panel
    .getByRole("button", { name: "Analyze declared continuity" })
    .click();
  await expect(panel.locator(".continuity-result")).toContainText(
    "POTENTIAL_DECLARED_SHORTFALL",
  );
  await panel.getByLabel("Predecessor instrument").selectOption(predecessor);
  await panel.getByLabel("Successor instrument").selectOption(successor);
  await panel
    .getByLabel("Replacement explanation", { exact: true })
    .fill("Propose documented renewal");
  await panel
    .getByRole("button", { name: "Propose replacement", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(root + "/continuity/events")).json())
          .pending.length,
    )
    .toBe(1);
  await login("officer");
  await page.goto("/");
  await page.getByRole("button", { name: "Open →" }).last().click();
  panel = page.getByRole("region", { name: "Case review workflow" });
  await panel
    .locator("summary")
    .filter({ hasText: "Instrument continuity and replacement" })
    .click();
  await panel
    .getByLabel("Relationship decision", { exact: true })
    .selectOption("registered");
  await panel
    .getByLabel("Relationship decision explanation")
    .fill("Documentary relationship recorded, no bank release");
  await panel
    .getByRole("button", { name: "Record relationship decision" })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(root + "/continuity/events")).json()
        ).items.at(-1).kind,
    )
    .toBe("registered");
  const final = await (await page.request.get(root)).json();
  expect(
    final.domain.instruments.find((i) => i.id === predecessor).status,
  ).toBe("recorded");
  expect(
    final.domain.instruments.every((i) => i.verification === "UNCONFIRMED"),
  ).toBe(true);
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await panel
    .locator("summary")
    .filter({ hasText: "Lifecycle timeline and evidence support" })
    .click();
  const timeline = panel.getByLabel("Lifecycle evidence and recorded timeline");
  await expect(timeline).toContainText("continuity_registered");
  await expect(timeline).toContainText("Bank release: NOT CONFIRMED");
  await expect(timeline).toContainText("DOCUMENT_AMOUNT_REQUIRES_REVIEW");
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await timeline
    .getByRole("button", { name: "Open instrument source" })
    .click();
  await expect(page.locator("#document-preview pre")).toContainText(
    "Synthetic replacement documentary evidence",
  );
});
