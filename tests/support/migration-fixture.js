import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export function migrationFixture(version) {
  const path = new URL(
    "../fixtures/migrations/synthetic-schema-" + version + ".sqlite",
    import.meta.url,
  );
  const meta = JSON.parse(readFileSync(new URL(path.href + ".json"))),
    bytes = readFileSync(path);
  if (
    meta.classification !== "SYNTHETIC_TEST_ONLY" ||
    meta.schemaVersion !== version ||
    meta.sha256 !== createHash("sha256").update(bytes).digest("hex")
  )
    throw Error("Frozen migration fixture integrity failure");
  const dir = mkdtempSync(join(tmpdir(), "sentinel-frozen-upgrade-")),
    target = join(dir, "sentinel.sqlite");
  copyFileSync(path, target);
  const db = new DatabaseSync(target);
  db.exec("PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL");
  const snapshot = () =>
    Object.fromEntries(
      meta.preservedTables.map((table) => [
        table,
        db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all(),
      ]),
    );
  return {
    db,
    dir,
    snapshot,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
