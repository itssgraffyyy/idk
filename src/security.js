import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  openSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
const derive = promisify(scrypt);
let active = 0;
const dummySalt = randomBytes(16).toString("hex");
const dummyDigest = Buffer.alloc(64);
export async function verifyPassword(value, stored) {
  if (active >= 4)
    throw Object.assign(Error("Authentication capacity reached; retry"), {
      status: 429,
    });
  active++;
  try {
    const [salt, digest] = stored
      ? stored.split(":")
      : [dummySalt, dummyDigest.toString("hex")];
    const computed = await derive(value, salt, 64);
    return timingSafeEqual(Buffer.from(digest, "hex"), computed) && !!stored;
  } finally {
    active--;
  }
}
export function acquireLock(dir) {
  const path = join(dir, ".server.lock"),
    token = randomBytes(16).toString("hex");
  function take() {
    const fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
    closeSync(fd);
  }
  try {
    take();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let owner;
    try {
      owner = JSON.parse(readFileSync(path, "utf8"));
      if (!Number.isInteger(owner.pid) || owner.pid <= 0)
        throw Error("invalid");
    } catch {
      throw Error("Server lock is unreadable; inspect it before recovery");
    }
    try {
      process.kill(owner.pid, 0);
      throw Error("This data directory is already served by a live process");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    unlinkSync(path);
    take();
  }
  return () => {
    try {
      if (JSON.parse(readFileSync(path, "utf8")).token === token)
        unlinkSync(path);
    } catch {}
  };
}
export function permittedHost(value) {
  try {
    const name = new URL("http://" + value).hostname;
    return [
      "127.0.0.1",
      "localhost",
      "[::1]",
      ...(process.env.ALLOWED_HOSTS || "").split(",").filter(Boolean),
    ].includes(name);
  } catch {
    return false;
  }
}
export function requestLimiter({ limit = 300, windowMs = 60000 } = {}) {
  const records = new Map();
  return (key) => {
    const now = Date.now();
    if (records.size > 10000)
      for (const [k, v] of records) if (v.end <= now) records.delete(k);
    let v = records.get(key);
    if (!v || v.end <= now) {
      v = { n: 0, end: now + windowMs };
      records.set(key, v);
    }
    return ++v.n <= limit;
  };
}
