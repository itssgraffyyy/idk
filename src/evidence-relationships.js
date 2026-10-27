import { accessibleCases } from "./pagination.js";
import { snapshotHash } from "./clearance-procedure.js";
import { canReadCase } from "./permissions.js";
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const norm = (v) =>
  String(v || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
export function currentLegalClaim(db, tenant) {
  const r = db
    .prepare(
      "SELECT * FROM legal_entity_claims WHERE tenant=? ORDER BY revision DESC LIMIT 1",
    )
    .get(tenant);
  return r && { ...r, payload: JSON.parse(r.payload) };
}
export function legalIdentity(p) {
  return p && snapshotHash([norm(p.jurisdiction), norm(p.registration)]);
}
// Every cross-record query applies the existing full-case permission predicate.
// Neither similarity nor a self-declared sponsor confers additional access.
export function evidenceRelationships(db, user, root) {
  if (!canReadCase(db, user, root)) fail(404, "Case not found");
  const scope = accessibleCases(user);
  const cases = db
    .prepare(
      `SELECT c.* FROM cases c WHERE ${scope.where} ORDER BY c.id LIMIT 501`,
    )
    .all(...scope.params);
  if (cases.length > 500)
    fail(
      413,
      "Relationship scope exceeds 500 authorized cases; narrow assignment scope",
    );
  const instruments = db
    .prepare(
      `SELECT DISTINCT i.* FROM instruments i JOIN case_instruments ci ON ci.instrument_id=i.id JOIN cases c ON c.id=ci.case_id WHERE ${scope.where} ORDER BY i.id LIMIT 5001`,
    )
    .all(...scope.params);
  const versions = db
    .prepare(
      `SELECT v.id,v.document_id,v.version,v.sha256,d.case_id,d.title,d.kind FROM document_versions v JOIN documents d ON d.id=v.document_id JOIN cases c ON c.id=d.case_id WHERE ${scope.where} ORDER BY v.id LIMIT 5001`,
    )
    .all(...scope.params);
  if (instruments.length > 5000 || versions.length > 5000)
    fail(
      413,
      "Relationship scope exceeds 5000 instruments or versions; no partial analysis returned",
    );
  const evidence = db
    .prepare("SELECT * FROM evidence WHERE case_id=? ORDER BY rowid LIMIT 501")
    .all(root.id);
  const events = db
    .prepare(
      "SELECT id,kind,action,payload FROM clearance_events WHERE case_id=? ORDER BY rowid LIMIT 501",
    )
    .all(root.id);
  if (evidence.length > 500 || events.length > 500)
    fail(
      413,
      "Case history exceeds relationship analysis bound; use paginated evidence history",
    );
  const nodes = new Map(),
    links = [],
    signals = [];
  const node = (id, type, label, detail = {}) => {
    if (nodes.size >= 10000 && !nodes.has(id))
      fail(
        413,
        "Relationship view exceeds 10000 nodes; no partial analysis returned",
      );
    if (!nodes.has(id)) nodes.set(id, { id, type, label, ...detail });
    return id;
  };
  const edge = (from, to, relationship) => {
    if (links.length >= 10000)
      fail(
        413,
        "Relationship view exceeds 10000 links; no partial analysis returned",
      );
    links.push({ from, to, relationship });
  };
  const signal = (code, ids, explanation, severity = "MEDIUM") => {
    if (signals.length >= 10000)
      fail(
        413,
        "Relationship view exceeds 10000 signals; no partial analysis returned",
      );
    signals.push({
      code,
      severity,
      ids: [...new Set(ids)],
      explanation,
      classification: "REVIEW_SIGNAL_NOT_FRAUD",
    });
  };
  const rootNode = node(root.id, "case", root.name, { caseId: root.id });
  const instNode = node("institution:" + root.tenant, "institution", root.name);
  edge(rootNode, instNode, "submitted_by");
  const claim = currentLegalClaim(db, root.tenant);
  if (claim) {
    const key = legalIdentity(claim.payload),
      entity = node("legal:" + key, "legal_entity", claim.payload.name, {
        classification: "INSTITUTION_DECLARED_UNVERIFIED",
        claimId: claim.id,
        revision: claim.revision,
        sourceReference: claim.payload.sourceReference,
      });
    edge(instNode, entity, "declares_sponsor");
    for (const other of cases.filter((c) => c.tenant !== root.tenant)) {
      const otherClaim = currentLegalClaim(db, other.tenant);
      if (otherClaim && legalIdentity(otherClaim.payload) === key) {
        edge(
          node(other.id, "case", other.name, { caseId: other.id }),
          entity,
          "declares_same_legal_identity",
        );
        signal(
          "SHARED_DECLARED_SPONSOR",
          [root.id, other.id],
          "Matching declared jurisdiction/registration; legal identity has not been independently confirmed.",
        );
      }
    }
  }
  const profile = db
    .prepare("SELECT * FROM institution_profiles WHERE tenant=?")
    .get(root.tenant);
  if (profile) {
    const p = JSON.parse(profile.data);
    for (const [kind, rows] of [
      ["programme", p.programmes],
      ["approval", p.approvals],
    ])
      for (const [i, value] of (rows || []).entries())
        edge(
          instNode,
          node(
            kind + ":" + root.tenant + ":" + i,
            kind,
            JSON.stringify(value),
            {
              profileRevision: profile.revision,
              classification: "INSTITUTION_DECLARED",
            },
          ),
          "declares_" + kind,
        );
  }
  const link = db
    .prepare("SELECT * FROM case_domains WHERE case_id=?")
    .get(root.id);
  const obligation = db
    .prepare("SELECT * FROM obligations WHERE id=?")
    .get(link.obligation_id);
  edge(
    rootNode,
    node(
      obligation.id,
      "obligation",
      obligation.programme || "Security obligation",
      { revision: obligation.revision, amountPaise: obligation.amount_paise },
    ),
    "addresses",
  );
  const rootIds = new Set(
    db
      .prepare("SELECT instrument_id FROM case_instruments WHERE case_id=?")
      .all(root.id)
      .map((r) => r.instrument_id),
  );
  const facts = instruments.map((r) => ({ ...r, data: JSON.parse(r.data) }));
  const identity = (r) =>
    norm(r.data.ifsc).slice(0, 4) + "|" + norm(r.data.reference);
  const attach = (r) => {
    const id = node(r.id, "instrument", r.data.reference, {
      revision: r.revision,
      declared: r.data,
      classification: "INSTITUTION_DECLARED_UNCONFIRMED",
    });
    edge(
      id,
      node(
        "bank:" + norm(r.data.ifsc),
        "bank_reference",
        r.data.ifsc || "Missing IFSC",
        { classification: "IDENTIFIER_NOT_BANK_CONFIRMATION" },
      ),
      "declares_branch",
    );
    return id;
  };
  for (const r of facts.filter((r) => rootIds.has(r.id))) {
    edge(obligation.id, attach(r), "secured_by_declaration");
    for (const other of facts.filter(
      (x) => x.id !== r.id && identity(x) === identity(r),
    )) {
      attach(other);
      edge(r.id, other.id, "same_bank_code_and_reference");
      signal(
        "REPEATED_INSTRUMENT_IDENTIFIER",
        [r.id, other.id],
        "Matching declared bank code/reference may be legitimate repeated evidence.",
      );
      if (r.data.amountPaise !== other.data.amountPaise)
        signal(
          "CONFLICTING_AMOUNT",
          [r.id, other.id],
          "Same declared deposit identity has different amounts.",
          "HIGH",
        );
      if (
        norm(r.data.depositor) !== norm(other.data.depositor) ||
        norm(r.data.institutionName) !== norm(other.data.institutionName)
      )
        signal(
          "CONFLICTING_HOLDER",
          [r.id, other.id],
          "Same declared deposit identity has different or missing holder declarations.",
          "HIGH",
        );
      if (r.obligation_id !== other.obligation_id)
        signal(
          "RELATED_OBLIGATIONS",
          [r.id, other.id],
          "Same declared deposit identity appears under different obligations; never count it twice.",
          "HIGH",
        );
    }
    const related = db
      .prepare(
        `SELECT DISTINCT cd.obligation_id FROM case_instruments ci JOIN case_domains cd ON cd.case_id=ci.case_id JOIN cases c ON c.id=ci.case_id WHERE ci.instrument_id=? AND ${scope.where}`,
      )
      .all(r.id, ...scope.params);
    if (related.some((x) => x.obligation_id !== r.obligation_id))
      signal(
        "MULTIPLE_OBLIGATION_LINKS",
        [r.id],
        "Authorized case links disagree with the instrument obligation.",
        "HIGH",
      );
  }
  const rootVersions = versions.filter((v) => v.case_id === root.id);
  for (const v of rootVersions) {
    const logical = node(v.document_id, "document", v.title);
    edge(rootNode, logical, "contains");
    edge(
      logical,
      node(v.id, "document_version", "Version " + v.version, {
        sha256: v.sha256,
        documentId: v.id,
        caseId: root.id,
        version: v.version,
      }),
      "version",
    );
    for (const other of versions.filter(
      (o) => o.id !== v.id && o.sha256 === v.sha256,
    )) {
      node(other.id, "document_version", "Repeated source bytes", {
        sha256: other.sha256,
        caseId: other.case_id,
        documentId: other.id,
        version: other.version,
      });
      edge(v.id, other.id, "identical_bytes");
      signal(
        "REPEATED_DOCUMENT_BYTES",
        [v.id, other.id],
        "Identical bytes can be legitimate reuse; review context before drawing conclusions.",
      );
    }
    const preceding = rootVersions.find(
      (o) => o.document_id === v.document_id && o.version === v.version - 1,
    );
    if (v.version > 1 && !preceding)
      signal(
        "MISSING_VERSION_PREDECESSOR",
        [v.id],
        "Document version sequence has a missing predecessor.",
        "HIGH",
      );
  }
  const extractionVersions = new Map();
  for (const e of evidence) {
    const p = JSON.parse(e.payload),
      id = node(e.id, e.kind, e.kind, { caseId: root.id });
    edge(rootNode, id, "records");
    if (e.kind === "extraction") {
      const version = rootVersions.find((v) => v.id === p.documentId);
      if (version) {
        const list = extractionVersions.get(version.document_id) || [];
        list.push({
          extractionId: e.id,
          versionId: version.id,
          version: version.version,
          fields: p.fields || {},
        });
        extractionVersions.set(version.document_id, list);
      }
      if (p.documentId && nodes.has(p.documentId))
        edge(p.documentId, id, "extracted_as");
      for (const [key, value] of Object.entries(p.fields || {}))
        edge(
          id,
          node(e.id + ":" + key, "extracted_fact", key, {
            value,
            extractionId: e.id,
            documentId: p.documentId,
            caseId: root.id,
          }),
          "observes",
        );
    }
    if (["evaluation", "evaluation_replay"].includes(e.kind)) {
      for (const [i, f] of (p.findings || []).entries())
        edge(
          id,
          node(e.id + ":finding:" + i, "finding", f.code || f.message, {
            finding: f,
          }),
          "reports",
        );
      for (const [i, r] of (p.operationalPolicy?.checks || []).entries())
        edge(
          id,
          node(e.id + ":rule:" + i, "regulatory_rule", r.id || "Policy check", {
            rule: r,
            policyConfiguration: p.policyConfiguration,
          }),
          "evaluates",
        );
    }
  }
  for (const e of evidence) {
    const p = JSON.parse(e.payload);
    for (const [i, f] of (p.findings || []).entries())
      for (const source of f.sources || []) {
        if (source.evidenceId && nodes.has(source.evidenceId))
          edge(
            e.id + ":finding:" + i,
            source.evidenceId,
            "supported_by_source",
          );
      }
    for (const [key, ids] of Object.entries(p.sourceReferences || {}))
      for (const id of Array.isArray(ids) ? ids : [ids])
        if (typeof id === "string" && nodes.has(id))
          edge(e.id, id, "references_" + key);
  }
  for (const readings of extractionVersions.values()) {
    const latestByVersion = new Map(readings.map((r) => [r.version, r]));
    const ordered = [...latestByVersion.values()].sort(
      (a, b) => a.version - b.version,
    );
    for (let i = 1; i < ordered.length; i++) {
      const before = ordered[i - 1],
        after = ordered[i];
      for (const key of [
        "reference",
        "amountPaise",
        "depositor",
        "institutionName",
        "ifsc",
      ]) {
        const a = before.fields[key]?.value,
          b = after.fields[key]?.value;
        if (a !== undefined && b !== undefined && norm(a) !== norm(b))
          signal(
            "DOCUMENT_VERSION_FACT_CONFLICT",
            [before.extractionId, after.extractionId],
            "Different " +
              key +
              " readings across source versions " +
              before.version +
              " and " +
              after.version +
              "; corrections may be legitimate.",
            "HIGH",
          );
      }
    }
  }
  for (const e of events)
    edge(
      rootNode,
      node(e.id, "administrative_" + e.kind, e.action, {
        classification: "INTERNAL_ONLY",
        eventId: e.id,
      }),
      "administrative_history",
    );
  const visible = new Set(facts.map((r) => r.id));
  const relationships = db
    .prepare(
      "SELECT * FROM instrument_relationships WHERE predecessor IN (SELECT value FROM json_each(?)) AND successor IN (SELECT value FROM json_each(?)) ORDER BY successor LIMIT 5001",
    )
    .all(JSON.stringify([...visible]), JSON.stringify([...visible]));
  if (relationships.length > 5000)
    fail(413, "Relationship edge bound exceeded");
  const adjacency = new Map();
  for (const r of relationships)
    if (visible.has(r.predecessor) && visible.has(r.successor)) {
      const list = adjacency.get(r.predecessor) || [];
      list.push(r.successor);
      adjacency.set(r.predecessor, list);
      if (rootIds.has(r.predecessor) || rootIds.has(r.successor)) {
        const p = facts.find((i) => i.id === r.predecessor),
          s = facts.find((i) => i.id === r.successor);
        attach(p);
        attach(s);
        edge(p.id, s.id, "replaced_by");
        if (s.data.issued > p.data.matures || s.data.issued < p.data.issued)
          signal(
            "REPLACEMENT_TIMING_CONFLICT",
            [p.id, s.id],
            "Declared replacement interval leaves a gap or starts before its predecessor.",
            "HIGH",
          );
      }
    }
  // Iterative reachability is bounded by the authorized record set; no recursive UI traversal.
  for (const start of rootIds) {
    const pending = [...(adjacency.get(start) || [])],
      seen = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (id === start) {
        signal(
          "CYCLIC_REPLACEMENT",
          [start],
          "Replacement cycle requires repair.",
          "HIGH",
        );
        break;
      }
      if (!seen.has(id)) {
        seen.add(id);
        pending.push(...(adjacency.get(id) || []));
      }
    }
  }
  const dedup = (values) => [
    ...new Map(values.map((v) => [snapshotHash(v), v])).values(),
  ];
  return {
    classification: "AUTHORIZED_RELATIONSHIPS_REVIEW_ONLY",
    nodes: [...nodes.values()],
    links: dedup(links),
    signals: dedup(signals),
    limits: { cases: 500, instruments: 5000, versions: 5000, evidence: 500 },
    completeWithinAuthorizedScope: true,
  };
}
