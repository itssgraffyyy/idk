export const analysisMigration = {
  version: 18,
  sql: `CREATE TABLE legal_entity_claims(id TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES institutions(tenant),revision INTEGER NOT NULL CHECK(revision>0),previous TEXT REFERENCES legal_entity_claims(id),payload TEXT NOT NULL CHECK(json_valid(payload)),actor TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL,UNIQUE(tenant,revision),UNIQUE(previous));
CREATE TABLE analysis_records(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES cases(id),kind TEXT NOT NULL CHECK(kind IN ('snapshot','scenario')),base_id TEXT REFERENCES analysis_records(id),payload TEXT NOT NULL CHECK(json_valid(payload)),sha256 TEXT NOT NULL,actor TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL);
CREATE INDEX analysis_case ON analysis_records(case_id,kind);
CREATE TRIGGER legal_claim_lineage BEFORE INSERT ON legal_entity_claims WHEN (NEW.revision=1 AND (NEW.previous IS NOT NULL OR EXISTS(SELECT 1 FROM legal_entity_claims WHERE tenant=NEW.tenant))) OR (NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM legal_entity_claims WHERE id=NEW.previous AND tenant=NEW.tenant AND revision=NEW.revision-1)) BEGIN SELECT RAISE(ABORT,'invalid legal claim lineage');END;
CREATE TRIGGER legal_claim_immutable BEFORE UPDATE ON legal_entity_claims BEGIN SELECT RAISE(ABORT,'immutable legal claim');END;
CREATE TRIGGER legal_claim_no_delete BEFORE DELETE ON legal_entity_claims BEGIN SELECT RAISE(ABORT,'immutable legal claim');END;
CREATE TRIGGER analysis_binding BEFORE INSERT ON analysis_records WHEN (NEW.kind='snapshot' AND NEW.base_id IS NOT NULL) OR (NEW.kind='scenario' AND NOT EXISTS(SELECT 1 FROM analysis_records WHERE id=NEW.base_id AND case_id=NEW.case_id AND kind='snapshot')) BEGIN SELECT RAISE(ABORT,'invalid analysis binding');END;
CREATE TRIGGER analysis_immutable BEFORE UPDATE ON analysis_records BEGIN SELECT RAISE(ABORT,'immutable analysis record');END;
CREATE TRIGGER analysis_no_delete BEFORE DELETE ON analysis_records BEGIN SELECT RAISE(ABORT,'immutable analysis record');END;`,
};
