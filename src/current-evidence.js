export function decodeEvidence(e) {
  return e ? { ...e, payload: JSON.parse(e.payload) } : null;
}
export function currentEvidence(db, id) {
  const base = db
    .prepare(
      "SELECT rowid AS sequence,* FROM evidence WHERE rowid IN (SELECT max(rowid) FROM evidence WHERE case_id=? GROUP BY kind) ORDER BY rowid",
    )
    .all(id)
    .map(decodeEvidence);
  const doc = latestFDR(db, id),
    instrument = db
      .prepare("SELECT instrument_id FROM case_domains WHERE case_id=?")
      .get(id)?.instrument_id;
  const extraction = doc
    ? db
        .prepare(
          "SELECT rowid AS sequence,* FROM evidence WHERE case_id=? AND kind='extraction' AND json_extract(payload,'$.documentId')=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(id, doc.id)
    : null;
  const external = db
    .prepare(
      "SELECT rowid AS sequence,* FROM evidence WHERE case_id=? AND kind='external' AND coalesce(json_extract(payload,'$.instrumentId'),'instrument-'||case_id)=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(id, instrument);
  return [
    ...base.filter(
      (e) => !["document", "extraction", "external"].includes(e.kind),
    ),
    doc
      ? {
          ...decodeEvidence(doc),
          sequence: db
            .prepare("SELECT rowid n FROM evidence WHERE id=?")
            .get(doc.id).n,
        }
      : null,
    decodeEvidence(extraction),
    decodeEvidence(external),
  ]
    .filter(Boolean)
    .sort((a, b) => a.sequence - b.sequence);
}
export function currentProofs(db, id, contextId) {
  if (!contextId) return [];
  return db
    .prepare(
      `WITH latest AS(SELECT id,payload,rowid,row_number() OVER(PARTITION BY json_extract(payload,'$.documentId'),json_extract(payload,'$.type') ORDER BY rowid DESC) n FROM evidence WHERE case_id=? AND kind='proof_review' AND json_extract(payload,'$.contextId')=?), accepted AS(SELECT id,payload,row_number() OVER(PARTITION BY json_extract(payload,'$.type') ORDER BY rowid DESC) n FROM latest WHERE n=1 AND json_extract(payload,'$.decision')='accepted') SELECT id,payload FROM accepted WHERE n=1 LIMIT 20`,
    )
    .all(id, contextId)
    .map((e) => ({ ...JSON.parse(e.payload), reviewId: e.id }));
}
import { latestFDR } from "./domain.js";
