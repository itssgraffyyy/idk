import { randomUUID } from "node:crypto";
import { validate } from "./engine.js";
import { attachCase } from "./administration.js";
export function createCaseRecord(
  db,
  u,
  body,
  { evidence, audit, refresh },
  id = randomUUID(),
) {
  let instrument;
  try {
    instrument = validate(body.instrument);
  } catch (e) {
    throw Object.assign(e, { status: 400 });
  }
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > 150 ||
    !Number.isSafeInteger(body.obligation?.amountPaise) ||
    body.obligation.amountPaise <= 0
  )
    throw Object.assign(Error("Name and positive obligation required"), {
      status: 400,
    });
  const officer = db
    .prepare(
      "SELECT id FROM users WHERE role='officer' AND status='active' ORDER BY id LIMIT 1",
    )
    .get();
  if (!officer)
    throw Object.assign(Error("No officer configured"), { status: 503 });
  db.prepare("INSERT OR IGNORE INTO institutions VALUES(?,?,?)").run(
    u.tenant,
    body.name,
    new Date().toISOString(),
  );
  db.prepare("INSERT INTO cases VALUES(?,?,?,?,?,?,1)").run(
    id,
    u.tenant,
    officer.id,
    body.name,
    JSON.stringify({ amountPaise: body.obligation.amountPaise }),
    JSON.stringify(instrument),
  );
  attachCase(db, db.prepare("SELECT * FROM cases WHERE id=?").get(id), body);
  evidence(
    u.id,
    id,
    "declaration",
    JSON.parse(
      db.prepare("SELECT instrument FROM cases WHERE id=?").get(id).instrument,
    ),
  );
  audit(u.id, "case_created", id);
  refresh(u.id, db.prepare("SELECT * FROM cases WHERE id=?").get(id));
  return id;
}
