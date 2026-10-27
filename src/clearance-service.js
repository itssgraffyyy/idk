import { randomUUID } from "node:crypto";
import { canReadCase, isReviewer } from "./permissions.js";
import { currentEvidence, currentProofs } from "./current-evidence.js";
import { evaluatePolicy } from "./policy-runtime.js";
import {
  clearanceReadiness,
  snapshotHash,
  validateProcedure,
} from "./clearance-procedure.js";
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const decode = (row) => row && { ...row, payload: JSON.parse(row.payload) };
const identifier = (v) =>
  typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v);
const reason = (v) => {
  if (typeof v !== "string" || !v.trim() || v.length > 2000)
    fail(400, "A reason of at most 2000 characters is required");
  return v.trim();
};
export function clearanceService({
  db,
  audit,
  procedures = [],
  policyConfig = {},
}) {
  const configured = procedures.map(validateProcedure);
  if (
    configured.length > 100 ||
    new Set(configured.map((p) => p.scope + "|" + p.version)).size !==
      configured.length
  )
    throw Error("Duplicate or excessive procedure configuration");
  const latest = (entity) =>
    decode(
      db
        .prepare(
          "SELECT * FROM clearance_events WHERE entity=? ORDER BY revision DESC LIMIT 1",
        )
        .get(entity),
    );
  const rows = (authority, kind, caseId = null) => {
    const out = db
      .prepare(
        "SELECT * FROM clearance_events WHERE authority=? AND kind=? AND case_id IS ? AND rowid IN (SELECT max(rowid) FROM clearance_events GROUP BY entity) ORDER BY rowid LIMIT 501",
      )
      .all(authority, kind, caseId)
      .map(decode);
    if (out.length > 500)
      fail(409, "Clearance collection exceeds synchronous assessment limit");
    return out;
  };
  const activeUser = (id) =>
    db
      .prepare(
        "SELECT id,role,tenant,status FROM users WHERE id=? AND status='active'",
      )
      .get(id);
  const authorize = (u, allowed) => {
    const current = activeUser(u.id);
    if (
      !current ||
      current.role !== u.role ||
      current.tenant !== u.tenant ||
      !allowed.includes(current.role)
    )
      fail(403, "Current clearance permission required");
  };
  const caseFor = (u, caseId, write = false) => {
    authorize(
      u,
      write
        ? ["officer", "supervisor"]
        : [
            "officer",
            "supervisor",
            "audit_reviewer",
            "institution",
            "institution_admin",
          ],
    );
    const c = db.prepare("SELECT * FROM cases WHERE id=?").get(caseId);
    if (!c || !canReadCase(db, u, c)) fail(404, "Case not found");
    if (
      write &&
      db
        .prepare("SELECT stage FROM case_operations WHERE case_id=?")
        .get(caseId)?.stage === "closed"
    )
      fail(
        409,
        "Closed administrative case requires an explicit new review workflow",
      );
    const authority = db
      .prepare("SELECT tenant FROM users WHERE id=?")
      .get(c.assigned)?.tenant;
    if (!authority) fail(409, "Case authority unavailable");
    return { c, authority };
  };
  function append(
    u,
    {
      authority,
      caseId = null,
      entity = randomUUID(),
      kind,
      action,
      payload,
      revision = 0,
    },
  ) {
    const previous = latest(entity);
    if ((previous?.revision || 0) !== revision)
      fail(409, "Clearance record changed");
    if (
      previous &&
      (previous.authority !== authority ||
        previous.case_id !== caseId ||
        previous.kind !== kind)
    )
      fail(409, "Clearance identity mismatch");
    const event = {
      id: randomUUID(),
      authority,
      caseId,
      entity,
      kind,
      action,
      revision: revision + 1,
      previous: previous?.id || null,
      actor: u.id,
      payload,
      created: new Date().toISOString(),
    };
    db.prepare(
      "INSERT INTO clearance_events(id,authority,case_id,entity,kind,action,revision,previous,actor,payload,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      event.id,
      authority,
      caseId,
      entity,
      kind,
      action,
      event.revision,
      event.previous,
      u.id,
      JSON.stringify(payload),
      event.created,
    );
    audit(u.id, "clearance_" + kind + "_" + action, caseId, {
      eventId: event.id,
      entity,
      revision: event.revision,
      previous: event.previous,
      authority,
    });
    return decode(
      db.prepare("SELECT * FROM clearance_events WHERE id=?").get(event.id),
    );
  }
  const activation = (authority, scope) =>
    latest("activation:" + authority + ":" + scope);
  const binding = (caseId) => latest("binding:" + caseId);
  const grant = (authority, department, userId) =>
    latest("grant:" + authority + ":" + department + ":" + userId);
  const grantValid = (g, authority, department, userId) =>
    g?.payload.enabled === true &&
    g.authority === authority &&
    g.payload.department === department &&
    g.payload.userId === userId &&
    isReviewer(activeUser(userId)) &&
    activeUser(userId).tenant === authority;
  function source(caseId) {
    const ops = db
      .prepare("SELECT input_revision FROM case_operations WHERE case_id=?")
      .get(caseId);
    const c = db
      .prepare("SELECT assigned,revision FROM cases WHERE id=?")
      .get(caseId);
    const link = db
      .prepare("SELECT * FROM case_domains WHERE case_id=?")
      .get(caseId);
    const instruments = db
      .prepare(
        "SELECT i.id,i.revision,i.status FROM instruments i JOIN case_instruments c ON c.instrument_id=i.id WHERE c.case_id=? ORDER BY i.id LIMIT 501",
      )
      .all(caseId);
    const documents = db
      .prepare(
        "SELECT v.id,v.document_id,v.version,v.sha256,d.kind FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE d.case_id=? AND v.version=(SELECT max(v2.version) FROM document_versions v2 WHERE v2.document_id=v.document_id) ORDER BY v.id LIMIT 501",
      )
      .all(caseId);
    if (instruments.length > 500 || documents.length > 500)
      fail(409, "Case too large for synchronous clearance");
    const obligation = db
      .prepare("SELECT * FROM obligations WHERE id=?")
      .get(link.obligation_id);
    const context = db
      .prepare(
        "SELECT id,payload FROM evidence WHERE case_id=? AND kind='regulatory_context' ORDER BY rowid DESC LIMIT 1",
      )
      .get(caseId);
    const instrument = JSON.parse(
      db.prepare("SELECT instrument FROM cases WHERE id=?").get(caseId)
        .instrument,
    );
    const regulatory = context ? JSON.parse(context.payload).context || {} : {};
    const facts = {
      ...regulatory,
      programme: obligation.programme ?? regulatory.programme,
      instrumentType: instrument.type,
      currency: instrument.currency,
    };
    Object.keys(facts).forEach((k) => {
      if (facts[k] === undefined) delete facts[k];
    });
    return {
      inputRevision: ops.input_revision,
      evaluationId:
        db
          .prepare(
            "SELECT id FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
          )
          .get(caseId)?.id || null,
      caseRevision: c.revision,
      assigned: c.assigned,
      obligation: { id: obligation.id, revision: obligation.revision },
      instruments,
      documents,
      regulatoryContext: context?.id || null,
      facts,
      policyHash: snapshotHash(policyConfig),
    };
  }
  function requestCurrent(request, currentSource, b) {
    const p = request.payload,
      g = grant(request.authority, p.department, p.reviewer);
    return (
      p.sourceHash === snapshotHash(currentSource) &&
      p.bindingId === b?.id &&
      grantValid(g, request.authority, p.department, p.reviewer) &&
      g.id === p.grantId
    );
  }
  function readiness(u, caseId) {
    const { authority } = caseFor(u, caseId),
      b = binding(caseId),
      currentSource = source(caseId);
    if (!b || b.authority !== authority)
      return {
        readyForInternalReview: false,
        blockers: [{ code: "PROCEDURE_NOT_BOUND" }],
        externalRelease: "NOT_CONFIRMED",
        administrativeApproval: false,
        availableBindings: rows(authority, "activation"),
        workflow: db
          .prepare(
            "SELECT stage,revision,input_revision,reviewed_input_revision FROM case_operations WHERE case_id=?",
          )
          .get(caseId),
      };
    const p = b.payload.procedure,
      a = activation(authority, p.scope),
      requests = rows(authority, "request", caseId);
    const responses = requests
      .filter((r) =>
        p.requirements.some((v) => v.id === r.payload.requirementId),
      )
      .map((r) => ({
        requirementId: r.payload.requirementId,
        status: r.payload.status,
        current: requestCurrent(r, currentSource, b),
      }));
    const result = clearanceReadiness({
      procedure: p,
      facts: currentSource.facts,
      responses,
      asOf: new Date().toISOString().slice(0, 10),
      currentBinding: a?.id === b.payload.activationId,
    });
    const current = currentEvidence(db, caseId),
      evaluation = current.find((e) => e.kind === "evaluation");
    const document = current.find((e) => e.kind === "document"),
      extraction = current.find((e) => e.kind === "extraction");
    if (!document)
      result.blockers.push({ code: "MISSING_INSTRUMENT_DOCUMENT" });
    if (
      !extraction ||
      extraction.payload.status !== "completed" ||
      extraction.payload.documentId !== document?.id
    )
      result.blockers.push({ code: "INSTRUMENT_EXTRACTION_REQUIRES_REVIEW" });
    for (const [field, observation] of Object.entries(
      extraction?.payload.fields || {},
    ))
      if (observation.status === "REQUIRES_REVIEW")
        result.blockers.push({
          code: "EXTRACTION_PROPOSAL_REQUIRES_REVIEW",
          field,
        });
    if (!evaluation) result.blockers.push({ code: "MISSING_EVALUATION" });
    for (const finding of evaluation?.payload.findings || [])
      if (
        ["HIGH", "CRITICAL"].includes(finding.severity) &&
        ["unresolved", "discrepancy", "review"].includes(finding.status)
      )
        result.blockers.push({
          code: "UNRESOLVED_EVIDENCE_FINDING",
          findingCode: finding.code,
        });
    if (
      db
        .prepare(
          "SELECT 1 FROM structured_clarifications WHERE case_id=? AND status IN ('open','reopened') LIMIT 1",
        )
        .get(caseId)
    )
      result.blockers.push({ code: "OPEN_CLARIFICATION" });
    const policy = evaluatePolicy(
      {
        ...JSON.parse(
          db.prepare("SELECT instrument FROM cases WHERE id=?").get(caseId)
            .instrument,
        ),
        ...currentSource.facts,
        proofs: currentProofs(db, caseId, currentSource.regulatoryContext),
      },
      { ...policyConfig, asOf: result.asOf },
    );
    if (policy.scope !== undefined && policy.scope !== p.scope)
      result.blockers.push({ code: "POLICY_PROCEDURE_SCOPE_MISMATCH" });
    if (
      policyConfig.scope !== p.scope ||
      policy.classification !== p.classification ||
      policy.outcome !== "COMPLIANT"
    )
      result.blockers.push({
        code: "POLICY_NOT_CONFIRMED_FOR_INTERNAL_APPROVAL",
        outcome: policy.outcome,
      });
    result.policy = policy;
    result.readyForInternalReview = result.blockers.length === 0;
    const snapshot = {
      source: currentSource,
      bindingId: b.id,
      activationId: a?.id || null,
      requests: requests.map((r) => ({
        id: r.id,
        entity: r.entity,
        revision: r.revision,
        authorizedCurrent: requestCurrent(r, currentSource, b),
        grant:
          grant(authority, r.payload.department, r.payload.reviewer)?.id ||
          null,
      })),
      procedureHash: result.procedureHash,
    };
    return {
      ...result,
      snapshotHash: snapshotHash(snapshot),
      snapshot,
      bindingRevision: b.revision,
      workflow: db
        .prepare(
          "SELECT stage,revision,input_revision,reviewed_input_revision FROM case_operations WHERE case_id=?",
        )
        .get(caseId),
      requests,
      proposals: rows(authority, "proposal", caseId).map((p) => ({
        ...p,
        current: p.payload.sourceHash === snapshotHash(snapshot),
      })),
      decisions: rows(authority, "proposal", caseId)
        .filter((p) => p.action === "confirmed")
        .map((p) => ({
          id: p.id,
          outcome: p.payload.outcome,
          classification: p.payload.classification,
          recordedAt: p.created,
          current: p.payload.sourceHash === snapshotHash(snapshot),
          externalRelease: "NOT_CONFIRMED",
        })),
      availableBindings: rows(authority, "activation"),
      reviewerOptions: rows(authority, "grant")
        .filter((g) =>
          grantValid(g, authority, g.payload.department, g.payload.userId),
        )
        .map((g) => ({
          department: g.payload.department,
          userId: g.payload.userId,
        })),
    };
  }
  return {
    latest,
    rows,
    source,
    readiness,
    configurations(u) {
      authorize(u, ["supervisor", "audit_reviewer"]);
      return {
        procedures: configured,
        activations: rows(u.tenant, "activation"),
        grants: rows(u.tenant, "grant"),
        reviewers: db
          .prepare(
            "SELECT id,role FROM users WHERE tenant=? AND status='active' AND role IN ('officer','supervisor') ORDER BY id LIMIT 501",
          )
          .all(u.tenant),
      };
    },
    activate(u, body) {
      authorize(u, ["supervisor"]);
      const p = configured.find(
        (v) => v.version === body.version && v.scope === body.scope,
      );
      if (!p)
        fail(400, "Procedure must come from trusted server configuration");
      const entity = "activation:" + u.tenant + ":" + p.scope;
      const oldVersion = rows(u.tenant, "procedure").find(
        (v) =>
          v.payload.procedure.scope === p.scope &&
          v.payload.procedure.version === p.version,
      );
      if (oldVersion && oldVersion.payload.hash !== snapshotHash(p))
        fail(409, "Procedure version content changed; create a new version");
      if (!oldVersion)
        append(u, {
          authority: u.tenant,
          kind: "procedure",
          action: "registered",
          payload: { procedure: p, hash: snapshotHash(p) },
        });
      return append(u, {
        authority: u.tenant,
        entity,
        kind: "activation",
        action: "activated",
        revision: body.revision,
        payload: {
          procedure: p,
          hash: snapshotHash(p),
          reason: reason(body.reason),
        },
      });
    },
    setGrant(u, body) {
      authorize(u, ["supervisor"]);
      const target = activeUser(body.userId);
      if (
        !target ||
        !isReviewer(target) ||
        target.tenant !== u.tenant ||
        !identifier(body.department) ||
        typeof body.enabled !== "boolean"
      )
        fail(
          400,
          "An active same-authority reviewer and department are required",
        );
      return append(u, {
        authority: u.tenant,
        entity: "grant:" + u.tenant + ":" + body.department + ":" + target.id,
        kind: "grant",
        action: body.enabled ? "enabled" : "revoked",
        revision: body.revision,
        payload: {
          userId: target.id,
          department: body.department,
          enabled: body.enabled,
          reason: reason(body.reason),
        },
      });
    },
    bind(u, caseId, body) {
      const { authority } = caseFor(u, caseId, true),
        a = activation(authority, body.scope);
      if (!a) fail(409, "Activate a configured procedure first");
      if (
        rows(authority, "proposal", caseId).some(
          (p) =>
            p.action === "confirmed" &&
            p.payload.sourceHash === readiness(u, caseId).snapshotHash,
        )
      )
        fail(
          409,
          "A recorded administrative decision requires a new review workflow",
        );
      return append(u, {
        authority,
        caseId,
        entity: "binding:" + caseId,
        kind: "binding",
        action: "bound",
        revision: body.revision,
        payload: {
          activationId: a.id,
          procedure: a.payload.procedure,
          reason: reason(body.reason),
        },
      });
    },
    request(u, caseId, body) {
      const { authority } = caseFor(u, caseId, true),
        b = binding(caseId);
      if (
        !b ||
        b.authority !== authority ||
        activation(authority, b.payload.procedure.scope)?.id !==
          b.payload.activationId
      )
        fail(409, "Bind the current active procedure first");
      const requirement = b.payload.procedure.requirements.find(
        (r) => r.id === body.requirementId,
      );
      if (!requirement) fail(400, "Unknown requirement");
      const g = grant(authority, requirement.department, body.reviewer);
      if (!grantValid(g, authority, requirement.department, body.reviewer))
        fail(403, "Current department grant required");
      const state = readiness(u, caseId),
        step = state.items.find((r) => r.id === requirement.id);
      if (
        [
          "NOT_APPLICABLE",
          "REVIEW_APPLICABILITY",
          "BLOCKED_PREREQUISITE",
        ].includes(step.status)
      )
        fail(
          409,
          "Resolve applicability and prerequisite blockers before requesting review",
        );
      const s = source(caseId);
      if (
        !Array.isArray(body.documentVersionIds) ||
        body.documentVersionIds.length > 20 ||
        new Set(body.documentVersionIds).size !== body.documentVersionIds.length
      )
        fail(400, "Select up to twenty unique current document versions");
      const documents = body.documentVersionIds.map((id) =>
        s.documents.find((d) => d.id === id),
      );
      if (documents.some((d) => !d))
        fail(400, "Only current case document versions may be shared");
      if (
        requirement.evidenceKinds.some(
          (k) =>
            !documents.some(
              (d) =>
                d.kind ===
                { FDR: "fdr", SUPPORTING: "other", PROOF: "proof" }[k],
            ),
        )
      )
        fail(409, "Required department evidence missing");
      const entity = "request:" + caseId + ":" + requirement.id;
      return append(u, {
        authority,
        caseId,
        entity,
        kind: "request",
        action: "requested",
        revision: body.revision,
        payload: {
          requirementId: requirement.id,
          department: requirement.department,
          reviewer: body.reviewer,
          grantId: g.id,
          status: "pending",
          bindingId: b.id,
          sourceHash: snapshotHash(s),
          documents,
          message: reason(body.reason),
        },
      });
    },
    departmentRequest(u, entity) {
      authorize(u, ["officer", "supervisor"]);
      const r = latest(entity);
      if (
        !r ||
        r.kind !== "request" ||
        r.authority !== u.tenant ||
        r.payload.reviewer !== u.id
      )
        fail(404, "Department request not found");
      const c = db
        .prepare("SELECT assigned FROM cases WHERE id=?")
        .get(r.case_id);
      if (
        db.prepare("SELECT tenant FROM users WHERE id=?").get(c?.assigned)
          ?.tenant !== u.tenant ||
        !grantValid(
          grant(u.tenant, r.payload.department, u.id),
          u.tenant,
          r.payload.department,
          u.id,
        )
      )
        fail(404, "Department request not found");
      const b = binding(r.case_id),
        s = source(r.case_id);
      return {
        ...r,
        current:
          requestCurrent(r, s, b) &&
          activation(u.tenant, b?.payload.procedure.scope)?.id ===
            b?.payload.activationId,
      };
    },
    respond(u, entity, body) {
      const r = this.departmentRequest(u, entity);
      if (
        db
          .prepare("SELECT stage FROM case_operations WHERE case_id=?")
          .get(r.case_id)?.stage === "closed"
      )
        fail(409, "Closed administrative review cannot accept a response");
      if (!r.current || r.payload.status !== "pending")
        fail(409, "Request is stale or already answered");
      if (!["accepted", "rejected"].includes(body.status))
        fail(400, "Choose accepted or rejected");
      return append(u, {
        authority: r.authority,
        caseId: r.case_id,
        entity,
        kind: "request",
        action: "responded",
        revision: body.revision,
        payload: {
          ...r.payload,
          status: body.status,
          response: reason(body.reason),
        },
      });
    },
    withdraw(u, caseId, entity, body) {
      const { authority } = caseFor(u, caseId, true),
        r = latest(entity);
      if (
        !r ||
        r.kind !== "request" ||
        r.case_id !== caseId ||
        r.authority !== authority
      )
        fail(404, "Request not found");
      if (r.payload.status === "withdrawn")
        fail(409, "Request already withdrawn");
      return append(u, {
        authority,
        caseId,
        entity,
        kind: "request",
        action: "withdrawn",
        revision: body.revision,
        payload: {
          ...r.payload,
          status: "withdrawn",
          withdrawal: reason(body.reason),
        },
      });
    },
    propose(u, caseId, body) {
      const { authority } = caseFor(u, caseId, true);
      const ops = db
        .prepare("SELECT * FROM case_operations WHERE case_id=?")
        .get(caseId);
      if (
        !["under_review", "pending_clearance", "ready_for_decision"].includes(
          ops.stage,
        ) ||
        ops.reviewed_input_revision !== ops.input_revision
      )
        fail(
          409,
          "Review current evidence before proposing an administrative decision",
        );
      if (!["approve", "reject", "refer"].includes(body.outcome))
        fail(400, "Invalid internal decision outcome");
      const r = readiness(u, caseId);
      if (!r.snapshotHash)
        fail(409, "Bind a procedure before proposing a decision");
      if (body.outcome === "approve" && !r.readyForInternalReview)
        fail(409, "Mandatory clearance blockers remain");
      if (
        rows(authority, "proposal", caseId).some(
          (p) =>
            p.action === "confirmed" && p.payload.sourceHash === r.snapshotHash,
        )
      )
        fail(409, "An internal decision is already recorded");
      const proposal = append(u, {
        authority,
        caseId,
        kind: "proposal",
        action: "proposed",
        payload: {
          outcome: body.outcome,
          maker: u.id,
          sourceHash: r.snapshotHash,
          snapshot: r.snapshot,
          readiness: r,
          reason: reason(body.reason),
          classification: r.classification,
          externalRelease: "NOT_CONFIRMED",
        },
      });
      db.prepare(
        "UPDATE case_operations SET stage='ready_for_decision',revision=revision+1,updated=? WHERE case_id=?",
      ).run(proposal.created, caseId);
      return proposal;
    },
    close(u, caseId, body) {
      authorize(u, ["supervisor"]);
      const { authority } = caseFor(u, caseId, true),
        state = readiness(u, caseId);
      const decision = state.decisions?.find((d) => d.current);
      const ops = db
        .prepare("SELECT * FROM case_operations WHERE case_id=?")
        .get(caseId);
      if (
        !decision ||
        ops.stage !== "decision_recorded" ||
        body.revision !== ops.revision ||
        ops.reviewed_input_revision !== ops.input_revision
      )
        fail(
          409,
          "A current independently recorded internal decision and workflow revision are required",
        );
      const event = append(u, {
        authority,
        caseId,
        kind: "administration",
        action: "closed",
        payload: {
          decisionId: decision.id,
          snapshotHash: state.snapshotHash,
          reason: reason(body.reason),
          externalRelease: "NOT_CONFIRMED",
        },
      });
      db.prepare(
        "UPDATE case_operations SET stage='closed',revision=revision+1,updated=? WHERE case_id=?",
      ).run(event.created, caseId);
      return event;
    },
    reopen(u, caseId, body) {
      authorize(u, ["supervisor"]);
      const { authority } = caseFor(u, caseId),
        ops = db
          .prepare("SELECT * FROM case_operations WHERE case_id=?")
          .get(caseId),
        b = binding(caseId);
      if (ops.stage !== "closed" || body.revision !== ops.revision || !b)
        fail(409, "A current closed-case revision is required");
      const message = reason(body.reason);
      const nextBinding = append(u, {
        authority,
        caseId,
        entity: b.entity,
        kind: "binding",
        action: "reopened",
        revision: b.revision,
        payload: { ...b.payload, reason: message },
      });
      const event = append(u, {
        authority,
        caseId,
        kind: "administration",
        action: "reopened",
        payload: {
          previousBindingId: b.id,
          bindingId: nextBinding.id,
          reason: message,
          externalRelease: "NOT_CONFIRMED",
        },
      });
      db.prepare(
        "UPDATE case_operations SET stage='reevaluation_required',revision=revision+1,reviewed_input_revision=NULL,updated=? WHERE case_id=?",
      ).run(event.created, caseId);
      return event;
    },
    confirm(u, caseId, entity, body) {
      authorize(u, ["supervisor"]);
      const { authority } = caseFor(u, caseId, true),
        p = latest(entity);
      if (
        !p ||
        p.kind !== "proposal" ||
        p.case_id !== caseId ||
        p.authority !== authority
      )
        fail(404, "Decision proposal not found");
      if (p.action !== "proposed" || p.payload.maker === u.id)
        fail(
          409,
          "A distinct authorized checker is required for an open proposal",
        );
      if (
        !activeUser(p.payload.maker) ||
        !canReadCase(
          db,
          activeUser(p.payload.maker),
          db.prepare("SELECT * FROM cases WHERE id=?").get(caseId),
        ) ||
        !isReviewer(activeUser(p.payload.maker))
      )
        fail(409, "Maker authorization changed");
      const r = readiness(u, caseId);
      const ops = db
        .prepare("SELECT * FROM case_operations WHERE case_id=?")
        .get(caseId);
      if (
        ops.stage !== "ready_for_decision" ||
        ops.reviewed_input_revision !== ops.input_revision
      )
        fail(409, "Current evidence requires renewed administrative review");
      if (
        p.payload.sourceHash !== r.snapshotHash ||
        (p.payload.outcome === "approve" && !r.readyForInternalReview)
      )
        fail(
          409,
          "Evidence, procedure, grants or clearances changed; create a new proposal",
        );
      if (
        rows(authority, "proposal", caseId).some(
          (v) =>
            v.action === "confirmed" && v.payload.sourceHash === r.snapshotHash,
        )
      )
        fail(409, "An internal decision is already recorded");
      const decision = append(u, {
        authority,
        caseId,
        entity,
        kind: "proposal",
        action: "confirmed",
        revision: body.revision,
        payload: {
          ...p.payload,
          checker: u.id,
          checkerReason: reason(body.reason),
          externalRelease: "NOT_CONFIRMED",
          administrativeDecisionOnly: true,
        },
      });
      db.prepare(
        "UPDATE case_operations SET stage='decision_recorded',revision=revision+1,updated=? WHERE case_id=?",
      ).run(decision.created, caseId);
      return decision;
    },
  };
}
