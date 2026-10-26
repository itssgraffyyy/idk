import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomBytes, scryptSync, createHash } from "node:crypto";
export function password(p, salt = randomBytes(16).toString("hex")) {
  return salt + ":" + scryptSync(p, salt, 64).toString("hex");
}
export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dir + "/sentinel.sqlite");
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY); INSERT OR IGNORE INTO migrations VALUES(1);
 CREATE TABLE IF NOT EXISTS institutions(tenant TEXT PRIMARY KEY,name TEXT NOT NULL,created TEXT NOT NULL); INSERT OR IGNORE INTO migrations VALUES(4);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,document_id TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created TEXT NOT NULL); INSERT OR IGNORE INTO migrations VALUES(2);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT CHECK(role IN ('institution','officer')),tenant TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),csrf TEXT,expires INTEGER);
 CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,assigned TEXT REFERENCES users(id),name TEXT NOT NULL,obligation TEXT NOT NULL,instrument TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,case_id TEXT REFERENCES cases(id),kind TEXT NOT NULL,payload TEXT NOT NULL,created TEXT NOT NULL,actor TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,case_id TEXT,payload TEXT,created TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS cases_money_insert BEFORE INSERT ON cases WHEN json_type(NEW.instrument,'$.amountPaise') IS NOT 'integer' OR json_extract(NEW.instrument,'$.amountPaise')<=0 OR json_extract(NEW.instrument,'$.amountPaise')>9007199254740991 OR json_type(NEW.obligation,'$.amountPaise') IS NOT 'integer' OR json_extract(NEW.obligation,'$.amountPaise')<=0 BEGIN SELECT RAISE(ABORT,'invalid financial amount'); END;
 CREATE TRIGGER IF NOT EXISTS cases_money_update BEFORE UPDATE ON cases WHEN json_type(NEW.instrument,'$.amountPaise') IS NOT 'integer' OR json_extract(NEW.instrument,'$.amountPaise')<=0 OR json_extract(NEW.instrument,'$.amountPaise')>9007199254740991 BEGIN SELECT RAISE(ABORT,'invalid financial amount'); END;
 INSERT OR IGNORE INTO migrations VALUES(3);
 CREATE TRIGGER IF NOT EXISTS evidence_immutable BEFORE UPDATE ON evidence BEGIN SELECT RAISE(ABORT,'immutable evidence'); END;
 CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence BEGIN SELECT RAISE(ABORT,'immutable evidence'); END;
 CREATE TRIGGER IF NOT EXISTS audit_immutable BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
 CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;`);
  return db;
}
export const hash = (b) => createHash("sha256").update(b).digest("hex");
