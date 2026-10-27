import { test, expect } from "./fixtures.js";
import {
  syntheticProcedure,
  syntheticPolicy,
} from "../support/clearance-fixtures.js";
test.use({
  appOptions: {
    procedures: [syntheticProcedure],
    policies: [syntheticPolicy],
    policyScope: "synthetic-test",
  },
});
test("configured synthetic department review shares only selected evidence and a separate checker records an internal decision", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  expect((await page.request.get("/clearances.js")).status()).toBe(200);
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
  const institution = await browser.newContext({ baseURL }),
    department = await browser.newContext({ baseURL }),
    officer = await browser.newContext({ baseURL });
  try {
    const a = await login(institution.request, "institution"),
      o = await login(officer.request, "officer");
    const created = await institution.request.post("/api/cases", {
      headers: a,
      data: {
        name: "Synthetic department browser case",
        instrument: {
          reference: "CLEARANCE-UI",
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
    expect(
      (
        await institution.request.post(root + "/documents", {
          headers: a,
          data: {
            mime: "text/plain",
            base64: Buffer.from(
              "Reference: CLEARANCE-UI\nDeposit Amount: INR 125000\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssue Date: 2026-01-01\nMaturity Date: 2031-01-01",
            ).toString("base64"),
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await institution.request.post(root + "/process", {
          headers: a,
          data: {},
        })
      ).status(),
    ).toBe(200);
    for (const [action, context, headers] of [
      ["submit", institution, a],
      ["intake", officer, o],
      ["ready", officer, o],
      ["review", officer, o],
    ]) {
      const state = await (
        await context.request.get(root + "/operations")
      ).json();
      expect(
        (
          await context.request.post(root + "/operations", {
            headers,
            data: {
              action,
              revision: state.revision,
              inputRevision: state.input_revision,
              reason: "Synthetic browser workflow preparation",
            },
          })
        ).status(),
      ).toBe(200);
    }
    await login(page.request, "supervisor");
    await page.goto("/");
    await page
      .getByRole("button", { name: "Department reviews", exact: true })
      .click();
    await page
      .getByText("Procedure activation and department permissions", {
        exact: true,
      })
      .click();
    await page
      .getByLabel("Activation reason", { exact: true })
      .fill("Activate explicitly synthetic browser procedure");
    await page
      .getByRole("button", { name: "Activate procedure", exact: true })
      .click();
    await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    for (const dep of ["academic", "coordination"]) {
      await page
        .getByText("Procedure activation and department permissions", {
          exact: true,
        })
        .click();
      await page
        .getByLabel("Department permission", { exact: true })
        .selectOption(dep);
      await page
        .getByLabel("Authorized department user", { exact: true })
        .selectOption("z-department");
      await page
        .getByLabel("Permission reason", { exact: true })
        .fill("Grant selected synthetic department review");
      await page
        .getByRole("button", {
          name: "Save department permission",
          exact: true,
        })
        .click();
      await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
    }
    const officerPage = await officer.newPage();
    await officerPage.goto("/");
    await officerPage.getByRole("button", { name: "Open →" }).last().click();
    await officerPage
      .getByText("Department clearances and internal decision", { exact: true })
      .click();
    await officerPage
      .getByLabel("Procedure binding reason", { exact: true })
      .fill("Bind test-only procedure to this case");
    await officerPage
      .getByRole("button", { name: "Bind active procedure", exact: true })
      .click();
    for (const step of [
      ["Synthetic academic review", "fdr"],
      ["Synthetic parallel review", null],
    ]) {
      await officerPage
        .getByText("Department clearances and internal decision", {
          exact: true,
        })
        .click();
      await officerPage
        .getByText("Request " + step[0], { exact: true })
        .click();
      if (step[1]) {
        const docSelect = officerPage.getByLabel(
          "Share document versions for " + step[0],
          { exact: true },
        );
        await docSelect.selectOption({ index: 0 });
      }
      await officerPage
        .getByLabel("Department request message for " + step[0], {
          exact: true,
        })
        .fill("Review only selected synthetic evidence");
      await officerPage
        .getByRole("button", { name: "Send " + step[0], exact: true })
        .click();
      await expect(officerPage.locator("main")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    }
    await login(department.request, "department");
    expect((await department.request.get(root)).status()).toBe(404);
    const departmentPage = await department.newPage();
    await departmentPage.goto("/");
    await departmentPage
      .getByRole("button", { name: "Department reviews", exact: true })
      .click();
    for (const dep of ["academic", "coordination"]) {
      const disclosure = departmentPage.locator("details").filter({
        has: departmentPage.locator("summary", { hasText: dep + " ·" }),
      });
      await disclosure.locator("summary").click();
      await disclosure
        .getByRole("button", { name: "Open selected request", exact: true })
        .click();
      await disclosure
        .getByLabel("Department response reason", { exact: true })
        .fill("Independently reviewed selected synthetic request");
      await disclosure
        .getByRole("button", {
          name: "Record department response",
          exact: true,
        })
        .click();
      await expect(departmentPage.locator("main")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    }
    await officerPage.reload();
    await officerPage.getByRole("button", { name: "Open →" }).last().click();
    await officerPage
      .getByText("Department clearances and internal decision", { exact: true })
      .click();
    await expect(
      officerPage.getByText(
        "Prerequisites satisfied for internal review; independent checker required.",
        { exact: true },
      ),
    ).toBeVisible();
    await officerPage
      .getByLabel("Internal decision outcome", { exact: true })
      .selectOption("approve");
    await officerPage
      .getByLabel("Maker decision reason", { exact: true })
      .fill("Propose internal synthetic documentary decision");
    await officerPage
      .getByRole("button", { name: "Propose internal decision", exact: true })
      .click();
    await page.reload();
    await page.getByRole("button", { name: "Open →" }).last().click();
    await page
      .getByText("Department clearances and internal decision", { exact: true })
      .click();
    await page
      .getByLabel("Independent checker reason", { exact: true })
      .fill("Separate authorized checker has reviewed synthetic record");
    await page
      .getByRole("button", { name: "Confirm internal decision", exact: true })
      .click();
    await expect(
      page.getByText("decision recorded", { exact: true }).first(),
    ).toBeVisible();
    const ops = await (await page.request.get(root + "/operations")).json();
    expect(ops.stage).toBe("decision_recorded");
    expect(ops.dimensions.release).toBe(
      "INTERNAL_DECISION_RECORDED_BANK_UNCONFIRMED",
    );
    expect(errors).toEqual([]);
    await page
      .getByText("Department clearances and internal decision", { exact: true })
      .click();
    await page
      .getByLabel("Case closure reason", { exact: true })
      .fill(
        "Close only the internal documentary review; bank release remains unconfirmed",
      );
    await page
      .getByRole("button", {
        name: "Close internal administrative case",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("closed", { exact: true }).first(),
    ).toBeVisible();
    await page
      .getByText("Department clearances and internal decision", { exact: true })
      .click();
    await page
      .getByLabel("Reopening reason", { exact: true })
      .fill("Explicitly reopen for fresh evidence and clearance review");
    await page
      .getByRole("button", { name: "Reopen for evidence review", exact: true })
      .click();
    await expect(
      page.getByText("reevaluation required", { exact: true }).first(),
    ).toBeVisible();
    const reopened = await (
      await page.request.get("/api/clearance/cases/" + id)
    ).json();
    expect(reopened.decisions[0].current).toBe(false);
    expect(reopened.externalRelease).toBe("NOT_CONFIRMED");
  } finally {
    await Promise.allSettled([
      institution.close(),
      department.close(),
      officer.close(),
    ]);
  }
});
