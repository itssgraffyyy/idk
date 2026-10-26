export const operationsMigration = {
  version: 12,
  sql: `
CREATE TABLE case_operations(case_id TEXT PRIMARY KEY REFERENCES cases(id),stage TEXT NOT NULL CHECK(stage IN ('draft','submitted','intake_validation','ready_for_review','under_review','awaiting_response','response_received','reevaluation_required','pending_clearance','ready_for_decision','decision_recorded','closed')),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),input_revision INTEGER NOT NULL DEFAULT 1 CHECK(input_revision>0),reviewed_input_revision INTEGER,updated TEXT NOT NULL);
INSERT INTO case_operations(case_id,stage,updated) SELECT case_id,CASE status WHEN 'registered' THEN 'draft' WHEN 'submitted' THEN 'submitted' WHEN 'under_review' THEN 'under_review' WHEN 'needs_information' THEN 'awaiting_response' WHEN 'resubmitted' THEN 'response_received' ELSE 'under_review' END,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM case_domains;
CREATE TRIGGER case_operations_create AFTER INSERT ON cases BEGIN INSERT INTO case_operations(case_id,stage,updated) VALUES(NEW.id,'draft',strftime('%Y-%m-%dT%H:%M:%fZ','now'));END;
CREATE TRIGGER operations_evidence_revision AFTER INSERT ON evidence WHEN NEW.kind IN ('declaration','document','extraction','correction','extraction_correction','external','ifsc_reference','regulatory_context','proof_review','instrument_primary','obligation_revision','profile_reference','clarifications','responses','observations','clarification_review') BEGIN UPDATE case_operations SET input_revision=input_revision+1,updated=NEW.created WHERE case_id=NEW.case_id; END;
CREATE TRIGGER operations_case_revision AFTER UPDATE OF assigned,instrument,obligation ON cases WHEN NEW.assigned IS NOT OLD.assigned OR NEW.instrument!=OLD.instrument OR NEW.obligation!=OLD.obligation BEGIN UPDATE case_operations SET input_revision=input_revision+1,updated=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE case_id=NEW.id; END;
CREATE TABLE evaluation_resolutions(evaluation_id TEXT PRIMARY KEY REFERENCES evidence(id),case_id TEXT NOT NULL REFERENCES cases(id),previous_evaluation_id TEXT REFERENCES evidence(id),payload TEXT NOT NULL CHECK(json_valid(payload)),created TEXT NOT NULL);
CREATE INDEX resolutions_case ON evaluation_resolutions(case_id,created);
CREATE TRIGGER resolutions_immutable BEFORE UPDATE ON evaluation_resolutions BEGIN SELECT RAISE(ABORT,'immutable resolution');END;
CREATE TRIGGER resolutions_no_delete BEFORE DELETE ON evaluation_resolutions BEGIN SELECT RAISE(ABORT,'immutable resolution');END;
CREATE TABLE case_notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),case_id TEXT NOT NULL REFERENCES cases(id),category TEXT NOT NULL,dedupe_key TEXT NOT NULL,message TEXT NOT NULL,created TEXT NOT NULL,read_at TEXT,UNIQUE(user_id,dedupe_key));
CREATE INDEX notifications_user ON case_notifications(user_id,created);
CREATE TABLE structured_clarifications(id TEXT PRIMARY KEY REFERENCES evidence(id),case_id TEXT NOT NULL REFERENCES cases(id),finding_code TEXT,fields TEXT NOT NULL CHECK(json_valid(fields)),documents TEXT NOT NULL CHECK(json_valid(documents)),deadline TEXT,status TEXT NOT NULL CHECK(status IN ('open','responded','closed','reopened')),revision INTEGER NOT NULL DEFAULT 1,reviewer TEXT NOT NULL REFERENCES users(id),created TEXT NOT NULL);
CREATE INDEX clarifications_case ON structured_clarifications(case_id,status,deadline);
INSERT INTO structured_clarifications SELECT e.id,e.case_id,NULL,'[]','[]',NULL,CASE WHEN EXISTS(SELECT 1 FROM evidence r WHERE r.case_id=e.case_id AND r.kind='responses' AND json_extract(r.payload,'$.requestId')=e.id) THEN 'responded' ELSE 'open' END,1,e.actor,e.created FROM evidence e WHERE kind='clarifications' AND EXISTS(SELECT 1 FROM users u WHERE u.id=e.actor);
CREATE TABLE submission_drafts(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,actor TEXT NOT NULL REFERENCES users(id),payload TEXT NOT NULL CHECK(json_valid(payload)),revision INTEGER NOT NULL DEFAULT 1,case_id TEXT REFERENCES cases(id),created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE INDEX drafts_tenant ON submission_drafts(tenant,updated);
`,
};
