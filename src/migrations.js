import { createHash } from "node:crypto";
import { join } from "node:path";
import { foundationMigration } from "./foundation-migration.js";
export const upgrades = [
  foundationMigration,
  {
    version: 6,
    sql: `ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled'));
CREATE INDEX IF NOT EXISTS users_status ON users(status);
CREATE TRIGGER users_disable_sessions AFTER UPDATE OF status ON users WHEN NEW.status='disabled' BEGIN DELETE FROM sessions WHERE user_id=NEW.id; END;`,
  },
  {
    version: 5,
    sql: `
CREATE INDEX IF NOT EXISTS evidence_case ON evidence(case_id);
CREATE INDEX IF NOT EXISTS audit_case ON audit(case_id);
CREATE INDEX IF NOT EXISTS cases_tenant ON cases(tenant);
CREATE INDEX IF NOT EXISTS cases_assigned ON cases(assigned);
CREATE INDEX IF NOT EXISTS cases_reference ON cases(tenant,json_extract(instrument,'$.reference'));
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_document ON jobs(document_id) WHERE status='processing';
CREATE TABLE IF NOT EXISTS idempotency(actor TEXT NOT NULL,key TEXT NOT NULL,payload_hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(actor,key));
DROP TRIGGER IF EXISTS cases_money_insert;
DROP TRIGGER IF EXISTS cases_money_update;
CREATE TRIGGER cases_money_insert BEFORE INSERT ON cases WHEN json_valid(NEW.instrument)=0 OR json_valid(NEW.obligation)=0 OR json_type(NEW.instrument,'$.amountPaise') IS NOT 'integer' OR json_extract(NEW.instrument,'$.amountPaise') NOT BETWEEN 1 AND 9007199254740991 OR json_type(NEW.obligation,'$.amountPaise') IS NOT 'integer' OR json_extract(NEW.obligation,'$.amountPaise') NOT BETWEEN 1 AND 9007199254740991 OR NEW.revision<1 BEGIN SELECT RAISE(ABORT,'invalid financial amount'); END;
CREATE TRIGGER cases_money_update BEFORE UPDATE ON cases WHEN json_valid(NEW.instrument)=0 OR json_valid(NEW.obligation)=0 OR json_type(NEW.instrument,'$.amountPaise') IS NOT 'integer' OR json_extract(NEW.instrument,'$.amountPaise') NOT BETWEEN 1 AND 9007199254740991 OR json_type(NEW.obligation,'$.amountPaise') IS NOT 'integer' OR json_extract(NEW.obligation,'$.amountPaise') NOT BETWEEN 1 AND 9007199254740991 OR NEW.revision<1 BEGIN SELECT RAISE(ABORT,'invalid financial amount'); END;
CREATE TRIGGER users_valid_insert BEFORE INSERT ON users WHEN NEW.role IS NULL OR NEW.role NOT IN ('institution','officer') OR NEW.tenant IS NULL OR length(NEW.tenant)=0 BEGIN SELECT RAISE(ABORT,'invalid user boundary'); END;
CREATE TRIGGER users_valid_update BEFORE UPDATE ON users WHEN NEW.role IS NULL OR NEW.role NOT IN ('institution','officer') OR NEW.tenant IS NULL OR length(NEW.tenant)=0 BEGIN SELECT RAISE(ABORT,'invalid user boundary'); END;
CREATE TRIGGER jobs_valid_insert BEFORE INSERT ON jobs WHEN NOT EXISTS(SELECT 1 FROM cases WHERE id=NEW.case_id) OR NEW.status NOT IN ('processing','completed','failed','superseded','interrupted') BEGIN SELECT RAISE(ABORT,'invalid job'); END;
CREATE TRIGGER jobs_valid_update BEFORE UPDATE ON jobs WHEN NOT EXISTS(SELECT 1 FROM cases WHERE id=NEW.case_id) OR NEW.status NOT IN ('processing','completed','failed','superseded','interrupted') BEGIN SELECT RAISE(ABORT,'invalid job'); END;
`,
  },
];
export function migrate(db, dir) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)",
  );
  for (const m of [...upgrades].sort((a, b) => a.version - b.version)) {
    const digest = createHash("sha256").update(m.sql).digest("hex"),
      existing = db
        .prepare("SELECT sha256 FROM schema_migrations WHERE version=?")
        .get(m.version);
    if (existing) {
      if (existing.sha256 !== digest)
        throw Error("Migration checksum changed: " + m.version);
      continue;
    }
    if (db.prepare("SELECT count(*) n FROM cases").get().n) {
      const backup = join(
        dir,
        "pre-migration-" + m.version + "-" + Date.now() + ".sqlite",
      );
      db.prepare("VACUUM INTO ?").run(backup);
    }
    if (m.foreignKeysOff) db.exec("PRAGMA foreign_keys=OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      if (db.prepare("PRAGMA foreign_key_check").all().length)
        throw Error("Migration foreign key validation failed");
      db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(
        m.version,
        digest,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      if (m.foreignKeysOff) db.exec("PRAGMA foreign_keys=ON");
    }
  }
}
