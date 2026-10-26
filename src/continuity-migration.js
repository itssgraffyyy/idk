export const continuityMigration = {
  version: 14,
  sql: `CREATE TABLE continuity_events(id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES cases(id),proposal_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('proposed','registered','rejected','withdrawn')),predecessor TEXT NOT NULL REFERENCES instruments(id),successor TEXT NOT NULL REFERENCES instruments(id),actor TEXT NOT NULL REFERENCES users(id),input_revision INTEGER NOT NULL,reason TEXT NOT NULL,created TEXT NOT NULL,CHECK(predecessor!=successor));
CREATE INDEX continuity_case ON continuity_events(case_id,created,id);
CREATE INDEX continuity_proposal ON continuity_events(proposal_id,kind);
CREATE UNIQUE INDEX continuity_one_proposal ON continuity_events(proposal_id) WHERE kind='proposed';
CREATE UNIQUE INDEX continuity_one_resolution ON continuity_events(proposal_id) WHERE kind!='proposed';
CREATE UNIQUE INDEX continuity_registered_successor ON continuity_events(successor) WHERE kind='registered';
CREATE TRIGGER continuity_insert_guard BEFORE INSERT ON continuity_events WHEN NOT EXISTS(SELECT 1 FROM case_instruments a JOIN case_instruments b ON a.case_id=b.case_id JOIN instruments i ON i.id=a.instrument_id JOIN instruments j ON j.id=b.instrument_id WHERE a.case_id=NEW.case_id AND a.instrument_id=NEW.predecessor AND b.instrument_id=NEW.successor AND i.obligation_id=j.obligation_id AND i.tenant=j.tenant) BEGIN SELECT RAISE(ABORT,'continuity identity mismatch');END;
CREATE TRIGGER continuity_immutable BEFORE UPDATE ON continuity_events BEGIN SELECT RAISE(ABORT,'immutable continuity event');END;
CREATE TRIGGER continuity_no_delete BEFORE DELETE ON continuity_events BEGIN SELECT RAISE(ABORT,'immutable continuity event');END;
CREATE TRIGGER continuity_revision AFTER INSERT ON continuity_events BEGIN UPDATE case_operations SET input_revision=input_revision+1,updated=NEW.created WHERE case_id=NEW.case_id;END;
CREATE TRIGGER continuity_instrument_revision AFTER UPDATE OF data,status,obligation_id ON instruments WHEN NEW.data!=OLD.data OR NEW.status!=OLD.status OR NEW.obligation_id!=OLD.obligation_id BEGIN UPDATE case_operations SET input_revision=input_revision+1,updated=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE case_id IN (SELECT case_id FROM case_instruments WHERE instrument_id=NEW.id);END;
CREATE TRIGGER continuity_link_revision AFTER INSERT ON case_instruments BEGIN UPDATE case_operations SET input_revision=input_revision+1,updated=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE case_id=NEW.case_id;END;
CREATE TABLE reminder_preferences(user_id TEXT NOT NULL REFERENCES users(id),case_id TEXT NOT NULL REFERENCES cases(id),windows TEXT NOT NULL CHECK(json_valid(windows)),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),PRIMARY KEY(user_id,case_id));`,
};
