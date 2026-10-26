import http from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, seed } from "../src/server.js";
import { openStore } from "../src/store.js";
import { extract } from "../src/extraction.js";
const instrument = {
  reference: "QUALITY-001",
  amountPaise: 10000000,
  bank: "HDFC Bank",
  ifsc: "HDFC0000001",
  issued: "2026-01-01",
  matures: "2030-01-01",
};
const users = [
  {
    id: "a",
    email: "a@test.local",
    password: "audit-password",
    role: "institution",
    tenant: "a",
  },
  {
    id: "b",
    email: "b@test.local",
    password: "audit-password",
    role: "institution",
    tenant: "b",
  },
  {
    id: "o",
    email: "o@test.local",
    password: "audit-password",
    role: "officer",
    tenant: "authority",
  },
  {
    id: "p",
    email: "p@test.local",
    password: "audit-password",
    role: "officer",
    tenant: "authority",
  },
];
async function harness(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-audit-")),
    app = createApp({ dir, ...options });
  seed(app.db, users);
  await new Promise((ok) => app.server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const call = async (path, body, auth = {}, headers = {}) => {
    const r = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...auth, ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  const login = async (email) => {
    const r = await call("/login", { email, password: "audit-password" });
    assert.equal(r.status, 200);
    return {
      cookie: r.headers.get("set-cookie").split(";")[0],
      "x-csrf-token": r.body.csrf,
    };
  };
  return {
    dir,
    app,
    base,
    call,
    login,
    close: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("IFSC and INR/date parsing retain raw evidence and refuse unsafe ambiguity", () => {
  const x = extract(
    "FDR No.: FICTION-1\nDeposit Amount (INR): 1,23,456.78\nBank Name: HDFC Bank\nIFSC Code: hdfc 0000001\nDeposit Date: 12 March 2026\nMaturity Date: 2030-01-01",
  );
  assert.equal(x.amountPaise.value, 12345678);
  assert.equal(x.amountPaise.rawValue, "1,23,456.78");
  assert.equal(x.ifsc.value, "HDFC0000001");
  assert.equal(x.issued.value, "2026-03-12");
  assert.equal(extract("Deposit Amount (INR): 1.001").amountPaise, undefined);
  assert.equal(extract("Issue date: 01/02/2026").issued, undefined);
  assert.equal(extract("IFSC: HDFCOOOOOO1").ifsc.value, "HDFCOOOOOO1");
});
test("single-instance lease, migration checksums and data survive reopen", async () => {
  const h = await harness();
  try {
    assert.throws(() => createApp({ dir: h.dir }), /already served/);
    const a = await h.login("a@test.local"),
      id = (
        await h.call(
          "/cases",
          {
            name: "Audit Institute",
            instrument,
            obligation: { amountPaise: 10000000 },
          },
          a,
        )
      ).body.id;
    assert.equal(
      h.app.db.prepare("SELECT count(*) n FROM schema_migrations").get().n,
      1,
    );
    assert.throws(() =>
      h.app.db
        .prepare("UPDATE cases SET obligation=? WHERE id=?")
        .run('{"amountPaise":-1}', id),
    );
    assert.throws(() =>
      h.app.db
        .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
        .run("bad", "bad", "digest", null, "a"),
    );
  } finally {
    await h.app.close();
  }
  const reopened = openStore(h.dir);
  assert.equal(reopened.prepare("SELECT count(*) n FROM cases").get().n, 1);
  reopened.close();
  rmSync(h.dir, { recursive: true, force: true });
});
test("idempotency, concurrent edits, host/session boundaries and policy claims are backend enforced", async () => {
  const h = await harness();
  try {
    const a = await h.login("a@test.local"),
      b = await h.login("b@test.local"),
      o = await h.login("o@test.local"),
      body = {
        name: "Audit Institute",
        instrument,
        obligation: { amountPaise: 10000000 },
      },
      headers = { "idempotency-key": "audit-request-key" };
    const first = await h.call("/cases", body, a, headers),
      again = await h.call("/cases", body, a, headers);
    assert.equal(first.status, 201);
    assert.equal(again.body.id, first.body.id);
    assert.equal(
      (await h.call("/cases", { ...body, name: "Different" }, a, headers))
        .status,
      409,
    );
    const id = first.body.id;
    const edits = await Promise.all(
      [1, 2].map((n) =>
        h.call(
          "/cases/" + id + "/corrections",
          {
            revision: 1,
            instrument: { ...instrument, reference: "CHANGE-" + n },
            reason: "Concurrent edit test",
          },
          a,
        ),
      ),
    );
    assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
    const revision = (await h.call("/cases/" + id, undefined, a)).body.revision;
    const context = {
      academicYear: "2026-27",
      programme: "engineering",
      level: "ug",
      entity: "technical",
      ownership: "private",
      application: "new_institution",
      property: "owned",
      concession: "none",
      applicationDate: "2026-01-01",
    };
    assert.equal(
      (
        await h.call(
          "/cases/" + id + "/regulatory-context",
          { context, revision },
          a,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await h.call(
          "/cases/" + id + "/regulatory-context",
          { context, revision },
          o,
        )
      ).status,
      403,
    );
    assert.equal((await h.call("/cases/" + id, undefined, b)).status, 404);
    assert.equal(
      (
        await h.call(
          "/cases/" + id + "/sandbox-consent",
          { vua: "9999999999", dataRange: {} },
          a,
        )
      ).status,
      503,
    );
    assert.equal(
      (
        await h.call(
          "/cases/" + id + "/sandbox-evidence",
          { sessionId: "other", consentId: "other" },
          o,
        )
      ).status,
      404,
    );
    assert.equal(
      await new Promise((ok, no) => {
        const req = http.request(
          h.base + "/api/me",
          { headers: { ...a, Host: "attacker.example" } },
          (r) => {
            r.resume();
            ok(r.statusCode);
          },
        );
        req.on("error", no);
        req.end();
      }),
      400,
    );
    assert.equal(
      (await h.call("/cases/..%2F..%2Fprivate", undefined, a)).status,
      404,
    );
    const result = await h.call("/cases/" + id + "/evaluate", {}, a);
    assert.equal(result.status, 201);
    assert.equal(typeof result.body.id, "string");
  } finally {
    await h.close();
  }
});
test("in-flight OCR cannot supersede manual correction and session revocation cancels evidence writes", async () => {
  let count = 0,
    release,
    started;
  const signal = () => new Promise((ok) => (started = ok));
  let wait = signal();
  const text = Object.entries(instrument)
    .map(([k, v]) => k + ": " + v)
    .join("\n");
  const h = await harness({
    ocrRunner: async () => {
      count++;
      if (count > 1) {
        started();
        await new Promise((ok) => (release = ok));
      }
      return { stdout: JSON.stringify({ text, blocks: [], confidence: 90 }) };
    },
  });
  try {
    const a = await h.login("a@test.local"),
      id = (
        await h.call(
          "/cases",
          { name: "Audit", instrument, obligation: { amountPaise: 10000000 } },
          a,
        )
      ).body.id;
    await h.call(
      "/cases/" + id + "/documents",
      {
        base64: readFileSync("datasets/v1/documents/case-001.png").toString(
          "base64",
        ),
      },
      a,
    );
    await h.call("/cases/" + id + "/process", {}, a);
    const original = (await h.call("/cases/" + id, undefined, a)).body.history
      .filter((e) => e.kind === "extraction")
      .at(-1);
    const pending = h.call("/cases/" + id + "/process", {}, a);
    await wait;
    assert.equal(
      (
        await h.call(
          "/cases/" + id + "/extraction-corrections",
          {
            extractionId: original.id,
            values: { reference: "REVIEWED" },
            reason: "Manual correction while OCR is running",
          },
          a,
        )
      ).status,
      201,
    );
    release();
    assert.equal((await pending).status, 409);
    const after = (await h.call("/cases/" + id, undefined, a)).body;
    assert.equal(
      after.history.filter((e) => e.kind === "extraction").at(-1).payload.fields
        .reference.value,
      "REVIEWED",
    );
    assert(after.history.some((e) => e.kind === "processing_superseded"));
    wait = signal();
    const revoked = h.call("/cases/" + id + "/process", {}, a);
    await wait;
    await h.call("/logout", {}, a);
    release();
    assert.equal((await revoked).status, 403);
    assert.equal(
      h.app.db
        .prepare("SELECT count(*) n FROM jobs WHERE status='processing'")
        .get().n,
      0,
    );
  } finally {
    if (release) release();
    await h.close();
  }
});
test("provider delay cannot evaluate a stale declaration; database failure returns safe API error", async () => {
  let release, started;
  const wait = new Promise((ok) => (started = ok)),
    h = await harness({
      depositProvider: {
        retrieve: async () => {
          started();
          await new Promise((ok) => (release = ok));
          return { status: "mock_confirmed", values: instrument };
        },
      },
    });
  try {
    const a = await h.login("a@test.local"),
      o = await h.login("o@test.local"),
      id = (
        await h.call(
          "/cases",
          { name: "Audit", instrument, obligation: { amountPaise: 10000000 } },
          a,
        )
      ).body.id;
    const pending = h.call(
      "/cases/" + id + "/external",
      { scenario: "mock_confirmed" },
      o,
    );
    await wait;
    await h.call(
      "/cases/" + id + "/corrections",
      {
        instrument: { ...instrument, amountPaise: 20000000 },
        revision: 1,
        reason: "Updated during provider delay",
      },
      a,
    );
    release();
    assert.equal((await pending).status, 409);
    h.app.db.close();
    const error = await h.call("/cases", undefined, a);
    assert.equal(error.status, 500);
    assert.equal(error.body.error, "Internal service failure");
  } finally {
    if (release) release();
    await h.close();
  }
});
