import { randomUUID } from "node:crypto";
import {
  evidenceRelationships,
  currentLegalClaim,
} from "./evidence-relationships.js";
import { scenarioSnapshot, runScenario } from "./scenario-analysis.js";
import { snapshotHash } from "./clearance-procedure.js";
import { paginate } from "./pagination.js";
import { text } from "./administration.js";
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
export function analysisRoute({
  db,
  c,
  u,
  action,
  method,
  body,
  url,
  res,
  json,
  tx,
  audit,
  key,
  capsule,
  clearances,
}) {
  const send = (value, status = 200) => {
    json(res, status, value);
    return true;
  };
  if (action === "relationships" && method === "GET") {
    const value = evidenceRelationships(db, u, c);
    audit(u.id, "relationships_read", c.id, {
      nodes: value.nodes.length,
      signals: value.signals.length,
    });
    return send(value);
  }
  if (action === "legal-entity" && method === "GET")
    return send(currentLegalClaim(db, c.tenant) || { revision: 0 });
  if (action === "legal-entity" && method === "POST") {
    if (u.role !== "institution_admin" || u.tenant !== c.tenant)
      fail(403, "Institution administrator required");
    if (
      Object.keys(body).some(
        (k) =>
          ![
            "revision",
            "name",
            "jurisdiction",
            "registration",
            "sourceReference",
          ].includes(k),
      )
    )
      fail(400, "Unsupported legal claim fields");
    const payload = {
      name: text(body.name, "legal entity"),
      jurisdiction: text(body.jurisdiction, "jurisdiction"),
      registration: text(body.registration, "registration"),
      sourceReference: text(body.sourceReference, "declaration reference", 500),
      classification: "INSTITUTION_DECLARED_UNVERIFIED",
    };
    const result = tx(() => {
      const old = currentLegalClaim(db, c.tenant);
      if (body.revision !== (old?.revision || 0))
        fail(409, "Legal declaration changed");
      const id = randomUUID();
      db.prepare("INSERT INTO legal_entity_claims VALUES(?,?,?,?,?,?,?)").run(
        id,
        c.tenant,
        body.revision + 1,
        old?.id || null,
        JSON.stringify(payload),
        u.id,
        new Date().toISOString(),
      );
      audit(u.id, "legal_entity_declared", c.id, {
        claimId: id,
        previous: old?.id || null,
        sha256: snapshotHash(payload),
      });
      return currentLegalClaim(db, c.tenant);
    });
    return send(result, 201);
  }
  if (!action?.startsWith("analysis")) return false;
  const load = (id, kind) => {
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      fail(400, "Valid analysis record ID required");
    const r = db
      .prepare("SELECT * FROM analysis_records WHERE id=? AND case_id=?")
      .get(id, c.id);
    if (!r || (kind && r.kind !== kind)) fail(404, "Analysis record not found");
    const payload = JSON.parse(r.payload);
    if (snapshotHash(payload) !== r.sha256)
      fail(409, "Analysis record integrity failure");
    return { ...r, payload };
  };
  const save = (kind, payload, base = null) => {
    const id = randomUUID(),
      sha256 = snapshotHash(payload);
    db.prepare("INSERT INTO analysis_records VALUES(?,?,?,?,?,?,?,?)").run(
      id,
      c.id,
      kind,
      base,
      JSON.stringify(payload),
      sha256,
      u.id,
      new Date().toISOString(),
    );
    audit(u.id, "analysis_" + kind + "_created", c.id, {
      id,
      baseId: base,
      sha256,
    });
    return load(id, kind);
  };
  if (action === "analysis/snapshots" && method === "POST")
    return send(
      tx(() => {
        const input = db
          .prepare("SELECT input_revision FROM case_operations WHERE case_id=?")
          .get(c.id).input_revision;
        if (body.inputRevision !== input)
          fail(409, "Case inputs changed; reload before freezing analysis");
        if (Object.keys(body).some((k) => k !== "inputRevision"))
          fail(400, "Unsupported snapshot fields");
        return save(
          "snapshot",
          scenarioSnapshot(db, c, capsule, clearances, u),
        );
      }),
      201,
    );
  if (action === "analysis/scenarios" && method === "POST")
    return send(
      tx(() => {
        if (
          Object.keys(body).some((k) => !["snapshotId", "changes"].includes(k))
        )
          fail(400, "Unsupported scenario request");
        const base = load(body.snapshotId, "snapshot");
        return save(
          "scenario",
          {
            baseSHA256: base.sha256,
            result: runScenario(base.payload, body.changes),
          },
          base.id,
        );
      }),
      201,
    );
  if (action === "analysis/history" && method === "GET") {
    const page = paginate(db, {
      table: "analysis_records t",
      where: "t.case_id=?",
      params: [c.id],
      url,
      scope: u.id + "|" + u.role + "|analysis|" + c.id,
      key,
      descending: true,
    });
    page.items = page.items.map(({ payload, ...r }) => r);
    return send(page);
  }
  const m = action.match(/^analysis\/records\/([a-f0-9-]{36})(\/replay)?$/);
  if (m && method === "GET") {
    const row = load(m[1]);
    if (m[2]) {
      if (row.kind !== "scenario") fail(400, "Only scenarios can be replayed");
      const base = load(row.base_id, "snapshot");
      if (row.payload.baseSHA256 !== base.sha256)
        fail(409, "Analysis base integrity failure");
      const result = runScenario(base.payload, row.payload.result.changes);
      if (snapshotHash(result) !== snapshotHash(row.payload.result))
        fail(
          409,
          "Analysis evaluator changed; recorded result retained, exact replay unavailable",
        );
      audit(u.id, "analysis_replayed", c.id, {
        id: row.id,
        sha256: row.sha256,
      });
      return send({ id: row.id, reproduced: true, result });
    }
    audit(u.id, "analysis_read", c.id, { id: row.id, sha256: row.sha256 });
    return send(row);
  }
  return false;
}
