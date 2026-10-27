import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { harness } from "./support/harness.js";
import { migrationFixture } from "./support/migration-fixture.js";
import { migrate } from "../src/migrations.js";
import { createApp } from "../src/server.js";
import {
  auditPaths,
  verifyAudit,
  createAuditIntegrity,
} from "../src/audit-integrity.js";
test("standalone verification pins a consistent read while a real separate writer advances the protected checkpoint", async () => {
  const h = await harness();
  let child;
  try {
    const a = await h.login("a");
    await h.create(a);
    const before = verifyAudit(h.app.db, auditPaths(h.dir));
    const flag = join(h.dir, "synthetic-verifier-release");
    child = fork(
      fileURLToPath(
        new URL("./fixtures/audit-concurrency-probe.js", import.meta.url),
      ),
      [h.dir, flag],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    let writerError,
      output = "",
      verification;
    child.stderr.on("data", (v) => (output += v.toString()));
    const result = await new Promise((ok, no) => {
      const timer = setTimeout(() => {
        child.kill();
        no(Error("Concurrent verification timed out"));
      }, 30000);
      child.on("message", async (message) => {
        if (message.pinned) {
          try {
            await h.create(a);
          } catch (error) {
            writerError = error;
          } finally {
            writeFileSync(flag, "release");
          }
        }
        if (message.result) verification = message.result;
        if (message.error) output += message.error;
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        no(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        ok({ code, verification, output });
      });
    });
    assert.ifError(writerError);
    assert.equal(result.code, 0, result.output);
    assert.equal(result.verification.valid, true);
    assert.equal(result.verification.events, before.events);
    assert.ok(verifyAudit(h.app.db, auditPaths(h.dir)).events > before.events);
  } finally {
    if (child?.exitCode === null) child.kill();
    await h.close();
  }
});
test("audit signatures cover automatic inserts, rollback atomically and expose no cross-authority event counts through API", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      s = await h.login("s"),
      r = await h.login("r"),
      x = await h.login("x");
    await h.create(a);
    const paths = auditPaths(h.dir),
      before = verifyAudit(h.app.db, paths);
    assert.equal(before.valid, true);
    assert.equal(before.checkpointLag, 0);
    h.app.db.exec("BEGIN IMMEDIATE");
    h.app.db
      .prepare(
        "INSERT INTO audit(actor,action,payload,created) VALUES('system','synthetic_rollback','{}',?)",
      )
      .run(new Date().toISOString());
    assert.equal(
      h.app.db.prepare("SELECT count(*) n FROM audit_seals").get().n,
      before.events + 1,
    );
    h.app.db.exec("ROLLBACK");
    assert.throws(
      () =>
        h.app.db.exec(
          "INSERT INTO audit(id,actor,action,created) VALUES(-1,'test','out-of-order','2026-01-01')",
        ),
      /nonmonotonic/,
    );
    assert.equal(verifyAudit(h.app.db, paths).events, before.events);
    assert.equal(
      (await h.call("/security/audit-integrity", undefined, a)).status,
      403,
    );
    for (const auth of [s, r, x]) {
      const result = await h.call("/security/audit-integrity", undefined, auth);
      assert.equal(result.status, 200);
      assert.equal(result.body.valid, true);
      assert.equal(result.body.events, undefined);
      assert.equal(result.body.tipAuditId, undefined);
      assert.equal(result.body.rootId, undefined);
    }
    assert.throws(
      () => h.app.db.prepare("UPDATE audit_seals SET mac='bad'").run(),
      /immutable/,
    );
  } finally {
    await h.close();
  }
});
test("offline verifier detects changed events, reordered content, middle deletion, valid-prefix truncation, seals and genesis tampering", async () => {
  const h = await harness();
  try {
    const a = await h.login("a");
    await h.create(a);
    await h.create(a);
    await h.app.close();
    const path = join(h.dir, "sentinel.sqlite"),
      baseline = join(h.dir, "synthetic-before-tampering.sqlite");
    copyFileSync(path, baseline);
    const mutations = [
      "DROP TRIGGER audit_immutable; UPDATE audit SET payload='{}' WHERE id=(SELECT min(id) FROM audit)",
      "DROP TRIGGER audit_immutable; UPDATE audit SET actor='changed-order-content' WHERE id=(SELECT max(id) FROM audit)",
      "DROP TRIGGER audit_seals_no_delete;DROP TRIGGER audit_no_delete;DELETE FROM audit_seals WHERE audit_id=(SELECT min(id)+1 FROM audit);DELETE FROM audit WHERE id=(SELECT min(id)+1 FROM audit)",
      "DROP TRIGGER audit_seals_no_delete;DROP TRIGGER audit_no_delete;DELETE FROM audit_seals WHERE audit_id=(SELECT max(id) FROM audit);DELETE FROM audit WHERE id=(SELECT max(id) FROM audit)",
      "DROP TRIGGER audit_seals_immutable;UPDATE audit_seals SET payload_sha256='bad' WHERE audit_id=(SELECT max(audit_id) FROM audit_seals)",
      "DROP TRIGGER audit_root_immutable;UPDATE audit_root SET payload=json_set(payload,'$.legacyEvents',100)",
    ];
    for (const sql of mutations) {
      copyFileSync(baseline, path);
      const db = new DatabaseSync(path);
      try {
        db.exec(sql);
        assert.throws(
          () => verifyAudit(db, auditPaths(h.dir)),
          /Audit|audit|Legacy/,
        );
      } finally {
        db.close();
      }
    }
    copyFileSync(baseline, path);
    const offline = new DatabaseSync(path);
    try {
      assert.equal(verifyAudit(offline, auditPaths(h.dir)).valid, true);
      assert.throws(
        () =>
          offline.exec(
            "INSERT INTO audit(actor,action,created) VALUES('attacker','unsigned','2026-01-01')",
          ),
        /audit_row_digest|audit_event_mac/,
      );
    } finally {
      offline.close();
    }
  } finally {
    await h.close();
  }
});
test("missing keys or checkpoints fail closed, release startup ownership and never silently reenroll existing history", async () => {
  const h = await harness();
  let restarted;
  try {
    await h.login("a");
    await h.app.close();
    const paths = auditPaths(h.dir),
      key = readFileSync(paths.keyFile),
      checkpoint = readFileSync(paths.checkpointFile);
    unlinkSync(paths.keyFile);
    assert.throws(() => createApp({ dir: h.dir }), /key unavailable/);
    assert.equal(existsSync(join(h.dir, ".server.lock")), false);
    assert.equal(existsSync(paths.keyFile), false);
    writeFileSync(paths.keyFile, key);
    unlinkSync(paths.checkpointFile);
    assert.throws(() => createApp({ dir: h.dir }), /checkpoint unavailable/);
    assert.equal(existsSync(paths.checkpointFile), false);
    assert.equal(existsSync(join(h.dir, ".server.lock")), false);
    writeFileSync(paths.checkpointFile, checkpoint);
    restarted = createApp({ dir: h.dir });
    assert.equal(verifyAudit(restarted.db, paths).valid, true);
  } finally {
    await restarted?.close();
    await h.close();
  }
});
test("historical schema15 audit rows are preserved and explicitly anchored only at enrollment", () => {
  const f = migrationFixture(15);
  try {
    const rows = f.db.prepare("SELECT * FROM audit ORDER BY id").all();
    assert.ok(rows.length);
    migrate(f.db, f.dir);
    const integrity = createAuditIntegrity(f.db, { dir: f.dir });
    const result = integrity.verify();
    assert.equal(result.legacyEventsAnchoredAtEnrollment, rows.length);
    assert.equal(result.legacyWasUnsignedBeforeEnrollment, true);
    assert.deepEqual(
      f.db
        .prepare(
          "SELECT id,actor,action,case_id,payload,created,correlation_id,category,outcome FROM audit ORDER BY id",
        )
        .all(),
      rows,
    );
    assert.equal(result.events, rows.length);
    assert.equal(result.checkpointLag, 0);
  } finally {
    f.close();
  }
});
