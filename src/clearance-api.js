import { paginate } from "./pagination.js";
import { hash } from "./store.js";
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
export function clearanceRoutes({
  service,
  db,
  u,
  path,
  method,
  body,
  url,
  tx,
  json,
  res,
  storage,
  audit,
  key,
  revalidate,
}) {
  if (!path.startsWith("/api/clearance")) return false;
  const send = (value, status = 200) => {
    json(res, status, value);
    return true;
  };
  if (path === "/api/clearance/configuration" && method === "GET")
    return send(service.configurations(u));
  if (path === "/api/clearance/activations" && method === "POST")
    return send(
      tx(() => service.activate(u, body)),
      201,
    );
  if (path === "/api/clearance/grants" && method === "POST")
    return send(
      tx(() => service.setGrant(u, body)),
      201,
    );
  if (path === "/api/clearance/queue" && method === "GET") {
    if (!["officer", "supervisor"].includes(u.role))
      fail(403, "Department reviewer permission required");
    const page = paginate(db, {
      table: "clearance_events t",
      where:
        "t.authority=? AND t.kind='request' AND json_extract(t.payload,'$.reviewer')=? AND t.rowid=(SELECT max(v.rowid) FROM clearance_events v WHERE v.entity=t.entity)",
      params: [u.tenant, u.id],
      url,
      scope: u.id + "|" + u.role + "|department-queue",
      key,
      descending: true,
    });
    page.items = page.items.flatMap((r) => {
      try {
        const item = service.departmentRequest(u, r.entity);
        return [
          {
            entity: r.entity,
            revision: item.revision,
            requirementId: item.payload.requirementId,
            department: item.payload.department,
            status: item.payload.status,
            current: item.current,
            created: item.created,
          },
        ];
      } catch (e) {
        if (e.status === 404) return [];
        throw e;
      }
    });
    return send(page);
  }
  const request = path.match(
    /^\/api\/clearance\/requests\/([^/]+)(?:\/documents\/([a-f0-9-]{36}))?$/,
  );
  if (request) {
    const entity = decodeURIComponent(request[1]);
    if (method === "POST" && !request[2])
      return send(
        tx(() => service.respond(u, entity, body)),
        201,
      );
    if (method !== "GET") fail(404, "Not found");
    const r = service.departmentRequest(u, entity);
    if (request[2]) {
      if (!r.current)
        fail(409, "Request evidence is stale; request reassignment or refresh");
      const ref = r.payload.documents.find((d) => d.id === request[2]);
      if (!ref) fail(404, "Selected department document not found");
      const v = db
        .prepare("SELECT * FROM document_versions WHERE id=? AND sha256=?")
        .get(ref.id, ref.sha256);
      if (!v) fail(409, "Document version unavailable");
      const bytes = storage.read(v.storage_key);
      if (hash(bytes) !== v.sha256) fail(409, "Document integrity failure");
      revalidate();
      const after = service.departmentRequest(u, entity);
      if (after.id !== r.id || !after.current)
        fail(409, "Department request changed during document access");
      audit(u.id, "department_document_downloaded", r.case_id, {
        requestEventId: r.id,
        documentVersionId: v.id,
        sha256: v.sha256,
      });
      res.writeHead(200, {
        "Content-Type": v.mime,
        "Content-Disposition":
          'attachment; filename="department-source-' + v.id + '"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(bytes);
      return true;
    }
    return send({
      entity: r.entity,
      revision: r.revision,
      requirementId: r.payload.requirementId,
      department: r.payload.department,
      status: r.payload.status,
      current: r.current,
      message: r.payload.message,
      response: r.payload.response || null,
      documents: r.payload.documents,
      externalRelease: "NOT_CONFIRMED",
    });
  }
  const match = path.match(
    /^\/api\/clearance\/cases\/([a-f0-9-]{36})(?:\/(bind|requests|withdraw|proposals|confirm|close|reopen|history))?$/,
  );
  if (!match) fail(404, "Not found");
  const [, caseId, action] = match;
  if (method === "GET") {
    const r = service.readiness(u, caseId);
    if (action === "history") {
      if (!["officer", "supervisor", "audit_reviewer"].includes(u.role))
        fail(403, "Authority history permission required");
      return send(
        paginate(db, {
          table: "clearance_events t",
          where: "t.case_id=?",
          params: [caseId],
          url,
          scope: u.id + "|" + u.role + "|clearance-history|" + caseId,
          key,
          descending: true,
        }),
      );
    }
    if (action) fail(404, "Not found");
    if (["institution", "institution_admin"].includes(u.role)) {
      const {
        requests,
        proposals,
        reviewerOptions,
        snapshot,
        snapshotHash,
        ...summary
      } = r;
      return send(summary);
    }
    return send(r);
  }
  if (method !== "POST") fail(404, "Not found");
  const handlers = {
    bind: () => service.bind(u, caseId, body),
    requests: () => service.request(u, caseId, body),
    withdraw: () => service.withdraw(u, caseId, body.entity, body),
    proposals: () => service.propose(u, caseId, body),
    confirm: () => service.confirm(u, caseId, body.entity, body),
    close: () => service.close(u, caseId, body),
    reopen: () => service.reopen(u, caseId, body),
  };
  if (!handlers[action]) fail(404, "Not found");
  return send(tx(handlers[action]), 201);
}
