import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hash } from "../src/store.js";
let app = createApp();
try {
  await new Promise((ok) => app.server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const request = async (path, body, auth = {}) => {
    const r = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...auth },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  assert.equal((await request("/ready")).status, 200);
  const login = await request("/login", {
    email: process.env.PROBE_EMAIL,
    password: process.env.PROBE_PASSWORD,
  });
  assert.equal(login.status, 200);
  const auth = {
    cookie: login.headers.get("set-cookie").split(";")[0],
    "x-csrf-token": login.body.csrf,
  };
  const created = await request(
    "/cases",
    {
      name: "Clean startup synthetic",
      instrument: {
        reference: "CLEAN-PERSIST",
        amountPaise: 10000000,
        bank: "HDFC Bank",
        ifsc: "HDFC0001234",
        issued: "2026-01-01",
        matures: "2031-01-01",
      },
      obligation: { amountPaise: 10000000 },
    },
    auth,
  );
  assert.equal(created.status, 201);
  const id = created.body.id;
  const document = await request(
    "/cases/" + id + "/documents",
    {
      mime: "text/plain",
      base64: Buffer.from(
        "Reference: CLEAN-PERSIST\nIFSC: HDFC0001234",
      ).toString("base64"),
    },
    auth,
  );
  assert.equal(document.status, 201);
  assert.equal(
    (await request("/cases/" + id + "/process", {}, auth)).body.status,
    "completed",
  );
  const evaluations = app.db
    .prepare(
      "SELECT count(*) n FROM evidence WHERE case_id=? AND kind='evaluation'",
    )
    .get(id).n;
  await app.close();
  app = createApp();
  assert(app.db.prepare("SELECT 1 FROM cases WHERE id=?").get(id));
  assert.equal(
    app.db
      .prepare(
        "SELECT count(*) n FROM evidence WHERE case_id=? AND kind='evaluation'",
      )
      .get(id).n,
    evaluations,
  );
  assert.equal(
    hash(readFileSync(join(process.env.DATA_DIR, "private", document.body.id))),
    document.body.sha256,
  );
  assert.equal(app.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  console.log(
    JSON.stringify({
      ready: true,
      login: true,
      registration: true,
      documentHashPreserved: true,
      processing: true,
      restartPersistence: true,
      evaluationsPreserved: evaluations,
      migrations: app.db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all()
        .map((r) => r.version),
    }),
  );
} finally {
  await app.close();
}
