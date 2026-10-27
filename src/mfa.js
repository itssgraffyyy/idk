import {
  createHmac,
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
export const mfaMigration = {
  version: 20,
  sql: `CREATE TABLE user_mfa(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT,pending_secret TEXT,pending_session TEXT,pending_expires INTEGER,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),last_counter INTEGER NOT NULL DEFAULT -1,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE mfa_recovery(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),digest TEXT NOT NULL UNIQUE,used_at INTEGER);
CREATE TABLE session_assurance(token TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE,mfa_at INTEGER NOT NULL,stepup_expires INTEGER NOT NULL);
CREATE TABLE mfa_attempts(user_id TEXT PRIMARY KEY REFERENCES users(id),starts INTEGER NOT NULL,attempts INTEGER NOT NULL);`,
};
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export function fromBase32(value) {
  if (typeof value !== "string" || !/^[A-Z2-7]+$/.test(value))
    throw Error("Invalid base32 secret");
  let bits = 0,
    buffer = 0;
  const out = [];
  for (const c of value) {
    buffer = (buffer << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
// RFC6238 / RFC4226 dynamic truncation; test vectors use eight digits.
export function totp(
  secret,
  milliseconds,
  { digits = 6, algorithm = "sha1" } = {},
) {
  const counter = Math.floor(milliseconds / 30000);
  if (
    !Number.isSafeInteger(counter) ||
    counter < 0 ||
    ![6, 8].includes(digits) ||
    !["sha1", "sha256", "sha512"].includes(algorithm)
  )
    throw Error("Invalid TOTP parameters");
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(
      algorithm,
      Buffer.isBuffer(secret) ? secret : fromBase32(secret),
    )
      .update(bytes)
      .digest(),
    offset = hmac.at(-1) & 15;
  return String(
    (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, "0");
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createMFA(db, { dir, keyFile, now = () => Date.now() } = {}) {
  const path = resolve(keyFile || join(dir, "security", "mfa.key"));
  if (!existsSync(path)) {
    if (db.prepare("SELECT count(*) n FROM user_mfa").get().n)
      fail(
        503,
        "MFA encryption key unavailable; existing enrollment must not be reset",
      );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
  }
  let key;
  try {
    key = readFileSync(path);
    if (key.length !== 32) throw Error();
  } catch {
    fail(503, "MFA encryption key unavailable");
  }
  const encrypt = (user, secret) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(user));
    const bytes = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
  };
  const decrypt = (user, value) => {
    try {
      const bytes = Buffer.from(value, "base64"),
        decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(user));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      fail(503, "MFA secret integrity failure");
    }
  };
  // Authenticate stored ciphertext at startup; wrong keys cannot silently disable MFA.
  for (const r of db.prepare("SELECT * FROM user_mfa").all()) {
    if (r.secret) decrypt(r.user_id, r.secret);
    if (r.pending_secret) decrypt(r.user_id, r.pending_secret);
  }
  const state = (user) =>
    db.prepare("SELECT * FROM user_mfa WHERE user_id=?").get(user);
  const limit = (user) => {
    const time = now(),
      old = db.prepare("SELECT * FROM mfa_attempts WHERE user_id=?").get(user);
    if (old && time - old.starts < 60000 && old.attempts >= 5)
      fail(429, "Too many MFA attempts; wait one minute");
    db.prepare(
      "INSERT INTO mfa_attempts VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET starts=excluded.starts,attempts=?",
    ).run(
      user,
      old && time - old.starts < 60000 ? old.starts : time,
      old && time - old.starts < 60000 ? old.attempts + 1 : 1,
    );
  };
  const counter = (secret, code, last) => {
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
    const current = Math.floor(now() / 30000);
    for (const n of [current, current - 1, current + 1])
      if (n >= 0 && n > last && equal(totp(secret, n * 30000), code)) return n;
    return null;
  };
  const consume = (user, body) => {
    const row = state(user);
    if (!row?.enabled) return { mfa: false };
    if (body.recoveryCode !== undefined) {
      const value =
        typeof body.recoveryCode === "string"
          ? body.recoveryCode.toLowerCase().replace(/-/g, "")
          : "";
      if (!/^[a-f0-9]{32}$/.test(value))
        fail(401, "Invalid or previously used second factor");
      const record = db
        .prepare(
          "SELECT id FROM mfa_recovery WHERE user_id=? AND digest=? AND used_at IS NULL",
        )
        .get(user, digest(user + ":" + value));
      if (!record) fail(401, "Invalid or previously used second factor");
      const result = db
        .prepare(
          "UPDATE mfa_recovery SET used_at=? WHERE id=? AND used_at IS NULL",
        )
        .run(now(), record.id);
      if (!result.changes)
        fail(401, "Invalid or previously used second factor");
      return { mfa: true, recoveryId: record.id };
    }
    const step = counter(
      decrypt(user, row.secret),
      body.mfaCode,
      row.last_counter,
    );
    if (step === null)
      fail(401, "Second factor required, invalid or already used");
    const updated = db
      .prepare(
        "UPDATE user_mfa SET last_counter=? WHERE user_id=? AND last_counter<? AND revision=?",
      )
      .run(step, user, step, row.revision);
    if (!updated.changes) fail(409, "MFA state changed; use a fresh code");
    return { mfa: true };
  };
  const assurance = (token) =>
    db.prepare("SELECT * FROM session_assurance WHERE token=?").get(token);
  const assure = (token) =>
    db
      .prepare(
        "INSERT INTO session_assurance VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET mfa_at=excluded.mfa_at,stepup_expires=excluded.stepup_expires",
      )
      .run(token, now(), now() + 300000);
  const recovery = (user) => {
    db.prepare("DELETE FROM mfa_recovery WHERE user_id=?").run(user);
    const tokens = [];
    for (let i = 0; i < 8; i++) {
      const value = randomBytes(16).toString("hex"),
        id = randomBytes(16).toString("hex");
      db.prepare("INSERT INTO mfa_recovery VALUES(?,?,?,NULL)").run(
        id,
        user,
        digest(user + ":" + value),
      );
      tokens.push(value.match(/.{4}/g).join("-"));
    }
    return tokens;
  };
  return {
    now,
    state,
    limit,
    consume,
    assurance,
    assure,
    status(user, token) {
      const row = state(user);
      return {
        enabled: !!row?.enabled,
        pending: !!row?.pending_secret && row.pending_expires > now(),
        revision: row?.revision || 0,
        recoveryRemaining: db
          .prepare(
            "SELECT count(*) n FROM mfa_recovery WHERE user_id=? AND used_at IS NULL",
          )
          .get(user).n,
        stepUpUntil: assurance(token)?.stepup_expires || null,
      };
    },
    begin(user, token, revision) {
      const old = state(user);
      if (revision !== (old?.revision || 0))
        fail(409, "MFA enrollment changed");
      const secret = base32(randomBytes(20));
      db.prepare(
        "INSERT INTO user_mfa(user_id,pending_secret,pending_session,pending_expires) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET pending_secret=excluded.pending_secret,pending_session=excluded.pending_session,pending_expires=excluded.pending_expires,revision=user_mfa.revision+1",
      ).run(user, encrypt(user, secret), token, now() + 600000);
      return {
        secret,
        revision: (old?.revision || 0) + 1,
        expiresAt: now() + 600000,
      };
    },
    confirm(user, token, revision, code) {
      const row = state(user);
      if (
        !row?.pending_secret ||
        row.pending_session !== token ||
        row.pending_expires < now() ||
        row.revision !== revision
      )
        fail(409, "Pending enrollment expired or changed");
      const step = counter(decrypt(user, row.pending_secret), code, -1);
      if (step === null) fail(401, "Invalid enrollment code");
      db.prepare(
        "UPDATE user_mfa SET secret=pending_secret,pending_secret=NULL,pending_session=NULL,pending_expires=NULL,enabled=1,last_counter=?,revision=revision+1 WHERE user_id=?",
      ).run(step, user);
      db.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?").run(
        user,
        token,
      );
      assure(token);
      return { recoveryCodes: recovery(user) };
    },
    rotate(user, token) {
      db.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?").run(
        user,
        token,
      );
      assure(token);
      return { recoveryCodes: recovery(user) };
    },
    disable(user) {
      db.prepare("DELETE FROM mfa_recovery WHERE user_id=?").run(user);
      db.prepare("DELETE FROM user_mfa WHERE user_id=?").run(user);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user);
    },
  };
}
