export const notificationMigration = {
  version: 15,
  sql: `ALTER TABLE reminder_preferences ADD COLUMN categories TEXT NOT NULL DEFAULT '["maturity","clarification"]' CHECK(json_valid(categories));
CREATE TABLE reminder_deliveries(notification_id TEXT PRIMARY KEY REFERENCES case_notifications(id),case_id TEXT NOT NULL REFERENCES cases(id),user_id TEXT NOT NULL REFERENCES users(id),category TEXT NOT NULL,condition_key TEXT NOT NULL,context TEXT NOT NULL CHECK(json_valid(context)),created TEXT NOT NULL);
CREATE INDEX reminder_deliveries_case ON reminder_deliveries(case_id,created,notification_id);
INSERT INTO reminder_deliveries SELECT id,case_id,user_id,replace(category,'_reminder',''),dedupe_key,json_object('legacy',json('true'),'sourceProvenance','NOT_RECORDED'),created FROM case_notifications WHERE category IN ('maturity_reminder','clarification_reminder');
CREATE TRIGGER reminder_deliveries_immutable BEFORE UPDATE ON reminder_deliveries BEGIN SELECT RAISE(ABORT,'immutable reminder delivery');END;
CREATE TRIGGER reminder_deliveries_no_delete BEFORE DELETE ON reminder_deliveries BEGIN SELECT RAISE(ABORT,'immutable reminder delivery');END;`,
};
