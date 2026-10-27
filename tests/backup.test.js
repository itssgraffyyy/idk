import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  cpSync,
  symlinkSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, createHmac } from "node:crypto";
import { harness } from "./support/harness.js";
import { createApp } from "../src/server.js";
import { createBackup, verifyBackup, restoreBackup } from "../src/backup.js";
import { canonical } from "../src/clearance-procedure.js";
import { totp } from "../src/mfa.js";
test("historical isolated restore cannot replace a later protected production checkpoint", async () => {
  const h = await harness(),
    work = mkdtempSync(join(tmpdir(), "sentinel-backup-checkpoint-"));
  let source;
  try {
    const a = await h.login("a");
    await h.create(a);
    await h.app.close();
    const archive = join(work, "archive"),
      key = join(h.dir, "security", "audit.key");
    await createBackup({ dir: h.dir, output: archive });
    source = createApp({ dir: h.dir });
    await new Promise((ok) => source.server.listen(0, "127.0.0.1", ok));
    const base = "http://127.0.0.1:" + source.server.address().port;
    for (let i = 0; i < 4; i++) {
      const result = await fetch(base + "/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "a@test.local",
          password: "phase12-password",
        }),
      });
      assert.equal(result.status, 200);
    }
    await source.close();
    source = null;
    const checkpoint = join(h.dir, "security", "audit-checkpoint.json"),
      protectedBytes = readFileSync(checkpoint);
    const output = join(work, "historical");
    await restoreBackup({ archive, output, auditKeyFile: key });
    assert.throws(
      () =>
        createApp({
          dir: output,
          auditKeyFile: key,
          auditCheckpointFile: checkpoint,
        }),
      /rollback|checkpoint mismatch|truncated/,
    );
    assert.deepEqual(readFileSync(checkpoint), protectedBytes);
    assert.equal(existsSync(join(output, ".server.lock")), false);
  } finally {
    await source?.close();
    await h.close();
    rmSync(work, { recursive: true, force: true });
  }
});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("signed offline backup restores exact case/evidence/document history, revokes sessions and survives real startup/restart with external keys", async () => {
  const h = await harness(),
    work = mkdtempSync(join(tmpdir(), "sentinel-backup-test-"));
  let restored;
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      upload = {
        mime: "text/plain",
        base64: Buffer.from("Synthetic backed-up source").toString("base64"),
      };
    const version = await h.call("/cases/" + id + "/documents", upload, a);
    assert.equal(version.status, 201);
    const draft = (
      await h.call(
        "/drafts",
        { payload: { name: "Preserved draft" }, step: 1 },
        a,
      )
    ).body;
    assert.equal(
      (
        await h.call(
          "/drafts/" + draft.id + "/documents",
          { ...upload, revision: 1 },
          a,
        )
      ).status,
      201,
    );
    const saved = Object.fromEntries(
      [
        "cases",
        "evidence",
        "document_versions",
        "documents",
        "obligations",
        "instruments",
        "draft_documents",
        "upload_scans",
      ].map((t) => [
        t,
        h.app.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all(),
      ]),
    );
    const originalAudit = h.app.db
      .prepare("SELECT * FROM audit ORDER BY id")
      .all();
    await h.app.close();
    const sourceHash = hash(readFileSync(join(h.dir, "sentinel.sqlite"))),
      key = join(h.dir, "security", "audit.key");
    const archive = join(work, "archive");
    const created = await createBackup({ dir: h.dir, output: archive });
    assert.equal(created.verified, true);
    assert.equal(created.objects, 2);
    assert.equal(created.keysIncluded, false);
    assert.equal(
      hash(readFileSync(join(h.dir, "sentinel.sqlite"))),
      sourceHash,
    );
    assert.ok(!readdirSync(archive).some((name) => name.endsWith(".key")));
    assert.ok(!existsSync(join(archive, "security")));
    const checked = await verifyBackup({ archive, auditKeyFile: key });
    assert.equal(checked.valid, true);
    const out = join(work, "restored");
    const receipt = await restoreBackup({
      archive,
      output: out,
      auditKeyFile: key,
    });
    assert.equal(receipt.restored, true);
    assert.ok(receipt.sessionsRevoked > 0);
    assert.equal(receipt.auditValid, true);
    restored = createApp({ dir: out, auditKeyFile: key });
    for (const [t, rows] of Object.entries(saved))
      assert.deepEqual(
        restored.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all(),
        rows,
        t,
      );
    assert.deepEqual(
      restored.db
        .prepare("SELECT * FROM audit WHERE id<=? ORDER BY id")
        .all(originalAudit.at(-1).id),
      originalAudit,
    );
    assert.equal(
      restored.db.prepare("SELECT count(*) n FROM sessions").get().n,
      0,
    );
    await new Promise((ok) => restored.server.listen(0, "127.0.0.1", ok));
    const base = "http://127.0.0.1:" + restored.server.address().port;
    assert.equal((await fetch(base + "/api/me", { headers: a })).status, 401);
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "a@test.local",
        password: "phase12-password",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const doc = await fetch(
      base + "/api/cases/" + id + "/documents/" + version.body.id,
      { headers: { cookie } },
    );
    assert.equal(doc.status, 200);
    assert.equal(
      hash(Buffer.from(await doc.arrayBuffer())),
      version.body.sha256,
    );
    await restored.close();
    restored = createApp({ dir: out, auditKeyFile: key });
    assert.equal(
      restored.db.prepare("SELECT count(*) n FROM document_versions").get().n,
      1,
    );
  } finally {
    await restored?.close();
    await h.close();
    rmSync(work, { recursive: true, force: true });
  }
});
test("backup refuses active owners, nested destinations, hash-corrupt objects and restoration over existing directories", async () => {
  const h = await harness(),
    work = mkdtempSync(join(tmpdir(), "sentinel-backup-negative-"));
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      source = await h.call(
        "/cases/" + id + "/documents",
        {
          mime: "text/plain",
          base64: Buffer.from("Synthetic immutable backup object").toString(
            "base64",
          ),
        },
        a,
      );
    await assert.rejects(
      createBackup({ dir: h.dir, output: join(work, "live") }),
      /live process/,
    );
    assert.equal(existsSync(join(work, "live")), false);
    await h.app.close();
    await assert.rejects(
      createBackup({ dir: h.dir, output: join(h.dir, "..archive", "child") }),
      /outside/,
    );
    assert.equal(existsSync(join(h.dir, "..archive")), false);
    const archive = join(work, "archive");
    await createBackup({ dir: h.dir, output: archive });
    const key = join(h.dir, "security", "audit.key");
    await assert.rejects(
      restoreBackup({ archive, output: work, auditKeyFile: key }),
      /already exists/,
    );
    const object = join(archive, "private", source.body.id);
    writeFileSync(object, "corrupt synthetic archive blob");
    await assert.rejects(
      verifyBackup({ archive, auditKeyFile: key }),
      /hash|size/,
    );
    await assert.rejects(
      restoreBackup({
        archive,
        output: join(work, "bad-restore"),
        auditKeyFile: key,
      }),
      /hash|size/,
    );
    assert.equal(existsSync(join(work, "bad-restore")), false);
    writeFileSync(
      join(h.dir, "private", source.body.id),
      "corrupt source object",
    );
    await assert.rejects(
      createBackup({ dir: h.dir, output: join(work, "bad-source") }),
      /hash|metadata/,
    );
  } finally {
    await h.close();
    rmSync(work, { recursive: true, force: true });
  }
});
test("manifest authentication, path traversal, external-key custody and junction escapes fail before restoration", async () => {
  const h = await harness(),
    work = mkdtempSync(join(tmpdir(), "sentinel-backup-paths-"));
  try {
    const a = await h.login("a"),
      id = await h.create(a);
    await h.call(
      "/cases/" + id + "/documents",
      {
        mime: "text/plain",
        base64: Buffer.from("Synthetic archive path fixture").toString(
          "base64",
        ),
      },
      a,
    );
    await h.app.close();
    const archive = join(work, "archive");
    await createBackup({ dir: h.dir, output: archive });
    const keyPath = join(h.dir, "security", "audit.key"),
      key = readFileSync(keyPath),
      manifestPath = join(archive, "manifest.json"),
      original = readFileSync(manifestPath);
    let manifest = JSON.parse(original);
    manifest.complete = false;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifyBackup({ archive, auditKeyFile: keyPath }),
      /authentication/,
    );
    manifest = JSON.parse(original);
    const { signature, ...payload } = manifest;
    payload.files[0].path = "../outside.sqlite";
    const mac = createHmac("sha256", key)
      .update("FDR_SENTINEL_PRIVATE_BACKUP_V1\n" + canonical(payload))
      .digest("hex");
    writeFileSync(manifestPath, JSON.stringify({ ...payload, signature: mac }));
    await assert.rejects(
      restoreBackup({
        archive,
        output: join(work, "traversal"),
        auditKeyFile: keyPath,
      }),
      /manifest/,
    );
    assert.equal(existsSync(join(work, "traversal")), false);
    writeFileSync(manifestPath, original);
    writeFileSync(join(archive, "untrusted.key"), key);
    await assert.rejects(
      verifyBackup({ archive, auditKeyFile: join(archive, "untrusted.key") }),
      /outside/,
    );
    const external = join(work, "external-objects");
    renameSync(join(archive, "private"), external);
    symlinkSync(external, join(archive, "private"), "junction");
    await assert.rejects(
      verifyBackup({ archive, auditKeyFile: keyPath }),
      /path/,
    );
  } finally {
    await h.close();
    rmSync(work, { recursive: true, force: true });
  }
});
test("MFA-enabled snapshots require separately retained matching encryption key and preserve authenticator enrollment on restore", async () => {
  const h = await harness(),
    work = mkdtempSync(join(tmpdir(), "sentinel-backup-mfa-"));
  let app;
  try {
    const r = await h.login("r"),
      start = await h.call(
        "/security/mfa/enroll",
        { password: "phase12-password", revision: 0 },
        r,
      );
    assert.equal(
      (
        await h.call(
          "/security/mfa/confirm",
          {
            password: "phase12-password",
            revision: start.body.revision,
            mfaCode: totp(start.body.secret, Date.now()),
          },
          r,
        )
      ).status,
      200,
    );
    await h.app.close();
    const archive = join(work, "archive"),
      key = join(h.dir, "security", "audit.key"),
      mfa = join(h.dir, "security", "mfa.key");
    await createBackup({ dir: h.dir, output: archive });
    await assert.rejects(
      verifyBackup({ archive, auditKeyFile: key }),
      /MFA_KEY_FILE/,
    );
    const out = join(work, "restored");
    await restoreBackup({
      archive,
      output: out,
      auditKeyFile: key,
      mfaKeyFile: mfa,
    });
    app = createApp({ dir: out, auditKeyFile: key, mfaKeyFile: mfa });
    assert.equal(
      app.db.prepare("SELECT enabled FROM user_mfa WHERE user_id='r'").get()
        .enabled,
      1,
    );
    assert.equal(app.db.prepare("SELECT count(*) n FROM sessions").get().n, 0);
  } finally {
    await app?.close();
    await h.close();
    rmSync(work, { recursive: true, force: true });
  }
});
