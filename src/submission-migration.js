export const submissionMigration = {
  version: 13,
  sql: `CREATE TABLE draft_documents(id TEXT PRIMARY KEY,draft_id TEXT NOT NULL REFERENCES submission_drafts(id),sha256 TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,storage_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('uploaded','processing','completed','failed','superseded','interrupted')),extraction TEXT CHECK(extraction IS NULL OR json_valid(extraction)),created TEXT NOT NULL);
CREATE INDEX draft_documents_owner ON draft_documents(draft_id,created);
CREATE TRIGGER draft_blob_identity BEFORE UPDATE OF id,draft_id,sha256,mime,bytes,storage_key ON draft_documents BEGIN SELECT RAISE(ABORT,'immutable draft document identity');END;
CREATE TRIGGER draft_blob_no_delete BEFORE DELETE ON draft_documents BEGIN SELECT RAISE(ABORT,'immutable draft document version');END;
CREATE TABLE draft_extraction_attempts(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES draft_documents(id),payload TEXT NOT NULL CHECK(json_valid(payload)),created TEXT NOT NULL);
CREATE INDEX draft_attempts_document ON draft_extraction_attempts(document_id,created);
CREATE TRIGGER draft_attempt_immutable BEFORE UPDATE ON draft_extraction_attempts BEGIN SELECT RAISE(ABORT,'immutable draft recognition attempt');END;
CREATE TRIGGER draft_attempt_no_delete BEFORE DELETE ON draft_extraction_attempts BEGIN SELECT RAISE(ABORT,'immutable draft recognition attempt');END;`,
};
