import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, instrument } from "./support/harness.js";
import { openStore } from "../src/store.js";
import { DatabaseSync } from "node:sqlite";
import { upgrades } from "../src/migrations.js";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("five-role permissions, authority isolation, assignment and guarded lifecycle concurrency", async () => {
  const h = await harness();
  try {
    const auth = {};
    for (const id of ["a", "admin", "b", "o", "p", "s", "r", "x"])
      auth[id] = await h.login(id);
    const id = await h.create(auth.admin),
      path = "/cases/" + id;
    for (const user of ["a", "admin", "o", "s", "r"])
      assert.equal(
        (await h.call(path, undefined, auth[user])).status,
        200,
        user,
      );
    for (const user of ["b", "p", "x"])
      assert.equal(
        (await h.call(path, undefined, auth[user])).status,
        404,
        user,
      );
    for (const user of ["o", "s", "r"])
      assert.equal(
        (
          await h.call(
            path + "/corrections",
            { instrument, revision: 1, reason: "disallowed" },
            auth[user],
          )
        ).status,
        403,
      );
    assert.equal((await h.call(path + "/evaluate", {}, auth.r)).status, 403);
    let c = (await h.call(path, undefined, auth.a)).body;
    assert(c.domain.obligation.id);
    assert(c.domain.instruments[0].id !== c.domain.obligation.id);
    const submit = {
      action: "submit",
      revision: 1,
      reason: "Submit verified prototype data",
    };
    const results = await Promise.all([
      h.call(path + "/lifecycle", submit, auth.a),
      h.call(path + "/lifecycle", submit, auth.admin),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (
        await h.call(
          path + "/lifecycle",
          { action: "release", revision: 2, reason: "Not Phase3" },
          auth.s,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call(
          path + "/lifecycle",
          { action: "start_review", revision: 2, reason: "Review" },
          auth.a,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await h.call(
          path + "/lifecycle",
          { action: "start_review", revision: 2, reason: "Review" },
          auth.o,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await h.call(
          path + "/assignment",
          { officerId: "p", revision: 1, reason: "Assign within authority" },
          auth.s,
        )
      ).status,
      200,
    );
    assert.equal((await h.call(path, undefined, auth.o)).status, 404);
    assert.equal((await h.call(path, undefined, auth.p)).status, 200);
    assert.equal(
      (
        await h.call(
          path + "/assignment",
          { officerId: "o", revision: 2, reason: "Denied" },
          auth.r,
        )
      ).status,
      403,
    );
  } finally {
    await h.close();
  }
});
test("logical proof versions do not replace FDR extraction and version bytes remain immutable", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      path = "/cases/" + id;
    const upload = (body) =>
      h.call(
        path + "/documents",
        {
          name: "test.txt",
          mime: "text/plain",
          base64: Buffer.from("reference: SOURCE\nifsc: HDFC0001234").toString(
            "base64",
          ),
          ...body,
        },
        a,
      );
    const fdr = await upload({});
    assert.equal(fdr.status, 201);
    await h.call(path + "/process", {}, a);
    const proof = await upload({
      kind: "proof",
      title: "Classification evidence",
    });
    assert.equal(proof.status, 201);
    assert.notEqual(fdr.body.logicalDocumentId, proof.body.logicalDocumentId);
    const c = (await h.call(path, undefined, a)).body,
      report = c.history.filter((e) => e.kind === "evaluation").at(-1).payload;
    assert.equal(report.sources.documentId, fdr.body.id);
    const v2 = await upload({ documentId: fdr.body.logicalDocumentId });
    assert.equal(v2.body.documentVersion, 2);
    assert.throws(() =>
      h.app.db.prepare("UPDATE document_versions SET sha256='changed'").run(),
    );
  } finally {
    await h.close();
  }
});
test("populated v6 migration preserves users, FK bindings, original document hashes and historical evaluations", () => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-migration-")),
    path = join(dir, "sentinel.sqlite");
  let db = new DatabaseSync(path);
  try {
    const bootstrap = readFileSync("src/store.js", "utf8").match(
      /db.exec\(`([\s\S]*?)`\);/,
    )[1];
    db.exec(bootstrap);
    db.exec(
      "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)",
    );
    for (const m of upgrades
      .filter((m) => m.version < 7)
      .sort((a, b) => a.version - b.version)) {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(
        m.version,
        createHash("sha256").update(m.sql).digest("hex"),
        "2026-01-01",
      );
    }
    db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
      "old",
      "old@test",
      "digest",
      "institution",
      "college",
      "active",
    );
    db.prepare("INSERT INTO institutions VALUES(?,?,?)").run(
      "college",
      "Old College",
      "2026-01-01",
    );
    db.prepare("INSERT INTO cases VALUES(?,?,?,?,?,?,?)").run(
      "old-case",
      "college",
      "old",
      "Old Case",
      JSON.stringify({ amountPaise: 100 }),
      JSON.stringify(instrument),
      1,
    );
    const original = JSON.stringify({
      sha256: "original-byte-hash",
      mime: "text/plain",
      bytes: 10,
    });
    db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?)").run(
      "old-document",
      "old-case",
      "document",
      original,
      "2026-01-01",
      "old",
    );
    db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?)").run(
      "old-evaluation",
      "old-case",
      "evaluation",
      '{"version":1,"unchanged":true}',
      "2026-01-01",
      "old",
    );
    db.close();
    db = openStore(dir);
    assert.equal(
      db.prepare("SELECT payload FROM evidence WHERE id=?").get("old-document")
        .payload,
      original,
    );
    assert.equal(
      db
        .prepare("SELECT sha256 FROM document_versions WHERE id=?")
        .get("old-document").sha256,
      "original-byte-hash",
    );
    assert.equal(
      db
        .prepare("SELECT payload FROM evidence WHERE id=?")
        .get("old-evaluation").payload,
      '{"version":1,"unchanged":true}',
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert(readdirSync(dir).some((n) => n.startsWith("pre-migration-7-")));
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
