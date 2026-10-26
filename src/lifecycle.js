import { paginate } from "./pagination.js";
import { indiaCivilDate } from "./reminders.js";
const reject = (status, message) => {
  throw Object.assign(Error(message), { status });
};
export function lifecycleRoute({
  db,
  c,
  u,
  action,
  method,
  url,
  key,
  json,
  res,
}) {
  if (method !== "GET") return false;
  if (action === "lifecycle/timeline") {
    const page = paginate(db, {
      table: "audit t",
      where:
        "t.case_id=? AND t.action NOT IN ('document_read','document_preview','viewer_read','continuity_read','notification_read','access_denied')",
      params: [c.id],
      url,
      scope: u.id + "|" + u.role + "|lifecycle|" + c.id,
      key,
      descending: true,
    });
    json(res, 200, {
      ...page,
      items: page.items.map((r) => {
        const p = JSON.parse(r.payload || "{}");
        const evidence = p.evidenceId
          ? db
              .prepare(
                "SELECT id,kind,created FROM evidence WHERE id=? AND case_id=?",
              )
              .get(p.evidenceId, c.id)
          : null;
        return {
          id: r.id,
          sequence: r.sequence,
          created: r.created,
          actor: r.actor,
          action: r.action,
          outcome: r.outcome,
          evidence: evidence || null,
          proposalId: p.proposalId || null,
          meaning:
            "Recorded application event; external confirmation is separate",
        };
      }),
    });
    return true;
  }
  if (action !== "lifecycle") return false;
  const asOf = url.searchParams.get("asOf") || indiaCivilDate(),
    at = Date.parse(asOf);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(at) ||
    new Date(at).toISOString().slice(0, 10) !== asOf
  )
    reject(400, "Valid civil asOf date required");
  const rows = db
    .prepare(
      "SELECT i.* FROM instruments i JOIN case_instruments ci ON ci.instrument_id=i.id WHERE ci.case_id=? ORDER BY i.id LIMIT 501",
    )
    .all(c.id);
  if (rows.length > 500)
    reject(400, "Lifecycle summary supports at most 500 instruments");
  const instruments = rows.map((r) => {
    const data = JSON.parse(r.data);
    const document = db
      .prepare(
        "SELECT v.* FROM document_versions v JOIN documents d ON d.id=v.document_id JOIN document_instruments di ON di.document_id=d.id JOIN evidence e ON e.id=v.id WHERE d.case_id=? AND d.kind='fdr' AND di.instrument_id=? ORDER BY e.rowid DESC LIMIT 1",
      )
      .get(c.id, r.id);
    const extraction = document
      ? db
          .prepare(
            "SELECT id,payload FROM evidence WHERE case_id=? AND kind='extraction' AND json_extract(payload,'$.documentId')=? ORDER BY rowid DESC LIMIT 1",
          )
          .get(c.id, document.id)
      : null;
    const p = extraction ? JSON.parse(extraction.payload) : null,
      amount = p?.fields?.amountPaise;
    const observation = !document
      ? "DECLARATION_ONLY"
      : !p ||
          p.status !== "completed" ||
          !Number.isSafeInteger(amount?.value) ||
          amount.status === "REQUIRES_REVIEW"
        ? "DOCUMENT_AMOUNT_REQUIRES_REVIEW"
        : amount.value === data.amountPaise
          ? "DOCUMENT_AMOUNT_MATCHES_DECLARATION"
          : "DOCUMENT_AMOUNT_CONFLICT";
    const maturity = Date.parse(data.matures),
      days = Number.isFinite(maturity) ? (maturity - at) / 86400000 : null;
    return {
      id: r.id,
      revision: r.revision,
      recordState: r.status,
      bankVerification: r.verification,
      data,
      declaredDateState:
        days === null
          ? "UNKNOWN"
          : days < 0
            ? "DECLARED_MATURITY_PASSED"
            : days <= 90
              ? "DECLARED_MATURITY_WITHIN_90_DAYS"
              : "DECLARED_FUTURE_MATURITY",
      amountObservation: observation,
      amountEvidence: amount
        ? {
            ...amount,
            extractionId: extraction.id,
            documentVersionId: document.id,
            documentSHA256: document.sha256,
            extractionMethod: p.method,
          }
        : null,
      documentVersionId: document?.id || null,
      documentSHA256: document?.sha256 || null,
      limitation:
        "Matching extracted amount does not confirm holder, pledge, bank authenticity or legal coverage",
    };
  });
  const domain = db
    .prepare("SELECT * FROM case_domains WHERE case_id=?")
    .get(c.id);
  json(res, 200, {
    asOf,
    dateBasis: "Asia/Kolkata civil date",
    instruments,
    obligation: db
      .prepare("SELECT * FROM obligations WHERE id=?")
      .get(domain.obligation_id),
    administrative: db
      .prepare("SELECT * FROM case_operations WHERE case_id=?")
      .get(c.id),
    release: { status: "NOT_CONFIRMED", bankReleaseCompleted: false },
    legalCoverage: "REQUIRES_HUMAN_REVIEW",
    note: "Issue/maturity dates are declared facts; recorded application events have separate timestamps. Maturity never closes the obligation.",
  });
  return true;
}
