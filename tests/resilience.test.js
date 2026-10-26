import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp, seed } from "../src/server.js";
import { openStore } from "../src/store.js";
const inst = {
  reference: "SYN-RESILIENCE",
  amountPaise: 10000,
  bank: "Synthetic Bank",
  ifsc: "SYNB0000001",
  issued: "2026-01-01",
  matures: "2030-01-01",
};
test("migration reproducibility, OCR API, corrections, uploads and session resilience", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-resilience-"));
  let app = createApp({ dir });
  seed(app.db, [
    {
      id: "a",
      email: "a@test.local",
      password: "test-password",
      role: "institution",
      tenant: "a",
    },
    {
      id: "o",
      email: "o@test.local",
      password: "test-password",
      role: "officer",
      tenant: "authority",
    },
  ]);
  await new Promise((ok) => app.server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + app.server.address().port;
  let auth = {};
  const call = async (path, body, headers = {}) => {
    const r = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...auth, ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  try {
    const login = await call("/login", {
      email: "a@test.local",
      password: "test-password",
    });
    auth = {
      cookie: login.headers.get("set-cookie").split(";")[0],
      "x-csrf-token": login.body.csrf,
    };
    let id = (
      await call("/cases", {
        name: "Fictional Resilience College",
        instrument: inst,
        obligation: { amountPaise: 10000 },
      })
    ).body.id;
    await t.test("institution record persisted", async () => {
      assert.equal(
        (await call("/institution")).body.name,
        "Fictional Resilience College",
      );
    });
    await t.test("truncated images and pixel bombs rejected", async () => {
      assert.equal(
        (
          await call("/cases/" + id + "/documents", {
            base64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64"),
          })
        ).status,
        400,
      );
      const b = Buffer.alloc(33);
      Buffer.from("89504e470d0a1a0a", "hex").copy(b);
      b.writeUInt32BE(100000, 16);
      b.writeUInt32BE(100000, 20);
      assert.equal(
        (
          await call("/cases/" + id + "/documents", {
            base64: b.toString("base64"),
          })
        ).status,
        400,
      );
    });
    await t.test("oversized upload and malformed JSON rejected", async () => {
      assert.equal(
        (
          await call("/cases/" + id + "/documents", {
            base64: Buffer.alloc(4194305, 65).toString("base64"),
            mime: "text/plain",
          })
        ).status,
        413,
      );
      const r = await fetch(base + "/api/cases", {
        method: "POST",
        headers: { ...auth },
        body: "{broken",
      });
      assert.equal(r.status, 400);
    });
    await t.test(
      "real image OCR via API retains provenance and a durable job",
      async () => {
        const b = readFileSync("datasets/v1/documents/case-001.png");
        assert.equal(
          (
            await call("/cases/" + id + "/documents", {
              base64: b.toString("base64"),
            })
          ).status,
          201,
        );
        const r = await call("/cases/" + id + "/process", {});
        assert.equal(r.body.status, "completed");
        assert.equal(r.body.method, "tesseract-wasm");
        assert.equal(r.body.fields.reference.value, "SYN-0001");
        assert(r.body.raw.blocks.length);
        assert.equal(
          (await call("/cases/" + id + "/jobs")).body[0].status,
          "completed",
        );
      },
    );
    await t.test(
      "manual extraction correction preserves raw result and rejects stale writes",
      async () => {
        const c = (await call("/cases/" + id)).body,
          x = c.history.filter((e) => e.kind === "extraction").at(-1);
        const body = {
          extractionId: x.id,
          values: { ifsc: "SYNB0000001" },
          reason: "Reviewed against source image",
        };
        assert.equal(
          (await call("/cases/" + id + "/extraction-corrections", body)).status,
          201,
        );
        assert.equal(
          (await call("/cases/" + id + "/extraction-corrections", body)).status,
          409,
        );
        const h = (await call("/cases/" + id)).body.history,
          latest = h.filter((e) => e.kind === "extraction").at(-1);
        assert.equal(latest.payload.correctedFrom, x.id);
        assert.equal(
          h.find((e) => e.id === x.id).payload.method,
          "tesseract-wasm",
        );
      },
    );
    await t.test(
      "duplicate references re-evaluate all affected accessible cases",
      async () => {
        const duplicate = (
          await call("/cases", {
            name: "Fictional Resilience College",
            instrument: inst,
            obligation: { amountPaise: 10000 },
          })
        ).body.id;
        const c = (await call("/cases/" + id)).body;
        assert(
          c.history
            .filter((e) => e.kind === "evaluation")
            .at(-1)
            .payload.findings.some((f) => f.code === "duplicate_reference"),
        );
        await call("/cases/" + duplicate + "/corrections", {
          revision: 1,
          instrument: { ...inst, reference: "UNIQUE" },
          reason: "Correct duplicate",
        });
        assert(
          !(await call("/cases/" + id)).body.history
            .filter((e) => e.kind === "evaluation")
            .at(-1)
            .payload.findings.some((f) => f.code === "duplicate_reference"),
        );
      },
    );
    await t.test(
      "expired session rejected and database checks reject invalid money",
      async () => {
        assert.throws(() =>
          app.db
            .prepare("UPDATE cases SET instrument=? WHERE id=?")
            .run(JSON.stringify({ ...inst, amountPaise: -1 }), id),
        );
        app.db.exec("UPDATE sessions SET expires=0");
        assert.equal((await call("/cases")).status, 401);
      },
    );
    await app.close();
    app = null;
    let db = openStore(dir);
    assert.equal(db.prepare("SELECT count(*) n FROM migrations").get().n, 4);
    assert.equal(db.prepare("SELECT count(*) n FROM cases").get().n, 2);
    db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?)").run(
      "interrupted",
      id,
      "doc",
      "processing",
      null,
      new Date().toISOString(),
    );
    db.close();
    app = createApp({ dir });
    assert.equal(
      app.db.prepare("SELECT status FROM jobs WHERE id='interrupted'").get()
        .status,
      "interrupted",
    );
  } finally {
    if (app) await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
