import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, seed } from "../src/server.js";
import { validate, evaluate, extract } from "../src/engine.js";
const instrument = {
  reference: "SYN-001",
  amountPaise: 10000000,
  bank: "Synthetic Bank",
  ifsc: "SYNB0000001",
  issued: "2026-01-01",
  matures: "2030-01-01",
};
test("financial validation rejects unsafe money, malformed dates and IFSC", () => {
  for (const p of [
    { amountPaise: 1.5 },
    { amountPaise: -1 },
    { amountPaise: Number.MAX_SAFE_INTEGER + 1 },
    { issued: "2026-02-30" },
    { ifsc: "../secret" },
  ])
    assert.throws(() => validate({ ...instrument, ...p }));
  assert.deepEqual(validate(instrument), instrument);
});
test("engine explains discrepancies and never asserts regulatory compliance", () => {
  const r = evaluate({
    instrument,
    obligation: { amountPaise: 20000000 },
    extraction: extract("amountPaise: 99"),
    external: { status: "unavailable" },
    asOf: "2026-10-26",
  });
  for (const code of [
    "amount_shortfall",
    "mismatch_amountPaise",
    "bank_confirmation",
    "policy_unverified",
  ])
    assert(r.findings.some((f) => f.code === code));
  assert.equal(r.outcome, "human_review_required");
  assert(r.findings.every((f) => f.sources.length));
});
test("complete HTTP journeys and security boundaries", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-")),
    app = createApp({ dir, ocr: "nonexistent-sentinel-ocr" });
  seed(app.db, [
    {
      id: "a",
      email: "a@test.local",
      password: "test-password-a",
      role: "institution",
      tenant: "a",
    },
    {
      id: "b",
      email: "b@test.local",
      password: "test-password-b",
      role: "institution",
      tenant: "b",
    },
    {
      id: "o",
      email: "o@test.local",
      password: "test-password-o",
      role: "officer",
      tenant: "authority",
    },
    {
      id: "p",
      email: "p@test.local",
      password: "test-password-p",
      role: "officer",
      tenant: "authority",
    },
  ]);
  await new Promise((ok) => app.server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const call = async (path, method = "GET", body, auth = {}, headers = {}) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", ...auth, ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const content = r.headers.get("content-type")?.includes("json")
      ? await r.json()
      : await r.text();
    return { status: r.status, body: content, headers: r.headers };
  };
  const login = async (email) => {
    const id = email[0],
      r = await call("/login", "POST", {
        email,
        password: "test-password-" + id,
      });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    return {
      cookie: r.headers.get("set-cookie").split(";")[0],
      "x-csrf-token": r.body.csrf,
    };
  };
  try {
    await t.test("anonymous and failed logins rejected", async () => {
      assert.equal((await call("/cases")).status, 401);
      assert.equal(
        (
          await call("/login", "POST", {
            email: "a@test.local",
            password: "bad",
          })
        ).status,
        401,
      );
    });
    const a = await login("a@test.local"),
      b = await login("b@test.local"),
      o = await login("o@test.local"),
      p = await login("p@test.local");
    let id, doc;
    await t.test("CSRF and origin enforcement", async () => {
      assert.equal(
        (await call("/cases", "POST", {}, { cookie: a.cookie })).status,
        403,
      );
      assert.equal(
        (
          await call("/cases", "POST", {}, a, {
            origin: "https://evil.invalid",
          })
        ).status,
        403,
      );
    });
    await t.test("register obligation and FDR using backend", async () => {
      const r = await call(
        "/cases",
        "POST",
        {
          name: "Fictional Institute A",
          obligation: { amountPaise: 10000000 },
          instrument,
        },
        a,
      );
      assert.equal(r.status, 201);
      id = r.body.id;
      assert.equal((await call("/cases", "GET", undefined, a)).body.length, 1);
      assert.equal((await call("/cases", "GET", undefined, o)).body.length, 1);
    });
    await t.test("tenant and assigned-officer isolation", async () => {
      assert.equal(
        (await call("/cases/" + id, "GET", undefined, b)).status,
        404,
      );
      assert.equal(
        (await call("/cases/" + id, "GET", undefined, p)).status,
        404,
      );
      assert.equal((await call("/cases", "GET", undefined, b)).body.length, 0);
      assert.equal(
        (await call("/cases", "POST", { name: "x", instrument }, o)).status,
        403,
      );
      assert.equal(
        (
          await call(
            "/cases/" + id + "/external",
            "POST",
            { scenario: "mock_confirmed" },
            a,
          )
        ).status,
        403,
      );
    });
    const text =
      "SYNTHETIC TEST DOCUMENT - NOT A BANK INSTRUMENT\n" +
      Object.entries(instrument)
        .map(([k, v]) => k + ": " + v)
        .join("\n");
    await t.test(
      "validate uploads, retain hash and protect downloads",
      async () => {
        assert.equal(
          (
            await call(
              "/cases/" + id + "/documents",
              "POST",
              {
                base64: Buffer.from("<html>attack</html>").toString("base64"),
                mime: "text/html",
              },
              a,
            )
          ).status,
          400,
        );
        const r = await call(
          "/cases/" + id + "/documents",
          "POST",
          { base64: Buffer.from(text).toString("base64"), mime: "text/plain" },
          a,
        );
        assert.equal(r.status, 201);
        assert.equal(r.body.sha256.length, 64);
        doc = r.body.id;
        assert.equal(
          (
            await call(
              "/cases/" + id + "/documents/" + doc,
              "GET",
              undefined,
              b,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              "/cases/" + id + "/documents/" + doc,
              "GET",
              undefined,
              a,
            )
          ).body,
          text,
        );
        assert.equal((await fetch(base + "/data/private/" + doc)).status, 404);
      },
    );
    await t.test(
      "actual text extraction, provenance, evaluation history",
      async () => {
        const r = await call("/cases/" + id + "/process", "POST", {}, a);
        assert.equal(r.status, 200);
        assert.equal(r.body.method, "text-import");
        assert.equal(r.body.fields.reference.value, instrument.reference);
        assert.equal(r.body.documentId, doc);
        assert.equal(r.body.fields.reference.confidence, null);
      },
    );
    await t.test(
      "mock conflict and unavailable evidence classified",
      async () => {
        assert.equal(
          (
            await call(
              "/cases/" + id + "/external",
              "POST",
              { scenario: "mock_conflict" },
              o,
            )
          ).status,
          200,
        );
        let c = (await call("/cases/" + id, "GET", undefined, o)).body;
        assert(
          c.history
            .filter((e) => e.kind === "evaluation")
            .at(-1)
            .payload.findings.some((f) => f.code === "external_amountPaise"),
        );
        await call(
          "/cases/" + id + "/external",
          "POST",
          { scenario: "unavailable" },
          o,
        );
      },
    );
    await t.test(
      "corrections append history, reject stale revision",
      async () => {
        assert.equal(
          (
            await call(
              "/cases/" + id + "/corrections",
              "POST",
              {
                instrument: { ...instrument, reference: "CORRECTED" },
                revision: 1,
                reason: "Data entry correction",
              },
              a,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await call(
              "/cases/" + id + "/corrections",
              "POST",
              { instrument, revision: 1, reason: "stale" },
              a,
            )
          ).status,
          409,
        );
        const c = (await call("/cases/" + id, "GET", undefined, a)).body;
        assert.equal(c.revision, 2);
        assert.equal(
          c.history.find((e) => e.kind === "declaration").payload.reference,
          "SYN-001",
        );
        const ev = c.history.filter((e) => e.kind === "evaluation");
        assert(ev.length >= 5);
        assert.equal(ev.at(-1).payload.supersedes, ev.at(-2).id);
      },
    );
    await t.test(
      "officer clarification, institutional response and observation",
      async () => {
        assert.equal(
          (
            await call(
              "/cases/" + id + "/clarifications",
              "POST",
              { text: "Please confirm reference" },
              o,
            )
          ).status,
          201,
        );
        const c = (await call("/cases/" + id, "GET", undefined, a)).body,
          requestId = c.history
            .filter((e) => e.kind === "clarifications")
            .at(-1).id;
        assert.equal(
          (
            await call(
              "/cases/" + id + "/responses",
              "POST",
              { text: "Corrected declaration", requestId },
              a,
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await call(
              "/cases/" + id + "/observations",
              "POST",
              { text: "Awaiting independent confirmation" },
              o,
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await call(
              "/cases/" + id + "/observations",
              "POST",
              { text: "escalate me" },
              a,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "new document invalidates prior extraction; OCR failure preserved",
      async () => {
        const png = readFileSync("datasets/v1/documents/case-001.png");
        await call(
          "/cases/" + id + "/documents",
          "POST",
          { base64: png.toString("base64") },
          a,
        );
        const r = await call("/cases/" + id + "/process", "POST", {}, a);
        assert.equal(r.body.status, "failed");
        assert.equal(r.body.method, "tesseract-native");
        assert.deepEqual(r.body.fields, {});
        assert.equal(
          (
            await call(
              "/cases/" + id + "/documents/" + doc,
              "GET",
              undefined,
              a,
            )
          ).status,
          200,
        );
      },
    );
    await t.test("database guards evidence and audit immutability", () => {
      assert.throws(() => app.db.exec("UPDATE evidence SET kind='changed'"));
      assert.throws(() => app.db.exec("DELETE FROM evidence"));
      assert.throws(() => app.db.exec("UPDATE audit SET actor='changed'"));
      assert.throws(() => app.db.exec("DELETE FROM audit"));
    });
    await t.test("tampered documents fail integrity check", async () => {
      writeFileSync(join(dir, "private", doc), "tampered");
      assert.equal(
        (await call("/cases/" + id + "/documents/" + doc, "GET", undefined, a))
          .status,
        409,
      );
    });
    await t.test(
      "IFSC is explicitly fictional; logout revokes session",
      async () => {
        assert.equal(
          (await call("/ifsc?code=SYNB0000001", "GET", undefined, a)).body
            .realBankValidation,
          false,
        );
        await call("/logout", "POST", {}, a);
        assert.equal((await call("/me", "GET", undefined, a)).status, 401);
      },
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
