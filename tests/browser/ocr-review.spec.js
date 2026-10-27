import { test, expect } from "./fixtures.js";
import { readFileSync } from "node:fs";
test("real rotated OCR presents conflicting name readings and records explicit corrections with source history intact", async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const sample = JSON.parse(
    readFileSync("datasets/v4/manifest.json"),
  ).cases.find((c) => c.id === "ocr-v4-27");
  expect(sample.split).toBe("validation");
  const login = await page.request.post("/api/login", {
    data: {
      email: "institution@test.local",
      password: "test-institution-password",
    },
  });
  expect(login.status()).toBe(200);
  const headers = { "x-csrf-token": (await login.json()).csrf };
  const created = await page.request.post("/api/cases", {
    headers,
    data: {
      name: "Fictional rotated source review",
      instrument: sample.groundTruth.extracted,
      obligation: { amountPaise: sample.groundTruth.extracted.amountPaise },
    },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id,
    root = "/api/cases/" + id;
  const uploaded = await page.request.post(root + "/documents", {
    headers,
    data: {
      mime: "image/png",
      base64: readFileSync(
        "datasets/v4/documents/" + sample.id + ".png",
      ).toString("base64"),
    },
  });
  expect(uploaded.status()).toBe(201);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open →" }).last().click();
  await page
    .getByRole("button", { name: "Process latest document", exact: true })
    .click();
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false", {
    timeout: 60000,
  });
  await expect(
    page.getByText("ocr_extraction_review_institutionName", { exact: true }),
  ).toBeVisible();
  const before = await (await page.request.get(root)).json(),
    original = before.currentEvidence.find((e) => e.kind === "extraction");
  expect(original.payload.fields.institutionName.value).toBeUndefined();
  expect(original.payload.fields.depositor.value).toBe(
    "Fictional Education Trust 27",
  );
  await page
    .getByRole("button", { name: "Preview latest source", exact: true })
    .click();
  await page.locator("#viewer-field").selectOption("institutionName");
  await expect(page.locator("#viewer-overlay rect")).toBeVisible();
  await page
    .getByText("Compare OCR readings before correction", { exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Primary OCR: Fictional Academy 277", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Secondary OCR: Fictional Academy 27. Requires explicit human review.",
      { exact: true },
    ),
  ).toBeVisible();
  const correction = page.locator("#extracted-correction");
  await correction
    .getByLabel("Institution name on instrument", { exact: true })
    .fill("Fictional Academy 27");
  await correction
    .getByLabel("Depositor", { exact: true })
    .fill("Fictional Education Trust 27");
  await correction
    .getByLabel("Reason", { exact: true })
    .fill(
      "Compared original rotated source pixels; explicitly confirmed institution and holder readings",
    );
  await correction
    .getByRole("button", { name: "Save extraction correction", exact: true })
    .click();
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  const after = await (await page.request.get(root)).json(),
    latest = after.currentEvidence.find((e) => e.kind === "extraction");
  expect(latest.payload.fields.institutionName.status).toBe("HUMAN_CORRECTED");
  expect(latest.payload.fields.depositor.status).toBe("HUMAN_CORRECTED");
  expect(latest.payload.correctedFrom).toBe(original.id);
  expect(
    after.history.find((e) => e.id === original.id).payload.fields
      .institutionName.rawValue,
  ).toBe("Fictional Academy 277");
  expect(
    after.currentEvidence
      .find((e) => e.kind === "evaluation")
      .payload.findings.some(
        (f) => f.code === "ocr_extraction_review_institutionName",
      ),
  ).toBe(false);
});
