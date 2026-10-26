export const foundationMigration = {
  version: 7,
  foreignKeysOff: true,
  sql: `
CREATE TABLE users_v7(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('institution','institution_admin','officer','supervisor','audit_reviewer')),tenant TEXT NOT NULL CHECK(length(tenant)>0),status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')));
INSERT INTO users_v7 SELECT id,email,password,role,tenant,status FROM users;
DROP TABLE users;
ALTER TABLE users_v7 RENAME TO users;
CREATE INDEX users_status ON users(status);
CREATE TRIGGER users_disable_sessions AFTER UPDATE OF status ON users WHEN NEW.status='disabled' OR NEW.role!=OLD.role OR NEW.tenant!=OLD.tenant BEGIN DELETE FROM sessions WHERE user_id=NEW.id; END;
INSERT OR IGNORE INTO institutions SELECT tenant,min(name),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM cases GROUP BY tenant;
CREATE TABLE obligations(id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES institutions(tenant),amount_paise INTEGER NOT NULL CHECK(amount_paise BETWEEN 1 AND 9007199254740991),programme TEXT,level TEXT,policy_version TEXT,starts TEXT,ends TEXT,exemption TEXT,status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','requires_review','exemption_claimed')),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0));
CREATE INDEX obligations_tenant ON obligations(tenant,id);
CREATE TABLE instruments(id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES institutions(tenant),obligation_id TEXT NOT NULL REFERENCES obligations(id),data TEXT NOT NULL CHECK(json_valid(data)),status TEXT NOT NULL DEFAULT 'recorded' CHECK(status IN ('recorded','amended','superseded')),verification TEXT NOT NULL DEFAULT 'UNCONFIRMED' CHECK(verification='UNCONFIRMED'),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0));
CREATE INDEX instruments_obligation ON instruments(obligation_id,id);
CREATE TABLE case_domains(case_id TEXT PRIMARY KEY REFERENCES cases(id),obligation_id TEXT NOT NULL REFERENCES obligations(id),instrument_id TEXT NOT NULL REFERENCES instruments(id),status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','submitted','under_review','needs_information','resubmitted','review_recorded')),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0));
CREATE TABLE case_instruments(case_id TEXT REFERENCES cases(id),instrument_id TEXT REFERENCES instruments(id),PRIMARY KEY(case_id,instrument_id));
CREATE TABLE instrument_relationships(predecessor TEXT NOT NULL REFERENCES instruments(id),successor TEXT PRIMARY KEY REFERENCES instruments(id),reason TEXT NOT NULL,actor TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,CHECK(predecessor!=successor));
CREATE TRIGGER instrument_relationship_guard BEFORE INSERT ON instrument_relationships BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM instruments p JOIN instruments s ON p.tenant=s.tenant AND p.obligation_id=s.obligation_id WHERE p.id=NEW.predecessor AND s.id=NEW.successor) THEN RAISE(ABORT,'incompatible instrument relationship') END;
 SELECT CASE WHEN EXISTS(WITH RECURSIVE chain(id) AS (SELECT NEW.successor UNION SELECT r.successor FROM instrument_relationships r JOIN chain c ON r.predecessor=c.id) SELECT 1 FROM chain WHERE id=NEW.predecessor) THEN RAISE(ABORT,'cyclic instrument relationship') END;
END;
CREATE TRIGGER instrument_relationship_no_update BEFORE UPDATE ON instrument_relationships BEGIN SELECT RAISE(ABORT,'immutable relationship'); END;
CREATE TRIGGER instrument_relationship_no_delete BEFORE DELETE ON instrument_relationships BEGIN SELECT RAISE(ABORT,'immutable relationship'); END;
INSERT INTO obligations(id,tenant,amount_paise) SELECT 'obligation-'||id,tenant,json_extract(obligation,'$.amountPaise') FROM cases;
INSERT INTO instruments(id,tenant,obligation_id,data) SELECT 'instrument-'||id,tenant,'obligation-'||id,instrument FROM cases;
INSERT INTO case_domains(case_id,obligation_id,instrument_id) SELECT id,'obligation-'||id,'instrument-'||id FROM cases;
INSERT INTO case_instruments SELECT case_id,instrument_id FROM case_domains;
CREATE TRIGGER cases_domain_insert AFTER INSERT ON cases BEGIN
 INSERT INTO obligations(id,tenant,amount_paise) VALUES('obligation-'||NEW.id,NEW.tenant,json_extract(NEW.obligation,'$.amountPaise'));
 INSERT INTO instruments(id,tenant,obligation_id,data) VALUES('instrument-'||NEW.id,NEW.tenant,'obligation-'||NEW.id,NEW.instrument);
 INSERT INTO case_domains(case_id,obligation_id,instrument_id) VALUES(NEW.id,'obligation-'||NEW.id,'instrument-'||NEW.id);
 INSERT INTO case_instruments VALUES(NEW.id,'instrument-'||NEW.id);
END;
CREATE TRIGGER cases_domain_update AFTER UPDATE OF instrument,obligation ON cases BEGIN
 UPDATE instruments SET data=NEW.instrument,status='amended',revision=revision+1 WHERE id=(SELECT instrument_id FROM case_domains WHERE case_id=NEW.id);
 UPDATE obligations SET amount_paise=json_extract(NEW.obligation,'$.amountPaise'),revision=revision+1 WHERE id=(SELECT obligation_id FROM case_domains WHERE case_id=NEW.id) AND amount_paise!=json_extract(NEW.obligation,'$.amountPaise');
END;
CREATE TRIGGER instruments_tenant_insert BEFORE INSERT ON instruments WHEN NOT EXISTS(SELECT 1 FROM obligations WHERE id=NEW.obligation_id AND tenant=NEW.tenant) BEGIN SELECT RAISE(ABORT,'instrument tenant mismatch'); END;
CREATE TRIGGER instruments_tenant_update BEFORE UPDATE ON instruments WHEN NOT EXISTS(SELECT 1 FROM obligations WHERE id=NEW.obligation_id AND tenant=NEW.tenant) BEGIN SELECT RAISE(ABORT,'instrument tenant mismatch'); END;
CREATE TABLE documents(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES cases(id),kind TEXT NOT NULL CHECK(kind IN ('fdr','proof','other')),title TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE document_versions(id TEXT PRIMARY KEY REFERENCES evidence(id),document_id TEXT NOT NULL REFERENCES documents(id),version INTEGER NOT NULL CHECK(version>0),sha256 TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,storage_key TEXT NOT NULL UNIQUE,created TEXT NOT NULL,actor TEXT NOT NULL,UNIQUE(document_id,version));
CREATE INDEX documents_case ON documents(case_id,kind,id);
INSERT INTO documents SELECT 'document-'||case_id,case_id,'fdr','Legacy FDR versions',min(created) FROM evidence WHERE kind='document' GROUP BY case_id;
INSERT INTO document_versions SELECT id,'document-'||case_id,row_number() OVER(PARTITION BY case_id ORDER BY rowid),json_extract(payload,'$.sha256'),json_extract(payload,'$.mime'),json_extract(payload,'$.bytes'),id,created,actor FROM evidence WHERE kind='document';
CREATE TRIGGER versions_immutable BEFORE UPDATE ON document_versions BEGIN SELECT RAISE(ABORT,'immutable document version'); END;
CREATE TRIGGER versions_no_delete BEFORE DELETE ON document_versions BEGIN SELECT RAISE(ABORT,'immutable document version'); END;
CREATE TABLE role_permissions(role TEXT NOT NULL,permission TEXT NOT NULL,PRIMARY KEY(role,permission));
INSERT INTO role_permissions VALUES ('institution','own_records'),('institution_admin','own_records'),('institution_admin','institution_accounts'),('officer','assigned_review'),('supervisor','authority_review'),('supervisor','assign'),('supervisor','authority_accounts'),('audit_reviewer','authority_read');
`,
};
