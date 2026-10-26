import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
  renameSync,
  constants,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
export class LocalPrivateStorage {
  constructor(dir) {
    this.root = resolve(dir, "private");
    this.recovery = resolve(dir, "recovery", "orphans");
    mkdirSync(this.root, { recursive: true });
  }
  path(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id))
      throw Object.assign(Error("Invalid storage key"), { status: 400 });
    return join(this.root, id);
  }
  write(id, bytes) {
    const target = this.path(id),
      temp = target + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temp, bytes, { flag: "wx", mode: 0o600 });
      const fd = openSync(temp, "r+");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      copyFileSync(temp, target, constants.COPYFILE_EXCL);
      const out = openSync(target, "r+");
      try {
        fsyncSync(out);
      } finally {
        closeSync(out);
      }
    } finally {
      try {
        unlinkSync(temp);
      } catch {}
    }
  }
  read(id) {
    try {
      return readFileSync(this.path(id));
    } catch (e) {
      if (e.status) throw e;
      throw Object.assign(Error("Private document unavailable"), {
        status: 503,
      });
    }
  }
  remove(id) {
    unlinkSync(this.path(id));
  }
  recover(keys) {
    const known = new Set(keys);
    let count = 0;
    for (const name of readdirSync(this.root)) {
      if (
        !/^[a-f0-9-]{36}(\.[a-f0-9-]{36}\.tmp)?$/i.test(name) ||
        known.has(name)
      )
        continue;
      mkdirSync(this.recovery, { recursive: true });
      renameSync(
        join(this.root, name),
        join(this.recovery, name + "." + randomUUID()),
      );
      count++;
    }
    return count;
  }
}
