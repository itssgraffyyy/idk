export const clearanceMigration = {
  version: 16,
  sql: `CREATE TABLE clearance_events(id TEXT PRIMARY KEY,authority TEXT NOT NULL,case_id TEXT REFERENCES cases(id),entity TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('procedure','activation','grant','binding','request','proposal','administration')),action TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),previous TEXT REFERENCES clearance_events(id),actor TEXT NOT NULL REFERENCES users(id),payload TEXT NOT NULL CHECK(json_valid(payload)),created TEXT NOT NULL,UNIQUE(entity,revision),UNIQUE(previous));
CREATE INDEX clearance_events_entity ON clearance_events(entity,revision DESC);
CREATE INDEX clearance_events_case ON clearance_events(case_id,kind);
CREATE INDEX clearance_events_authority ON clearance_events(authority,kind);
CREATE TRIGGER clearance_events_append BEFORE INSERT ON clearance_events WHEN
 (NEW.revision=1 AND (NEW.previous IS NOT NULL OR EXISTS(SELECT 1 FROM clearance_events WHERE entity=NEW.entity))) OR
 (NEW.revision>1 AND NOT EXISTS(SELECT 1 FROM clearance_events p WHERE p.id=NEW.previous AND p.entity=NEW.entity AND p.kind=NEW.kind AND p.authority=NEW.authority AND p.case_id IS NEW.case_id AND p.revision=NEW.revision-1))
 BEGIN SELECT RAISE(ABORT,'invalid clearance event lineage');END;
CREATE TRIGGER clearance_events_immutable BEFORE UPDATE ON clearance_events BEGIN SELECT RAISE(ABORT,'immutable clearance event');END;
CREATE TRIGGER clearance_events_no_delete BEFORE DELETE ON clearance_events BEGIN SELECT RAISE(ABORT,'immutable clearance event');END;`,
};
