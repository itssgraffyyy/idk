/** @typedef {'institution'|'institution_admin'|'officer'|'supervisor'|'audit_reviewer'} Role */
/** @typedef {{reference:string,amountPaise:number,bank:string,ifsc:string,issued:string,matures:string,type?:'FDR'|'TERM_DEPOSIT',currency?:'INR',branch?:string,institutionName?:string,depositor?:string}} Instrument */
export function validateEnvelope(body) {
  const bad = () => {
    throw Object.assign(Error("Invalid request contract"), { status: 400 });
  };
  if (!body || typeof body !== "object" || Array.isArray(body)) bad();
  for (const k of [
    "id",
    "kind",
    "title",
    "classification",
    "mime",
    "name",
    "extractionId",
    "evaluationId",
    "reason",
    "action",
    "documentId",
    "instrumentId",
    "obligationId",
    "contextId",
    "officerId",
    "scenario",
    "asOf",
  ])
    if (
      body[k] !== undefined &&
      (typeof body[k] !== "string" || body[k].length > 2000)
    )
      bad();
  if (body.background !== undefined && typeof body.background !== "boolean")
    bad();
  if (
    body.revision !== undefined &&
    (!Number.isSafeInteger(body.revision) || body.revision < 0)
  )
    bad();
  for (const k of ["policies", "verifiedSourceHashes", "issuerConfirmed"])
    if (k in body)
      throw Object.assign(
        Error(
          "Policy activation is restricted to trusted operator configuration",
        ),
        { status: 403 },
      );
  return body;
}
