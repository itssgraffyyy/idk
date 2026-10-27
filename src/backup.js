import { DatabaseSync } from "node:sqlite";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  lstatSync,
  statSync,
  copyFileSync,
  constants,
  openSync,
  fsyncSync,
  closeSync,
  createReadStream,
} from "node:fs";
import {
  resolve,
  join,
  dirname,
  basename,
  relative,
  isAbsolute,
  sep,
} from "node:path";
import { acquireLock } from "./security.js";
import {
  auditPaths,
  verifyAudit,
  createAuditIntegrity,
} from "./audit-integrity.js";
import { createMFA } from "./mfa.js";
import { canonical } from "./clearance-procedure.js";
const fail = (message) => {
  throw Object.assign(Error(message), { status: 409 });
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const within = (root, path) => {
  const r = relative(root, path);
  return !r || (r !== ".." && !r.startsWith(".." + sep) && !isAbsolute(r));
};
const safeFile = (name) =>
  name === "sentinel.sqlite" ||
  name === "audit-checkpoint.json" ||
  /^private\/[a-f0-9-]{36}$/i.test(name);
const sign = (key, payload) =>
  createHmac("sha256", key)
    .update("FDR_SENTINEL_PRIVATE_BACKUP_V1\n" + canonical(payload))
    .digest("hex");
const counts = (db) =>
  Object.fromEntries(
    [
      "cases",
      "evidence",
      "document_versions",
      "obligations",
      "instruments",
      "audit",
    ].map((table) => [
      table,
      db.prepare("SELECT count(*) n FROM " + table).get().n,
    ]),
  );
function keyBytes(path) {
  let key;
  try {
    key = readFileSync(path);
  } catch {
    fail("External backup signing key unavailable");
  }
  if (key.length !== 32) fail("Invalid external backup signing key");
  return key;
}
function flush(path) {
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
async function fileHash(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
function checkDB(db) {
  if (
    db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length
  )
    fail("Backup database integrity/relationship check failed");
}
function newDestination(path, source) {
  const requested = resolve(path);
  if (existsSync(requested))
    fail("Destination already exists; no overwrite is permitted");
  let ancestor = dirname(requested);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) fail("Destination parent unavailable");
    ancestor = parent;
  }
  if (
    within(
      source,
      resolve(realpathSync(ancestor), relative(ancestor, requested)),
    )
  )
    fail("Destination must be outside the source directory");
  mkdirSync(dirname(requested), { recursive: true });
  const target = join(realpathSync(dirname(requested)), basename(requested));
  if (within(source, target))
    fail("Destination must be outside the source directory");
  mkdirSync(target, { mode: 0o700 });
  return target;
}
async function manifestFile(root, name) {
  const path = join(root, name);
  return {
    path: name,
    bytes: statSync(path).size,
    sha256: await fileHash(path),
  };
}
export async function createBackup({
  dir,
  output,
  auditKeyFile,
  auditCheckpointFile,
  mfaKeyFile,
  maxObjects = 10000,
  maxBytes = 4294967296,
}) {
  const source = realpathSync(resolve(dir));
  if (!output) fail("An explicit new backup destination is required");
  if (
    !Number.isSafeInteger(maxObjects) ||
    maxObjects < 1 ||
    maxObjects > 100000 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    fail("Invalid backup capacity bounds");
  const release = acquireLock(source);
  let db, target;
  try {
    const paths = auditPaths(source, {
      keyFile: auditKeyFile,
      checkpointFile: auditCheckpointFile,
    });
    db = new DatabaseSync(join(source, "sentinel.sqlite"), { readOnly: true });
    db.exec("PRAGMA foreign_keys=ON");
    checkDB(db);
    const audit = verifyAudit(db, paths),
      key = keyBytes(paths.keyFile);
    const references = new Map();
    for (const row of db
      .prepare(
        "SELECT storage_key,sha256,bytes FROM document_versions UNION ALL SELECT storage_key,sha256,bytes FROM draft_documents",
      )
      .all()) {
      if (
        !/^[a-f0-9-]{36}$/i.test(row.storage_key) ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes < 1 ||
        row.bytes > 4194304 ||
        !/^[a-f0-9]{64}$/.test(row.sha256)
      )
        fail("Invalid private object metadata");
      const old = references.get(row.storage_key);
      if (old && (old.sha256 !== row.sha256 || old.bytes !== row.bytes))
        fail("Conflicting private object references");
      references.set(row.storage_key, row);
    }
    const expectedBytes = [...references.values()].reduce(
      (n, r) => n + r.bytes,
      statSync(join(source, "sentinel.sqlite")).size,
    );
    if (references.size > maxObjects || expectedBytes > maxBytes)
      fail(
        "Backup capacity exceeded; use an explicitly reviewed larger local capacity",
      );
    const needsMFA = db.prepare("SELECT count(*) n FROM user_mfa").get().n > 0;
    const mfaPath = resolve(mfaKeyFile || join(source, "security", "mfa.key"));
    if (needsMFA) createMFA(db, { dir: source, keyFile: mfaPath });
    target = newDestination(output, source);
    mkdirSync(join(target, "private"));
    // VACUUM INTO reads a consistent logical database, including committed WAL pages.
    db.prepare("VACUUM INTO ?").run(join(target, "sentinel.sqlite"));
    flush(join(target, "sentinel.sqlite"));
    const files = [await manifestFile(target, "sentinel.sqlite")];
    if (references.size) {
      const privateRoot = realpathSync(join(source, "private"));
      if (!within(source, privateRoot))
        fail("Backup supports an in-directory local private store only");
      for (const ref of references.values()) {
        const path = join(privateRoot, ref.storage_key),
          info = lstatSync(path);
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          !within(privateRoot, realpathSync(path))
        )
          fail("Unsafe private storage object");
        const bytes = readFileSync(path);
        if (bytes.length !== ref.bytes || hash(bytes) !== ref.sha256)
          fail("Private object hash/metadata mismatch");
        const name = "private/" + ref.storage_key;
        writeFileSync(join(target, name), bytes, { flag: "wx", mode: 0o600 });
        flush(join(target, name));
        files.push(await manifestFile(target, name));
      }
    }
    writeFileSync(
      join(target, "audit-checkpoint.json"),
      readFileSync(paths.checkpointFile),
      { flag: "wx", mode: 0o600 },
    );
    flush(join(target, "audit-checkpoint.json"));
    files.push(await manifestFile(target, "audit-checkpoint.json"));
    const payload = {
      format: 1,
      complete: true,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      storage: "LOCAL_PRIVATE_STORAGE",
      files,
      counts: counts(db),
      migrations: db
        .prepare(
          "SELECT version,sha256 FROM schema_migrations ORDER BY version",
        )
        .all()
        .map((r) => ({ ...r })),
      audit: {
        rootId: audit.rootId,
        tipAuditId: audit.tipAuditId,
        tipMAC: audit.tipMAC,
      },
      keys: {
        auditSHA256: hash(key),
        mfaSHA256: needsMFA ? hash(keyBytes(mfaPath)) : null,
      },
      limits: { maxObjects, maxBytes },
      security: "KEYS_EXCLUDED_RESTORE_REQUIRES_EXTERNAL_CUSTODY",
    };
    writeFileSync(
      join(target, "manifest.json"),
      JSON.stringify({ ...payload, signature: sign(key, payload) }, null, 2) +
        "\n",
      { flag: "wx", mode: 0o600 },
    );
    flush(join(target, "manifest.json"));
    const verified = await verifyBackup({
      archive: target,
      auditKeyFile: paths.keyFile,
      mfaKeyFile: needsMFA ? mfaPath : undefined,
    });
    return {
      archive: target,
      id: payload.id,
      verified: verified.valid,
      objects: references.size,
      counts: payload.counts,
      keysIncluded: false,
      sourceChanged: false,
    };
  } finally {
    db?.close();
    release();
  }
}
export async function verifyBackup({ archive, auditKeyFile, mfaKeyFile }) {
  if (!archive) fail("An explicit archive path is required");
  const root = realpathSync(resolve(archive));
  if (!auditKeyFile)
    fail(
      "External AUDIT_KEY_FILE is required; keys are never read from the archive",
    );
  const externalKey = realpathSync(resolve(auditKeyFile));
  if (within(root, externalKey))
    fail("Signing key must be held outside the archive");
  const key = keyBytes(externalKey),
    manifestPath = join(root, "manifest.json");
  if (
    lstatSync(manifestPath).isSymbolicLink() ||
    statSync(manifestPath).size > 4194304
  )
    fail("Unsafe backup manifest");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")),
    { signature, ...payload } = manifest;
  if (
    payload.format !== 1 ||
    payload.complete !== true ||
    !Array.isArray(payload.files) ||
    payload.files.length > 100002 ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(key, payload)))
  )
    fail("Backup manifest authentication failed");
  if (payload.keys?.auditSHA256 !== hash(key))
    fail("Backup signing key does not match manifest");
  if (payload.keys.mfaSHA256) {
    if (
      !mfaKeyFile ||
      within(root, realpathSync(resolve(mfaKeyFile))) ||
      hash(keyBytes(mfaKeyFile)) !== payload.keys.mfaSHA256
    )
      fail("Matching externally held MFA_KEY_FILE is required");
  }
  const seen = new Set();
  for (const file of payload.files) {
    if (
      !safeFile(file.path) ||
      seen.has(file.path) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      fail("Invalid backup object manifest");
    seen.add(file.path);
    const path = join(root, file.path),
      info = lstatSync(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !within(root, realpathSync(path)) ||
      info.size !== file.bytes ||
      (await fileHash(path)) !== file.sha256
    )
      fail("Backup object hash, size or path check failed");
  }
  if (!seen.has("sentinel.sqlite") || !seen.has("audit-checkpoint.json"))
    fail("Incomplete backup object set");
  let db;
  try {
    db = new DatabaseSync(join(root, "sentinel.sqlite"), { readOnly: true });
    db.exec("PRAGMA foreign_keys=ON");
    checkDB(db);
    const audit = verifyAudit(db, {
      keyFile: externalKey,
      checkpointFile: join(root, "audit-checkpoint.json"),
    });
    if (
      audit.rootId !== payload.audit.rootId ||
      audit.tipAuditId !== payload.audit.tipAuditId ||
      audit.tipMAC !== payload.audit.tipMAC ||
      canonical(counts(db)) !== canonical(payload.counts)
    )
      fail("Backup snapshot metadata mismatch");
    const refs = db
      .prepare(
        "SELECT storage_key,sha256,bytes FROM document_versions UNION SELECT storage_key,sha256,bytes FROM draft_documents",
      )
      .all();
    for (const ref of refs) {
      const file = payload.files.find(
        (f) => f.path === "private/" + ref.storage_key,
      );
      if (!file || file.sha256 !== ref.sha256 || file.bytes !== ref.bytes)
        fail("Private object omitted or misbound in backup");
    }
    if (
      payload.files.filter((f) => f.path.startsWith("private/")).length !==
      new Set(refs.map((r) => r.storage_key)).size
    )
      fail("Unreferenced objects in backup");
    if (payload.keys.mfaSHA256)
      createMFA(db, { dir: root, keyFile: mfaKeyFile });
    return { valid: true, manifest: payload, signature, root, externalKey };
  } finally {
    db?.close();
  }
}
export async function restoreBackup({
  archive,
  output,
  auditKeyFile,
  mfaKeyFile,
}) {
  if (!output) fail("An explicit new isolated restore destination is required");
  const verified = await verifyBackup({ archive, auditKeyFile, mfaKeyFile });
  const target = newDestination(output, verified.root);
  let db, release;
  try {
    release = acquireLock(target);
    mkdirSync(join(target, "private"));
    mkdirSync(join(target, "security"));
    for (const file of verified.manifest.files) {
      const destination = join(
        target,
        file.path === "audit-checkpoint.json"
          ? "security/audit-checkpoint.json"
          : file.path,
      );
      copyFileSync(
        join(verified.root, file.path),
        destination,
        constants.COPYFILE_EXCL,
      );
      flush(destination);
      if ((await fileHash(destination)) !== file.sha256)
        fail("Restored object integrity failure");
    }
    db = new DatabaseSync(join(target, "sentinel.sqlite"));
    db.exec("PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL");
    checkDB(db);
    const integrity = createAuditIntegrity(db, {
      dir: target,
      keyFile: verified.externalKey,
      checkpointFile: join(target, "security", "audit-checkpoint.json"),
    });
    const sessions = db.prepare("SELECT count(*) n FROM sessions").get().n;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM sessions").run();
      db.prepare(
        "INSERT INTO audit(actor,action,payload,created,correlation_id,category,outcome) VALUES('system','backup_restored',?,?,'restore','security','SUCCESS')",
      ).run(
        JSON.stringify({
          archiveId: verified.manifest.id,
          manifestSHA256: hash(Buffer.from(canonical(verified.manifest))),
          sessionsRevoked: sessions,
          basis: "EXPLICIT_ISOLATED_HISTORICAL_RESTORE",
        }),
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    integrity.checkpoint();
    const checked = integrity.verify();
    const receipt = {
      archiveId: verified.manifest.id,
      destination: target,
      restored: true,
      sessionsRevoked: sessions,
      auditValid: checked.valid,
      keysIncluded: false,
      startupVerified: false,
      classification: "ISOLATED_RESTORE_NOT_PRODUCTION_ROLLBACK_APPROVAL",
    };
    writeFileSync(
      join(target, "restore-receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return receipt;
  } finally {
    db?.close();
    release?.();
  }
}
