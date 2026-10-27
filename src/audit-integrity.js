import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { canonical } from "./clearance-procedure.js";
const columns = [
  "id",
  "actor",
  "action",
  "case_id",
  "payload",
  "created",
  "correlation_id",
  "category",
  "outcome",
];
const rowJSON =
  "json_object(" + columns.map((k) => "'" + k + "',NEW." + k).join(",") + ")";
export const auditIntegrityMigration = {
  version: 19,
  sql: `CREATE TABLE audit_root(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL CHECK(json_valid(payload)),mac TEXT NOT NULL);
CREATE TABLE audit_seals(audit_id INTEGER PRIMARY KEY REFERENCES audit(id),previous_mac TEXT NOT NULL,payload_sha256 TEXT NOT NULL,mac TEXT NOT NULL UNIQUE);
CREATE TRIGGER audit_root_immutable BEFORE UPDATE ON audit_root BEGIN SELECT RAISE(ABORT,'immutable audit root');END;
CREATE TRIGGER audit_root_no_delete BEFORE DELETE ON audit_root BEGIN SELECT RAISE(ABORT,'immutable audit root');END;
CREATE TRIGGER audit_seals_immutable BEFORE UPDATE ON audit_seals BEGIN SELECT RAISE(ABORT,'immutable audit seal');END;
CREATE TRIGGER audit_seals_no_delete BEFORE DELETE ON audit_seals BEGIN SELECT RAISE(ABORT,'immutable audit seal');END;
CREATE TRIGGER audit_seal_insert AFTER INSERT ON audit BEGIN
 SELECT CASE WHEN NEW.id<=coalesce((SELECT max(audit_id) FROM audit_seals),0) THEN RAISE(ABORT,'nonmonotonic audit sequence') END;
 INSERT INTO audit_seals(audit_id,previous_mac,payload_sha256,mac)
 SELECT NEW.id,previous,digest,audit_event_mac(NEW.id,previous,digest) FROM
 (SELECT coalesce((SELECT mac FROM audit_seals ORDER BY audit_id DESC LIMIT 1),(SELECT mac FROM audit_root WHERE id=1)) previous,audit_row_digest(${rowJSON}) digest);
END;`,
};
const fail = (message) => {
  throw Object.assign(Error(message), { status: 409 });
};
const digest = (v) => createHash("sha256").update(canonical(v)).digest("hex");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  /^[a-f0-9]{64}$/.test(a) &&
  /^[a-f0-9]{64}$/.test(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function auditPaths(dir, options = {}) {
  return {
    keyFile: resolve(options.keyFile || join(dir, "security", "audit.key")),
    checkpointFile: resolve(
      options.checkpointFile || join(dir, "security", "audit-checkpoint.json"),
    ),
  };
}
function atomicJSON(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, JSON.stringify(value) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    const fd = openSync(temp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
  }
}
function context(db, keyFile) {
  let key;
  try {
    key = readFileSync(keyFile);
    if (key.length !== 32) throw Error();
  } catch {
    fail(
      "Audit signing key unavailable or invalid; enrollment is never repeated automatically",
    );
  }
  const rootRow = db.prepare("SELECT * FROM audit_root WHERE id=1").get();
  if (!rootRow) fail("Audit integrity enrollment required");
  let root;
  try {
    root = JSON.parse(rootRow.payload);
  } catch {
    fail("Invalid audit root");
  }
  const mac = (v) =>
    createHmac("sha256", key).update(canonical(v)).digest("hex");
  if (
    !root ||
    root.format !== 1 ||
    !Number.isSafeInteger(root.legacyEvents) ||
    root.legacyEvents < 0 ||
    typeof root.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(root.id) ||
    root.algorithm !== "HMAC-SHA256" ||
    !equal(rootRow.mac, mac({ kind: "root", payload: root }))
  )
    fail("Audit root authentication failed");
  const eventMAC = (id, previous, hash) =>
    mac({ kind: "event", rootId: root.id, id, previous, payloadSHA256: hash });
  return { root, rootMAC: rootRow.mac, mac, eventMAC };
}
function readCheckpoint(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(
      "Protected audit checkpoint unavailable; explicit operator recovery required",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Invalid audit checkpoint");
  return value;
}
function checkpointStatus(db, ctx, path, captured) {
  const value = captured || readCheckpoint(path);
  const { signature, ...payload } = value;
  if (
    payload.format !== 1 ||
    payload.rootId !== ctx.root.id ||
    !Number.isSafeInteger(payload.auditId) ||
    payload.auditId < 0 ||
    !equal(signature, ctx.mac({ kind: "checkpoint", payload }))
  )
    fail("Audit checkpoint authentication failed");
  const current =
    payload.auditId === 0
      ? ctx.rootMAC
      : db
          .prepare("SELECT mac FROM audit_seals WHERE audit_id=?")
          .get(payload.auditId)?.mac;
  if (!equal(current, payload.tipMAC))
    fail("Audit rollback or checkpoint mismatch detected");
  return payload;
}
export function verifyAudit(db, { keyFile, checkpointFile }) {
  // Capture the checkpoint before pinning a SQLite snapshot. A concurrent writer
  // may advance both afterward; neither read is silently rebased mid-verification.
  const captured = readCheckpoint(checkpointFile);
  db.exec("SAVEPOINT audit_verification_snapshot");
  try {
    return verifyPinnedAudit(db, { keyFile, checkpointFile, captured });
  } finally {
    db.exec("RELEASE audit_verification_snapshot");
  }
}
function verifyPinnedAudit(db, { keyFile, checkpointFile, captured }) {
  const started = performance.now(),
    ctx = context(db, keyFile);
  let previous = ctx.rootMAC,
    last = 0,
    count = 0,
    legacyDigest = createHash("sha256");
  for (const r of db
    .prepare(
      "SELECT a.*,s.previous_mac,s.payload_sha256,s.mac FROM audit a LEFT JOIN audit_seals s ON s.audit_id=a.id ORDER BY a.id",
    )
    .iterate()) {
    const row = Object.fromEntries(columns.map((k) => [k, r[k]])),
      hash = digest(row);
    if (
      r.id <= last ||
      !equal(r.previous_mac, previous) ||
      !equal(r.payload_sha256, hash) ||
      !equal(r.mac, ctx.eventMAC(r.id, previous, hash))
    )
      fail("Audit event authentication, order or completeness failed");
    if (count < ctx.root.legacyEvents)
      legacyDigest.update(canonical(row) + "\n");
    previous = r.mac;
    last = r.id;
    count++;
  }
  if (db.prepare("SELECT count(*) n FROM audit_seals").get().n !== count)
    fail("Orphaned audit seals detected");
  if (
    count < ctx.root.legacyEvents ||
    legacyDigest.digest("hex") !== ctx.root.legacyDigest
  )
    fail("Legacy audit enrollment anchor mismatch");
  const checkpoint = checkpointStatus(db, ctx, checkpointFile, captured);
  if (checkpoint.auditId > last)
    fail("Audit truncated below protected checkpoint");
  return {
    valid: true,
    algorithm: "HMAC-SHA256",
    rootId: ctx.root.id,
    events: count,
    tipAuditId: last,
    tipMAC: previous,
    checkpointAuditId: checkpoint.auditId,
    checkpointLag: last - checkpoint.auditId,
    legacyEventsAnchoredAtEnrollment: ctx.root.legacyEvents,
    legacyWasUnsignedBeforeEnrollment: true,
    elapsedMs: performance.now() - started,
    trust: "KEY_AND_CHECKPOINT_FILES_REQUIRE_INDEPENDENT_PROTECTION",
  };
}
export function createAuditIntegrity(db, { dir, ...options }) {
  const paths = auditPaths(dir, options);
  if (paths.keyFile === paths.checkpointFile)
    fail("Audit key and checkpoint must be separate files");
  let rootRow = db.prepare("SELECT * FROM audit_root WHERE id=1").get();
  if (!rootRow) {
    if (
      db.prepare("SELECT count(*) n FROM audit_seals").get().n ||
      existsSync(paths.checkpointFile)
    )
      fail("Unexpected audit enrollment state; explicit recovery required");
    if (!existsSync(paths.keyFile)) {
      mkdirSync(dirname(paths.keyFile), { recursive: true });
      writeFileSync(paths.keyFile, randomBytes(32), {
        flag: "wx",
        mode: 0o600,
      });
    }
    const key = readFileSync(paths.keyFile);
    if (key.length !== 32) fail("Invalid audit key");
    const mac = (v) =>
      createHmac("sha256", key).update(canonical(v)).digest("hex");
    const rows = db.prepare("SELECT * FROM audit ORDER BY id").all();
    const legacyDigest = createHash("sha256");
    for (const r of rows) legacyDigest.update(canonical({ ...r }) + "\n");
    const root = {
      format: 1,
      algorithm: "HMAC-SHA256",
      id: randomUUID(),
      enrolledAt: new Date().toISOString(),
      legacyEvents: rows.length,
      legacyDigest: legacyDigest.digest("hex"),
      legacyStatus: "UNSIGNED_BEFORE_ENROLLMENT",
    };
    const rootMAC = mac({ kind: "root", payload: root });
    let previous = rootMAC,
      last = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO audit_root VALUES(1,?,?)").run(
        JSON.stringify(root),
        rootMAC,
      );
      for (const r of rows) {
        const hash = digest({ ...r }),
          signature = mac({
            kind: "event",
            rootId: root.id,
            id: r.id,
            previous,
            payloadSHA256: hash,
          });
        db.prepare("INSERT INTO audit_seals VALUES(?,?,?,?)").run(
          r.id,
          previous,
          hash,
          signature,
        );
        previous = signature;
        last = r.id;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    const payload = {
      format: 1,
      rootId: root.id,
      auditId: last,
      tipMAC: previous,
    };
    atomicJSON(paths.checkpointFile, {
      ...payload,
      signature: mac({ kind: "checkpoint", payload }),
    });
    rootRow = db.prepare("SELECT * FROM audit_root WHERE id=1").get();
  }
  verifyAudit(db, paths);
  const ctx = context(db, paths.keyFile);
  // Pure SQL functions: trigger signing is atomic with every audit INSERT, including reminders.
  // Offline SQLite connections have no signing function or signing key.
  db.function("audit_row_digest", (json) => digest(JSON.parse(json)));
  db.function("audit_event_mac", (id, previous, hash) =>
    ctx.eventMAC(id, previous, hash),
  );
  const checkpoint = () => {
    checkpointStatus(db, ctx, paths.checkpointFile);
    const tip = db
      .prepare(
        "SELECT audit_id,mac FROM audit_seals ORDER BY audit_id DESC LIMIT 1",
      )
      .get();
    const payload = {
      format: 1,
      rootId: ctx.root.id,
      auditId: tip?.audit_id || 0,
      tipMAC: tip?.mac || ctx.rootMAC,
    };
    try {
      atomicJSON(paths.checkpointFile, {
        ...payload,
        signature: ctx.mac({ kind: "checkpoint", payload }),
      });
    } catch {
      throw Object.assign(
        Error(
          "Audit checkpoint could not be persisted; inspect the committed action before retrying",
        ),
        { status: 503 },
      );
    }
  };
  checkpoint();
  return { paths, checkpoint, verify: () => verifyAudit(db, paths) };
}
