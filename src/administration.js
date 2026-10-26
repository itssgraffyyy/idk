import { randomUUID, randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { isInstitution, canReadCase, requireRole } from "./permissions.js";
import { validate } from "./engine.js";
import { paginate } from "./pagination.js";
const derive = promisify(scrypt),
  bad = (s, m) => {
    throw Object.assign(Error(m), { status: s });
  };
export function text(value, name, max = 150) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    bad(400, "Invalid " + name);
  return value.trim();
}
export function date(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    bad(400, "Invalid date");
  return value;
}
function own(user) {
  if (!isInstitution(user)) bad(403, "Institution role required");
}
export function attachCase(db, c, body) {
  if (!body.obligationId && !body.instrumentId) return;
  const link = db
    .prepare("SELECT * FROM case_domains WHERE case_id=?")
    .get(c.id);
  let instrument = body.instrumentId
    ? db
        .prepare("SELECT * FROM instruments WHERE id=? AND tenant=?")
        .get(body.instrumentId, c.tenant)
    : null;
  if (body.instrumentId && !instrument) bad(404, "Instrument not found");
  const obligation = db
    .prepare("SELECT * FROM obligations WHERE id=? AND tenant=?")
    .get(body.obligationId || instrument?.obligation_id, c.tenant);
  if (!obligation || (instrument && instrument.obligation_id !== obligation.id))
    bad(404, "Obligation/instrument relationship not found");
  if (!instrument) {
    db.prepare("UPDATE instruments SET obligation_id=? WHERE id=?").run(
      obligation.id,
      link.instrument_id,
    );
    instrument = db
      .prepare("SELECT * FROM instruments WHERE id=?")
      .get(link.instrument_id);
  }
  db.prepare(
    "UPDATE case_domains SET obligation_id=?,instrument_id=? WHERE case_id=?",
  ).run(obligation.id, instrument.id, c.id);
  db.prepare("DELETE FROM case_instruments WHERE case_id=?").run(c.id);
  db.prepare("INSERT INTO case_instruments VALUES(?,?)").run(
    c.id,
    instrument.id,
  );
  db.prepare("UPDATE cases SET obligation=?,instrument=? WHERE id=?").run(
    JSON.stringify({ amountPaise: obligation.amount_paise }),
    instrument.data,
    c.id,
  );
  if (instrument.id !== link.instrument_id)
    db.prepare("DELETE FROM instruments WHERE id=?").run(link.instrument_id);
  db.prepare("DELETE FROM obligations WHERE id=?").run(link.obligation_id);
}
export async function administration({
  db,
  u,
  path,
  body,
  method,
  tx,
  audit,
  evidence,
  refresh,
  json,
  res,
  revalidate,
  url,
  cursorKey,
}) {
  if (path === "/api/accounts") {
    requireRole(u, ["institution_admin", "supervisor"]);
    if (method === "GET") {
      const page = paginate(db, {
        table: "users t",
        where: "t.tenant=?",
        params: [u.tenant],
        url,
        scope: u.id + "|accounts",
        key: cursorKey,
      });
      res.setHeader("X-Next-Cursor", page.nextCursor || "");
      json(
        res,
        200,
        page.items.map(({ id, email, role, status }) => ({
          id,
          email,
          role,
          status,
        })),
      );
      return true;
    }
    if (method !== "POST") bad(405, "Method not allowed");
    const allowed =
      u.role === "institution_admin"
        ? ["institution", "institution_admin"]
        : ["officer", "supervisor", "audit_reviewer"];
    if (body.id) {
      const target = db
        .prepare("SELECT id,role,status FROM users WHERE id=? AND tenant=?")
        .get(body.id, u.tenant);
      if (!target || !allowed.includes(target.role))
        bad(404, "Account not found");
      if (target.id === u.id)
        bad(409, "Cannot change your own privileged account");
      const role = body.role || target.role,
        status = body.status || target.status;
      if (!allowed.includes(role) || !["active", "disabled"].includes(status))
        bad(400, "Invalid account permission/status");
      if (!body.reason?.trim()) bad(400, "Reason required");
      tx(() => {
        db.prepare("UPDATE users SET role=?,status=? WHERE id=?").run(
          role,
          status,
          target.id,
        );
        audit(u.id, "account_updated", null, {
          targetId: target.id,
          before: target,
          after: { role, status },
          reason: body.reason,
        });
      });
      json(res, 200, { id: target.id, role, status });
      return true;
    }
    const email = text(body.email, "email", 254);
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !allowed.includes(body.role) ||
      typeof body.password !== "string" ||
      body.password.length < 12 ||
      body.password.length > 200
    )
      bad(
        400,
        "Valid email, permitted role and 12–200 character password required",
      );
    const salt = randomBytes(16).toString("hex"),
      digest = await derive(body.password, salt, 64);
    revalidate();
    const id = randomUUID();
    tx(() => {
      try {
        db.prepare(
          "INSERT INTO users(id,email,password,role,tenant) VALUES(?,?,?,?,?)",
        ).run(
          id,
          email,
          salt + ":" + digest.toString("hex"),
          body.role,
          u.tenant,
        );
      } catch {
        bad(409, "Account already exists or is invalid");
      }
      audit(u.id, "account_created", null, { targetId: id, role: body.role });
    });
    json(res, 201, { id, email, role: body.role });
    return true;
  }
  if (path === "/api/institution" && method === "POST") {
    own(u);
    const name = text(body.name, "name"),
      programmes = body.programmes || [],
      approvals = body.approvals || [];
    if (
      !Array.isArray(programmes) ||
      programmes.length > 50 ||
      !Array.isArray(approvals) ||
      approvals.length > 100
    )
      bad(400, "Bounded programme and approval lists required");
    const profile = {
      classification: text(body.classification, "classification"),
      programmes: programmes.map((p) => ({
        programme: text(p.programme, "programme"),
        level: text(p.level, "level"),
      })),
      approvals: approvals.map((p) => ({
        reference: text(p.reference, "approval reference"),
        date: date(p.date),
        status: text(p.status, "approval status"),
      })),
    };
    tx(() => {
      const old = db
        .prepare("SELECT * FROM institution_profiles WHERE tenant=?")
        .get(u.tenant);
      if (body.revision !== (old?.revision || 0))
        bad(409, "Stale institution profile");
      db.prepare("INSERT OR IGNORE INTO institutions VALUES(?,?,?)").run(
        u.tenant,
        name,
        new Date().toISOString(),
      );
      db.prepare("UPDATE institutions SET name=? WHERE tenant=?").run(
        name,
        u.tenant,
      );
      db.prepare(
        "INSERT INTO institution_profiles VALUES(?,?,?) ON CONFLICT(tenant) DO UPDATE SET data=excluded.data,revision=institution_profiles.revision+1",
      ).run(u.tenant, JSON.stringify(profile), 1);
      audit(u.id, "institution_updated", null, {
        tenant: u.tenant,
        before: old ? JSON.parse(old.data) : null,
        after: profile,
      });
      for (const c of db
        .prepare("SELECT * FROM cases WHERE tenant=?")
        .iterate(u.tenant)) {
        evidence(u.id, c.id, "profile_reference", {
          profileRevision: (old?.revision || 0) + 1,
        });
        refresh(u.id, c);
      }
    });
    json(res, 200, { ok: true });
    return true;
  }
  const om = path.match(/^\/api\/obligations(?:\/([A-Za-z0-9-]{1,100}))?$/);
  if (om) {
    const id = om[1],
      existing = id
        ? db.prepare("SELECT * FROM obligations WHERE id=?").get(id)
        : null;
    if (method === "GET") {
      if (!id) {
        const where = isInstitution(u)
          ? "t.tenant=?"
          : u.role === "officer"
            ? "EXISTS(SELECT 1 FROM case_domains d JOIN cases c ON c.id=d.case_id WHERE d.obligation_id=t.id AND c.assigned=?)"
            : "EXISTS(SELECT 1 FROM case_domains d JOIN cases c ON c.id=d.case_id JOIN users a ON a.id=c.assigned WHERE d.obligation_id=t.id AND a.tenant=?)";
        const page = paginate(db, {
          table: "obligations t",
          where,
          params: [u.role === "officer" ? u.id : u.tenant],
          url,
          scope: u.id + "|" + u.role + "|obligations",
          key: cursorKey,
        });
        res.setHeader("X-Next-Cursor", page.nextCursor || "");
        json(res, 200, page.items);
        return true;
      }
      let rows = id
        ? existing
          ? [existing]
          : []
        : db
            .prepare(
              "SELECT * FROM obligations WHERE tenant=? ORDER BY id LIMIT 100",
            )
            .all(u.tenant);
      rows = rows.filter((o) =>
        isInstitution(u)
          ? o.tenant === u.tenant
          : db
              .prepare(
                "SELECT c.* FROM cases c JOIN case_domains d ON d.case_id=c.id WHERE d.obligation_id=?",
              )
              .all(o.id)
              .some((c) => canReadCase(db, u, c)),
      );
      if (id && !rows.length) bad(404, "Obligation not found");
      json(res, 200, id ? rows[0] : rows);
      return true;
    }
    if (method !== "POST") bad(405, "Method not allowed");
    own(u);
    if (id && (!existing || existing.tenant !== u.tenant))
      bad(404, "Obligation not found");
    const amount = body.amountPaise;
    if (!Number.isSafeInteger(amount) || amount <= 0)
      bad(400, "Positive integer amountPaise required");
    const data = {
      programme: text(body.programme, "programme"),
      level: text(body.level, "level"),
      policyVersion: text(body.policyVersion, "policy version"),
      starts: date(body.starts),
      ends: date(body.ends),
      exemption: body.exemption
        ? text(body.exemption, "exemption", 2000)
        : null,
      status: body.status || "registered",
    };
    if (
      data.ends < data.starts ||
      !["registered", "requires_review", "exemption_claimed"].includes(
        data.status,
      )
    )
      bad(400, "Invalid obligation period/status");
    const oid = id || randomUUID();
    tx(() => {
      if (existing && body.revision !== existing.revision)
        bad(409, "Stale obligation");
      db.prepare("INSERT OR IGNORE INTO institutions VALUES(?,?,?)").run(
        u.tenant,
        "Institution profile pending",
        new Date().toISOString(),
      );
      if (existing)
        db.prepare(
          "UPDATE obligations SET amount_paise=?,programme=?,level=?,policy_version=?,starts=?,ends=?,exemption=?,status=?,revision=revision+1 WHERE id=?",
        ).run(
          amount,
          data.programme,
          data.level,
          data.policyVersion,
          data.starts,
          data.ends,
          data.exemption,
          data.status,
          oid,
        );
      else
        db.prepare(
          "INSERT INTO obligations(id,tenant,amount_paise,programme,level,policy_version,starts,ends,exemption,status) VALUES(?,?,?,?,?,?,?,?,?,?)",
        ).run(
          oid,
          u.tenant,
          amount,
          data.programme,
          data.level,
          data.policyVersion,
          data.starts,
          data.ends,
          data.exemption,
          data.status,
        );
      audit(u.id, "obligation_saved", null, {
        id: oid,
        before: existing,
        after: { ...data, amountPaise: amount },
      });
      for (const c of db
        .prepare(
          "SELECT c.* FROM cases c JOIN case_domains d ON c.id=d.case_id WHERE d.obligation_id=?",
        )
        .all(oid)) {
        db.prepare(
          "UPDATE cases SET obligation=?,revision=revision+1 WHERE id=?",
        ).run(JSON.stringify({ amountPaise: amount }), c.id);
        evidence(u.id, c.id, "obligation_revision", {
          obligationId: oid,
          ...data,
          amountPaise: amount,
        });
        refresh(u.id, db.prepare("SELECT * FROM cases WHERE id=?").get(c.id));
      }
    });
    json(
      res,
      existing ? 200 : 201,
      db.prepare("SELECT * FROM obligations WHERE id=?").get(oid),
    );
    return true;
  }
  return false;
}
export function addInstrument(db, u, c, body) {
  own(u);
  let data;
  try {
    data = validate(body.instrument);
  } catch (e) {
    bad(400, e.message);
  }
  const obligation = db
      .prepare("SELECT obligation_id FROM case_domains WHERE case_id=?")
      .get(c.id),
    id = randomUUID();
  if (!data.type || !data.currency || !data.branch)
    bad(400, "Type, currency and branch required for a new domain instrument");
  db.prepare(
    "INSERT INTO instruments(id,tenant,obligation_id,data) VALUES(?,?,?,?)",
  ).run(id, c.tenant, obligation.obligation_id, JSON.stringify(data));
  db.prepare("INSERT INTO case_instruments VALUES(?,?)").run(c.id, id);
  return { id, data };
}
