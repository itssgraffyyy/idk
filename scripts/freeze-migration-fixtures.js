// Archival generator for the schema-16 checkpoint only. Never opens user data.
import { harness } from "../tests/support/harness.js";
import { upgrades } from "../src/migrations.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const root = resolve("tests/fixtures/migrations");
if (Math.max(...upgrades.map((v) => v.version)) !== 16)
  throw Error(
    "Archival generator requires schema-16 code; use the committed checkpoint to reproduce",
  );
mkdirSync(root, { recursive: true });
for (const version of [13, 14, 15]) {
  const target = resolve(root, "synthetic-schema-" + version + ".sqlite");
  if (existsSync(target))
    throw Error("Frozen fixture already exists; do not overwrite");
  const h = await harness();
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      path = "/cases/" + id;
    const uploaded = await h.call(
      path + "/documents",
      {
        mime: "text/plain",
        base64: Buffer.from(
          "Reference: PHASE12-TEST\nDeposit Amount: INR 125000\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssue Date: 2026-01-01\nMaturity Date: 2031-01-01",
        ).toString("base64"),
      },
      a,
    );
    if (
      uploaded.status !== 201 ||
      (await h.call(path + "/process", {}, a)).status !== 200
    )
      throw Error("Synthetic source generation failed");
    const db = h.app.db;
    db.exec(
      "DELETE FROM sessions;DROP TABLE clearance_events;DELETE FROM schema_migrations WHERE version=16",
    );
    if (version <= 14)
      db.exec(
        "DROP TABLE reminder_deliveries;ALTER TABLE reminder_preferences DROP COLUMN categories;DELETE FROM schema_migrations WHERE version=15",
      );
    if (version === 13)
      db.exec(
        "DROP TRIGGER continuity_instrument_revision;DROP TRIGGER continuity_link_revision;DROP TABLE continuity_events;DROP TABLE reminder_preferences;DELETE FROM schema_migrations WHERE version=14",
      );
    if (version >= 14) {
      if (version === 14)
        db.prepare(
          "INSERT INTO reminder_preferences(user_id,case_id,windows,enabled,revision) VALUES(?,?,?,1,1)",
        ).run("a", id, "[7]");
      else
        db.prepare(
          "INSERT INTO reminder_preferences(user_id,case_id,windows,enabled,revision,categories) VALUES(?,?,?,1,1,?)",
        ).run("a", id, "[7]", '["maturity","clarification"]');
      const instrumentId = db.prepare("SELECT id FROM instruments").get().id;
      db.prepare(
        "INSERT INTO case_notifications VALUES(?,?,?,?,?,?,?,NULL)",
      ).run(
        randomUUID(),
        "a",
        id,
        "maturity_reminder",
        ["reminder", id, instrumentId, "2031-01-01", 7].join(":"),
        "Historical synthetic notification preserved",
        "2030-12-26T00:00:00.000Z",
      );
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw Error("Fixture foreign key failure");
    db.prepare("VACUUM INTO ?").run(target);
    const bytes = readFileSync(target);
    writeFileSync(
      target + ".json",
      JSON.stringify(
        {
          classification: "SYNTHETIC_TEST_ONLY",
          schemaVersion: version,
          generatorCheckpoint: "ca4eb76",
          containsRealData: false,
          sessions: 0,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sourceText:
            "Synthetic PHASE12-TEST text deposit; bytes represented by immutable source hashes. Not an authentic deposit.",
          preservedTables: [
            "cases",
            "evidence",
            "document_versions",
            "case_notifications",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    console.log("Frozen synthetic schema " + version);
  } finally {
    await h.close();
  }
}
