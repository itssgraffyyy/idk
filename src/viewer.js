import { paginate } from "./pagination.js";
import { hash } from "./store.js";
import { documentScan } from "./upload-scanning.js";
export function viewerRoute({
  db,
  c,
  u,
  action,
  method,
  url,
  key,
  storage,
  json,
  res,
  audit,
}) {
  if (method !== "GET") return false;
  if (action === "viewer/versions") {
    const page = paginate(db, {
      table: "document_versions t",
      where:
        "EXISTS(SELECT 1 FROM documents d WHERE d.id=t.document_id AND d.case_id=?)",
      params: [c.id],
      url,
      scope: u.id + "|" + u.role + "|viewer|" + c.id,
      key,
      descending: true,
    });
    json(res, 200, page);
    return true;
  }
  const match = action?.match(/^viewer\/([a-f0-9-]{36})$/);
  if (!match) return false;
  const row = db
    .prepare(
      "SELECT v.*,d.kind,d.title,i.instrument_id FROM document_versions v JOIN documents d ON d.id=v.document_id JOIN document_instruments i ON i.document_id=d.id WHERE v.id=? AND d.case_id=?",
    )
    .get(match[1], c.id);
  if (!row)
    throw Object.assign(Error("Document version unavailable"), { status: 404 });
  if (hash(storage.read(row.storage_key)) !== row.sha256)
    throw Object.assign(Error("Document integrity failure"), { status: 409 });
  const extractions = db
    .prepare(
      "SELECT id,payload,created FROM evidence WHERE case_id=? AND kind='extraction' AND json_extract(payload,'$.documentId')=? ORDER BY rowid DESC LIMIT 50",
    )
    .all(c.id, row.id);
  const latest = extractions[0],
    original = db
      .prepare(
        "SELECT id,payload,created FROM evidence WHERE case_id=? AND kind='extraction' AND json_extract(payload,'$.documentId')=? AND json_extract(payload,'$.status')='completed' ORDER BY rowid LIMIT 1",
      )
      .get(c.id, row.id);
  const expose = (e) => {
    if (!e) return null;
    const p = JSON.parse(e.payload);
    let geometry = p.raw || p.geometry,
      previous = p.correctedFrom,
      count = 0;
    while (!geometry && previous && count++ < 50) {
      const ancestor = db
        .prepare(
          "SELECT payload FROM evidence WHERE id=? AND case_id=? AND kind='extraction' AND json_extract(payload,'$.documentId')=?",
        )
        .get(previous, c.id, row.id);
      if (!ancestor) break;
      const saved = JSON.parse(ancestor.payload);
      geometry = saved.raw || saved.geometry;
      previous = saved.correctedFrom;
    }
    const geometryUnavailable =
      !geometry &&
      p.method === "human-correction" &&
      Object.values(p.fields || {}).some((f) => f.bbox);
    return {
      id: e.id,
      created: e.created,
      method: p.method,
      status: p.status,
      fields: p.fields,
      rotation:
        geometry?.coordinateSpace === "source-raster-pixels"
          ? 0
          : geometry?.rotation || 0,
      recognitionRotation: geometry?.rotation || 0,
      geometryUnavailable,
      pages:
        p.raw?.pages?.map((v) => ({
          page: v.page,
          method: v.method,
          renderScale: v.renderScale,
        })) || [],
    };
  };
  const requestedExtraction = url.searchParams.get("extractionId");
  const recorded = requestedExtraction
    ? db
        .prepare(
          "SELECT id,payload,created FROM evidence WHERE id=? AND case_id=? AND kind='extraction' AND json_extract(payload,'$.documentId')=?",
        )
        .get(requestedExtraction, c.id, row.id)
    : null;
  if (requestedExtraction && !recorded)
    throw Object.assign(
      Error("Recorded extraction does not belong to this source version"),
      { status: 404 },
    );
  audit(u.id, "evidence_viewer_read", c.id, { documentVersionId: row.id });
  json(res, 200, {
    document: row,
    malwareScan: documentScan(db, row.id, row.sha256),
    latest: expose(latest),
    original: expose(original),
    recorded: expose(recorded),
    extractions: extractions.map((e) => ({
      id: e.id,
      created: e.created,
      status: JSON.parse(e.payload).status,
    })),
    sourceClassification: "DOCUMENT_EXTRACTION_NOT_BANK_AUTHENTICATION",
  });
  return true;
}
