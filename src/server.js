import { SetuSandboxProvider } from "./setu.js";
import { assessAICTE, ruleRegister, validateContext } from "./regulatory.js";
import {
  verifyPassword,
  acquireLock,
  permittedHost,
  requestLimiter,
} from "./security.js";
import { IFSCProvider } from "./ifsc.js";
import {
  DevelopmentDepositProvider,
  lookupIFSC,
  mockScenarios,
} from "./financial.js";
import { registry as policyRegistry } from "./policy.js";
import http from "node:http";
import { LocalPrivateStorage } from "./storage.js";
import { OCRPool } from "./ocr-pool.js";
import { validateEnvelope } from "./contracts.js";
import { replayPolicySnapshot } from "./policy-replay.js";
import { recordResolution } from "./resolution.js";
import { notifyCase } from "./operations.js";
import {
  operationsGlobal,
  operationsCase,
  recordConversation,
} from "./operations-api.js";
import { submissions } from "./submissions.js";
import { viewerRoute } from "./viewer.js";
import { continuityRoute } from "./continuity-api.js";
import { runReminderBatch } from "./reminders.js";
import { lifecycleRoute } from "./lifecycle.js";
import { clearanceService } from "./clearance-service.js";
import { clearanceRoutes } from "./clearance-api.js";
import { validateProcedure } from "./clearance-procedure.js";
import { policyDecisionRoute } from "./policy-decisions.js";
import { analysisRoute } from "./analysis-api.js";
import { createAuditIntegrity } from "./audit-integrity.js";
import {
  capturePolicyConfiguration,
  bindPolicyContext,
  attachPolicyContext,
} from "./policy-history.js";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { openStore, password, hash } from "./store.js";
import { validate, evaluate, extract } from "./engine.js";
import { administration, attachCase, addInstrument } from "./administration.js";
import { validatePolicies } from "./policy-runtime.js";
import { paginate, accessibleCases } from "./pagination.js";
import { requestContext, scrub, category } from "./observability.js";
import {
  currentEvidence,
  currentProofs,
  decodeEvidence,
} from "./current-evidence.js";
import {
  roles,
  isInstitution,
  isReviewer,
  canReadCase,
} from "./permissions.js";
import {
  domainSnapshot,
  transition,
  assignOfficer,
  prepareDocument,
  registerVersion,
  latestFDR,
  linkInstruments,
} from "./domain.js";
const exec = promisify(execFile),
  root = fileURLToPath(new URL("../", import.meta.url));
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const json = (r, s, v) => {
  r.writeHead(s, { "Content-Type": "application/json" });
  r.end(JSON.stringify(v));
};
export function seed(db, users) {
  for (const u of users)
    db.prepare(
      "INSERT OR IGNORE INTO users(id,email,password,role,tenant) VALUES(?,?,?,?,?)",
    ).run(u.id, u.email, password(u.password), u.role, u.tenant);
}
export function createApp({
  dir = resolve(process.env.DATA_DIR || "data"),
  ocr = process.env.TESSERACT_PATH || null,
  ocrRunner = exec,
  depositProvider = new DevelopmentDepositProvider(),
  ifscProvider = new IFSCProvider(),
  policies = process.env.POLICY_FILE
    ? JSON.parse(readFileSync(process.env.POLICY_FILE, "utf8"))
    : [],
  policyScope = "aicte",
  verifiedSourceHashes = [],
  procedures = process.env.PROCEDURE_FILE
    ? JSON.parse(readFileSync(process.env.PROCEDURE_FILE, "utf8"))
    : [],
  storage = null,
  auditKeyFile = process.env.AUDIT_KEY_FILE,
  auditCheckpointFile = process.env.AUDIT_CHECKPOINT_FILE,
  logSink = process.env.LOG_REQUESTS === "true"
    ? (event) => process.stdout.write(JSON.stringify(event) + "\n")
    : () => {},
} = {}) {
  policies = validatePolicies(policies);
  if (!Array.isArray(procedures) || procedures.length > 100)
    throw Error("Invalid trusted procedure configuration");
  procedures = procedures.map(validateProcedure);
  if (
    new Set(procedures.map((p) => p.scope + "|" + p.version)).size !==
    procedures.length
  )
    throw Error("Duplicate procedure configuration");
  const ocrPool = new OCRPool();
  const pendingJobs = new Set();
  mkdirSync(dir, { recursive: true });
  const releaseLock = acquireLock(dir);
  let db;
  try {
    db = openStore(dir);
  } catch (e) {
    releaseLock();
    throw e;
  }
  try {
    storage = storage || new LocalPrivateStorage(dir);
    storage.recover?.(
      db
        .prepare(
          "SELECT storage_key FROM document_versions UNION SELECT storage_key FROM draft_documents",
        )
        .all()
        .map((r) => r.storage_key),
    );
  } catch (e) {
    db.close();
    releaseLock();
    throw e;
  }
  const cursorKey = randomBytes(32),
    rates = new Map(),
    limitRequest = requestLimiter();
  let activeValidators = 0;
  let auditIntegrity,
    transactionDepth = 0;
  try {
    auditIntegrity = createAuditIntegrity(db, {
      dir,
      keyFile: auditKeyFile,
      checkpointFile: auditCheckpointFile,
    });
  } catch (error) {
    ocrPool.close();
    try {
      db.close();
    } finally {
      releaseLock();
    }
    throw error;
  }
  const audit = (u, a, id, p = {}) => {
    db.prepare(
      "INSERT INTO audit(actor,action,case_id,payload,created,correlation_id,category,outcome) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      u,
      a,
      id ?? null,
      JSON.stringify(scrub(p)),
      new Date().toISOString(),
      requestContext.getStore()?.id || "system",
      category(a),
      /failed|failure/.test(a)
        ? "FAILURE"
        : /denied/.test(a)
          ? "DENIED"
          : "SUCCESS",
    );
    if (!transactionDepth) auditIntegrity.checkpoint();
  };
  let policyCapsule;
  try {
    policyCapsule = tx(() =>
      capturePolicyConfiguration(
        db,
        {
          policies,
          scope: policyScope,
          verifiedSourceHashes,
          regulatoryRegister: ruleRegister,
        },
        audit,
      ),
    );
  } catch (error) {
    ocrPool.close();
    try {
      db.close();
    } finally {
      releaseLock();
    }
    throw error;
  }
  function evidence(u, id, kind, p) {
    const eid = randomUUID();
    db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?)").run(
      eid,
      id,
      kind,
      JSON.stringify(p),
      new Date().toISOString(),
      u,
    );
    if (["evaluation", "evaluation_replay"].includes(kind))
      bindPolicyContext(db, eid, id, p);
    audit(u, kind, id, {
      evidenceId: eid,
      payloadSHA256: hash(Buffer.from(JSON.stringify(p))),
    });
    return eid;
  }
  db.prepare(
    "UPDATE jobs SET status='interrupted',error='Service restarted during processing' WHERE status='processing'",
  ).run();
  db.prepare(
    "UPDATE draft_documents SET status='interrupted' WHERE status='processing'",
  ).run();
  const history = (id) => currentEvidence(db, id);
  function reevaluate(u, c, asOf) {
    const h = history(c.id),
      last = (k) => h.filter((e) => e.kind === k).at(-1),
      d = (() => {
        const e = latestFDR(db, c.id);
        return e ? { ...e, payload: JSON.parse(e.payload) } : undefined;
      })(),
      x = last("extraction"),
      b = last("external");
    const context = last("regulatory_context"),
      proofs = currentProofs(db, c.id, context?.id);
    const r = evaluate({
      policies,
      policyScope,
      verifiedSourceHashes,
      ...(asOf ? { asOf } : {}),
      instrument: JSON.parse(c.instrument),
      obligation: JSON.parse(c.obligation),
      extraction: x?.payload.documentId === d?.id ? x?.payload.fields : {},
      external: b?.payload,
      documentId: d?.id,
      regulatoryContext: context?.payload.context,
      proofs,
      ifscReference:
        last("ifsc_reference")?.payload.code === JSON.parse(c.instrument).ifsc
          ? last("ifsc_reference").payload
          : undefined,
      duplicates: db
        .prepare(
          "SELECT id FROM cases WHERE tenant=? AND id!=? AND json_extract(instrument,'$.reference')=? ORDER BY rowid LIMIT 100",
        )
        .all(c.tenant, c.id, JSON.parse(c.instrument).reference)
        .map((x) => x.id),
    });
    r.sourceReferences = {
      declaration: h
        .filter((e) =>
          ["correction", "declaration", "instrument_primary"].includes(e.kind),
        )
        .at(-1)?.id,
      document: d?.id,
      extraction: x?.id,
      external: b?.id,
      obligationCase: c.id,
      regulatoryContext: context?.id,
      proofReviews: proofs.map((p) => p.reviewId),
    };
    r.version =
      db
        .prepare(
          "SELECT count(*) n FROM evidence WHERE case_id=? AND kind IN ('evaluation','evaluation_replay')",
        )
        .get(c.id).n + 1;
    for (const finding of r.findings) {
      finding.evaluationVersion = r.version;
      finding.sources = finding.sources.map((s) => ({
        ...s,
        evidenceId:
          s.type === "declaration"
            ? r.sourceReferences.declaration
            : s.type === "document"
              ? (s.id ?? d?.id)
              : s.type === "policy"
                ? context?.id
                : s.type === "ifsc-reference"
                  ? last("ifsc_reference")?.payload.code ===
                    JSON.parse(c.instrument).ifsc
                    ? last("ifsc_reference")?.id
                    : undefined
                  : s.classification ||
                      s.type === "provider" ||
                      s.type === "mock-provider"
                    ? b?.id
                    : null,
        extractionId:
          s.type === "document" && x?.payload.documentId === d?.id
            ? x?.id
            : undefined,
        proofReviewIds:
          s.type === "policy" ? proofs.map((p) => p.reviewId) : undefined,
      }));
    }
    r.supersedes = last("evaluation")?.id ?? null;
    r.caseRevision = c.revision;
    r.inputRevision = db
      .prepare("SELECT input_revision FROM case_operations WHERE case_id=?")
      .get(c.id).input_revision;
    if (asOf) {
      r.replays = r.supersedes;
      r.supersedes = null;
      r.isHistoricalReplay = true;
    }
    attachPolicyContext(r, policyCapsule, {
      instrument: JSON.parse(c.instrument),
      context: context?.payload.context || {},
      proofs,
    });
    const eid = evidence(u, c.id, asOf ? "evaluation_replay" : "evaluation", r);
    if (!asOf) {
      const delta = recordResolution(db, c.id, eid, last("evaluation"), r);
      if (
        last("evaluation") &&
        (delta.changes.resolved.length ||
          delta.changes.introduced.length ||
          delta.changedFacts.length)
      )
        notifyCase(
          db,
          c,
          "evaluation:" + eid,
          "evidence_change",
          delta.recommendedAction,
        );
    }
    return eid;
  }
  function refresh(u, c, previousRef = null) {
    let target;
    const refs = [JSON.parse(c.instrument).reference, previousRef];
    const impacted = db
      .prepare(
        "SELECT * FROM cases WHERE tenant=? AND (id=? OR json_extract(instrument,'$.reference') IN (?,?)) ORDER BY rowid LIMIT 101",
      )
      .all(c.tenant, c.id, ...refs);
    if (impacted.length > 100)
      fail(
        409,
        "Too many duplicate references for a synchronous evaluation; narrow the submission",
      );
    for (const row of impacted)
      if (
        row.id === c.id ||
        refs.includes(JSON.parse(row.instrument).reference)
      ) {
        const eid = reevaluate(u, row);
        if (row.id === c.id) target = eid;
      }
    return target;
  }
  function tx(fn) {
    db.exec("BEGIN IMMEDIATE");
    transactionDepth++;
    let r;
    try {
      r = fn();
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      transactionDepth--;
    }
    auditIntegrity.checkpoint();
    return r;
  }
  const clearances = clearanceService({
    db,
    audit,
    procedures,
    policyConfig: { policies, scope: policyScope, verifiedSourceHashes },
  });
  const server = http.createServer((req, res) => {
    const ctx = { id: randomUUID(), actor: "anonymous" },
      start = performance.now();
    res.setHeader("X-Request-ID", ctx.id);
    res.once("finish", () => {
      try {
        logSink(
          scrub({
            requestId: ctx.id,
            actor: ctx.actor,
            method: req.method,
            path: req.url.split("?")[0],
            status: res.statusCode,
            outcome: res.statusCode < 400 ? "SUCCESS" : "FAILURE",
            durationMs: performance.now() - start,
          }),
        );
      } catch {}
    });
    requestContext.run(ctx, async () => {
      const secure = process.env.COOKIE_SECURE === "true";
      for (const [k, v] of Object.entries({
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      }))
        res.setHeader(k, v);
      try {
        if (!permittedHost(req.headers.host)) fail(400, "Host rejected");
        if (!limitRequest(req.socket.remoteAddress))
          fail(429, "Request rate exceeded");
        const url = new URL(req.url, "http://localhost"),
          path = url.pathname;
        if (
          req.method === "GET" &&
          [
            "/",
            "/app.js",
            "/review.js",
            "/domain.js",
            "/operations.js",
            "/clearances.js",
            "/policy-decisions.js",
            "/analysis.js",
            "/submission.js",
            "/evidence-viewer.js",
            "/viewer-geometry.js",
            "/style.css",
          ].includes(path)
        ) {
          const f = path === "/" ? "index.html" : path.slice(1);
          res.setHeader(
            "Content-Type",
            f.endsWith(".js")
              ? "text/javascript"
              : f.endsWith(".css")
                ? "text/css"
                : "text/html",
          );
          res.end(readFileSync(join(root, "public", f)));
          return;
        }
        if (!path.startsWith("/api/")) fail(404, "Not found");
        if (req.method === "GET" && path === "/api/health") {
          json(res, 200, { status: "alive" });
          return;
        }
        if (req.method === "GET" && path === "/api/ready") {
          try {
            db.prepare("SELECT 1").get();
            json(res, 200, { status: "ready" });
          } catch {
            json(res, 503, { status: "unavailable" });
          }
          return;
        }
        let body = {};
        if (req.method !== "GET") {
          let n = 0,
            chunks = [];
          for await (const chunk of req) {
            n += chunk.length;
            if (n > (path.endsWith("/documents") ? 7 * 1024 * 1024 : 65536))
              fail(413, "Request too large");
            chunks.push(chunk);
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          } catch {
            fail(400, "Invalid JSON");
          }
          validateEnvelope(body);
          if (!body || typeof body !== "object" || Array.isArray(body))
            fail(400, "Object required");
          if (
            req.headers.origin &&
            req.headers.origin !==
              new URL("http" + (secure ? "s" : "") + "://" + req.headers.host)
                .origin
          )
            fail(403, "Origin rejected");
        }
        if (path === "/api/login" && req.method === "POST") {
          const key = req.socket.remoteAddress,
            now = Date.now();
          let rate = rates.get(key);
          if (!rate || now - rate.start > 60000) {
            rate = { start: now, n: 0 };
            rates.set(key, rate);
          }
          if (++rate.n > 15) fail(429, "Too many login attempts");
          if (
            typeof body.email !== "string" ||
            typeof body.password !== "string" ||
            body.password.length > 200
          )
            fail(400, "Invalid credentials");
          const u = db
            .prepare("SELECT * FROM users WHERE email=?")
            .get(body.email);
          if (
            !(await verifyPassword(body.password, u?.password)) ||
            u?.status !== "active"
          ) {
            audit("anonymous", "login_failed");
            fail(401, "Invalid credentials");
          }
          const token = randomBytes(32).toString("hex"),
            csrf = randomBytes(24).toString("hex");
          db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
            hash(token),
            u.id,
            csrf,
            Date.now() + 28800000,
          );
          res.setHeader(
            "Set-Cookie",
            "sentinel=" +
              token +
              "; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800" +
              (secure ? "; Secure" : ""),
          );
          audit(u.id, "login");
          json(res, 200, { id: u.id, email: u.email, role: u.role, csrf });
          return;
        }
        const token = req.headers.cookie?.match(
            /(?:^|; )sentinel=([a-f0-9]{64})(?:;|$)/,
          )?.[1],
          u = token
            ? db
                .prepare(
                  "SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
                )
                .get(hash(token), Date.now())
            : null;
        if (!u || u.status !== "active" || !roles.includes(u.role))
          fail(401, "Authentication required");
        const reauthorize = () => {
          const live = db
            .prepare(
              "SELECT u.role,u.status,u.tenant,c.assigned,c.tenant case_tenant FROM users u JOIN cases c ON c.id=? JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.token=? AND s.expires>?",
            )
            .get(id, u.id, hash(token), Date.now());
          if (
            !live ||
            live.status !== "active" ||
            live.role !== u.role ||
            !canReadCase(
              db,
              { ...u, ...live },
              db.prepare("SELECT * FROM cases WHERE id=?").get(id),
            )
          )
            fail(403, "Authorization changed during processing");
        };
        ctx.actor = u.id;
        if (req.method !== "GET" && req.headers["x-csrf-token"] !== u.csrf)
          fail(403, "CSRF required");
        if (
          req.method !== "GET" &&
          u.role === "audit_reviewer" &&
          path !== "/api/logout"
        )
          fail(403, "Audit reviewer has read-only access");
        if (path === "/api/me" && req.method === "GET") {
          json(res, 200, {
            id: u.id,
            email: u.email,
            role: u.role,
            csrf: u.csrf,
          });
          return;
        }
        if (path === "/api/security/audit-integrity" && req.method === "GET") {
          if (!["supervisor", "audit_reviewer"].includes(u.role))
            fail(403, "Audit verification role required");
          // Global verification exposes only this caller's verification outcome, no event IDs or counts.
          const result = auditIntegrity.verify();
          audit(u.id, "audit_integrity_verified", null, {
            rootId: result.rootId,
          });
          json(res, 200, {
            valid: result.valid,
            algorithm: result.algorithm,
            trust: result.trust,
            legacyWasUnsignedBeforeEnrollment: true,
            elapsedMs: result.elapsedMs,
          });
          return;
        }
        if (
          await administration({
            db,
            u,
            path,
            url,
            cursorKey,
            body,
            method: req.method,
            tx,
            audit,
            evidence,
            refresh,
            json,
            res,
            revalidate: () => {
              const live = db
                .prepare(
                  "SELECT u.role,u.status FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.token=? AND s.expires>?",
                )
                .get(u.id, hash(token), Date.now());
              if (!live || live.status !== "active" || live.role !== u.role)
                fail(403, "Authorization changed");
            },
          })
        )
          return;
        if (
          await submissions({
            db,
            u,
            path,
            method: req.method,
            body,
            storage,
            tx,
            evidence,
            audit,
            refresh,
            json,
            res,
            revalidate: () => {
              const live = db
                .prepare(
                  "SELECT u.role,u.status FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.token=? AND s.expires>?",
                )
                .get(u.id, hash(token), Date.now());
              if (!live || live.status !== "active" || live.role !== u.role)
                fail(403, "Authorization changed");
            },
            recognize: async (doc) => {
              if (doc.mime === "text/plain")
                return {
                  text: storage.read(doc.id).toString("utf8"),
                  blocks: [],
                  engine: "text-import",
                };
              if (doc.mime === "application/pdf")
                return JSON.parse(
                  (
                    await exec(
                      process.execPath,
                      [
                        "--max-old-space-size=384",
                        join(root, "src", "pdf-worker.js"),
                        storage.path(doc.id),
                        "process",
                      ],
                      { timeout: 60000, maxBuffer: 4194304, windowsHide: true },
                    )
                  ).stdout,
                );
              if (ocr) {
                const r = await ocrRunner(
                  ocr,
                  [storage.path(doc.id), "stdout", "--psm", "6"],
                  { timeout: 60000, maxBuffer: 4194304, windowsHide: true },
                );
                return {
                  text: r.stdout,
                  blocks: [],
                  engine: "native-tesseract",
                };
              }
              return ocrPool.run(storage.path(doc.id));
            },
          })
        )
          return;
        if (
          operationsGlobal({
            db,
            u,
            path,
            url,
            body,
            method: req.method,
            tx,
            audit,
            json,
            res,
            cursorKey,
          })
        )
          return;
        if (
          clearanceRoutes({
            service: clearances,
            db,
            u,
            path,
            method: req.method,
            body,
            url,
            tx,
            json,
            res,
            storage,
            audit,
            key: cursorKey,
          })
        )
          return;
        if (path === "/api/logout" && req.method === "POST") {
          db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
          res.setHeader(
            "Set-Cookie",
            "sentinel=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          );
          json(res, 200, { ok: true });
          return;
        }
        if (path === "/api/policies" && req.method === "GET") {
          json(res, 200, {
            legacy: policyRegistry,
            ...ruleRegister,
            operationalVersions: policies,
          });
          return;
        }
        if (path === "/api/institution" && req.method === "GET") {
          if (!isInstitution(u)) fail(403, "Institution role required");
          json(res, 200, {
            ...(db
              .prepare("SELECT * FROM institutions WHERE tenant=?")
              .get(u.tenant) ?? { tenant: u.tenant, name: null }),
            ...JSON.parse(
              db
                .prepare("SELECT data FROM institution_profiles WHERE tenant=?")
                .get(u.tenant)?.data || "{}",
            ),
            revision:
              db
                .prepare(
                  "SELECT revision FROM institution_profiles WHERE tenant=?",
                )
                .get(u.tenant)?.revision || 0,
          });
          return;
        }
        if (path === "/api/ifsc" && req.method === "GET") {
          const code = url.searchParams.get("code");
          json(res, 200, await ifscProvider.lookup(code));
          return;
        }
        if (path === "/api/cases" && req.method === "GET") {
          const access = accessibleCases(u),
            q = url.searchParams.get("q") || "",
            status = url.searchParams.get("status") || "";
          if (q.length > 150) fail(400, "Search too long");
          let where = access.where,
            params = access.params;
          if (q) {
            where +=
              " AND (c.name LIKE ? OR json_extract(c.instrument,'$.reference') LIKE ?)";
            params = [...params, "%" + q + "%", "%" + q + "%"];
          }
          if (status) {
            where +=
              " AND EXISTS(SELECT 1 FROM case_domains d WHERE d.case_id=c.id AND d.status=?)";
            params = [...params, status];
          }
          const page = paginate(db, {
            table: "cases c",
            alias: "c",
            where,
            params,
            url,
            scope: [u.id, u.role, u.tenant, q, status].join("|"),
            key: cursorKey,
          });
          let total = 0n,
            count = 0;
          for (const row of db
            .prepare(`SELECT c.instrument FROM cases c WHERE ${where}`)
            .iterate(...params)) {
            total += BigInt(JSON.parse(row.instrument).amountPaise);
            count++;
          }
          res.setHeader("X-Next-Cursor", page.nextCursor || "");
          res.setHeader("X-Total-Count", String(count));
          res.setHeader("X-Total-Paise", String(total));
          json(
            res,
            200,
            page.items.map((c) => ({
              ...c,
              instrument: JSON.parse(c.instrument),
              obligation: JSON.parse(c.obligation),
            })),
          );
          return;
        }
        if (path === "/api/cases" && req.method === "POST") {
          if (!isInstitution(u)) fail(403, "Institution role required");
          let inst;
          try {
            inst = validate(body.instrument);
          } catch (e) {
            fail(400, e.message);
          }
          if (
            typeof body.name !== "string" ||
            !body.name.trim() ||
            body.name.length > 150 ||
            !Number.isSafeInteger(body.obligation?.amountPaise) ||
            body.obligation.amountPaise <= 0
          )
            fail(400, "Name and positive obligation required");
          const officer = db
            .prepare(
              "SELECT id FROM users WHERE role='officer' AND status='active' ORDER BY id LIMIT 1",
            )
            .get();
          if (!officer) fail(503, "No officer configured");
          const requestKey = req.headers["idempotency-key"];
          let payloadHash;
          if (requestKey) {
            if (!/^[A-Za-z0-9-]{8,100}$/.test(requestKey))
              fail(400, "Invalid idempotency key");
            payloadHash = hash(JSON.stringify(body));
            const previous = db
              .prepare("SELECT * FROM idempotency WHERE actor=? AND key=?")
              .get(u.id, requestKey);
            if (previous) {
              if (previous.payload_hash !== payloadHash)
                fail(409, "Idempotency key reused with different payload");
              json(res, 200, JSON.parse(previous.response));
              return;
            }
          }
          const id = randomUUID();
          tx(() => {
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
              JSON.stringify(inst),
            );
            attachCase(
              db,
              db.prepare("SELECT * FROM cases WHERE id=?").get(id),
              body,
            );
            evidence(
              u.id,
              id,
              "declaration",
              JSON.parse(
                db.prepare("SELECT instrument FROM cases WHERE id=?").get(id)
                  .instrument,
              ),
            );
            audit(u.id, "case_created", id);
            if (requestKey)
              db.prepare("INSERT INTO idempotency VALUES(?,?,?,?)").run(
                u.id,
                requestKey,
                payloadHash,
                JSON.stringify({ id }),
              );
            refresh(u.id, db.prepare("SELECT * FROM cases WHERE id=?").get(id));
          });
          json(res, 201, { id });
          return;
        }
        const m = path.match(/^\/api\/cases\/([a-f0-9-]{36})(?:\/(.*))?$/);
        if (!m) fail(404, "Not found");
        const [, id, action] = m;
        let c = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
        if (!c || !canReadCase(db, u, c)) {
          audit(u.id, "access_denied", id);
          fail(404, "Case not found");
        }
        if (
          analysisRoute({
            db,
            c,
            u,
            action,
            method: req.method,
            body,
            url,
            res,
            json,
            tx,
            audit,
            key: cursorKey,
            capsule: policyCapsule,
            clearances,
          })
        )
          return;
        if (
          operationsCase({
            db,
            u,
            c,
            action,
            method: req.method,
            body,
            tx,
            audit,
            evidence,
            refresh,
            json,
            res,
          })
        )
          return;
        if (
          policyDecisionRoute({
            db,
            c,
            action,
            method: req.method,
            url,
            json,
            res,
            audit,
            u,
            key: cursorKey,
            currentConfigurationSHA256: policyCapsule.sha256,
          })
        )
          return;
        if (
          viewerRoute({
            db,
            c,
            u,
            action,
            method: req.method,
            url,
            key: cursorKey,
            storage,
            json,
            res,
            audit,
          })
        )
          return;
        if (
          continuityRoute({
            key: cursorKey,
            db,
            c,
            u,
            action,
            method: req.method,
            url,
            json,
            res,
            audit,
            body,
            tx,
          })
        )
          return;
        if (
          lifecycleRoute({
            db,
            c,
            u,
            action,
            method: req.method,
            url,
            key: cursorKey,
            json,
            res,
          })
        )
          return;
        if (action === "domain-records" && req.method === "GET") {
          const kind = url.searchParams.get("kind");
          if (!["instruments", "documents"].includes(kind))
            fail(400, "Invalid domain record kind");
          const page = paginate(db, {
            table: kind + " t",
            where:
              kind === "documents"
                ? "t.case_id=?"
                : "EXISTS(SELECT 1 FROM case_instruments i WHERE i.instrument_id=t.id AND i.case_id=?)",
            params: [id],
            url,
            scope: u.id + "|" + u.role + "|domain|" + id + "|" + kind,
            key: cursorKey,
          });
          json(res, 200, {
            ...page,
            items: page.items.map((r) =>
              kind === "instruments" ? { ...r, data: JSON.parse(r.data) } : r,
            ),
          });
          return;
        }
        if (action === "jobs" && req.method === "GET") {
          const page = paginate(db, {
            table: "jobs t",
            where: "t.case_id=?",
            params: [id],
            url,
            scope: u.id + "|" + u.role + "|jobs|" + id,
            key: cursorKey,
          });
          res.setHeader("X-Next-Cursor", page.nextCursor || "");
          json(res, 200, page.items);
          return;
        }
        if (action?.startsWith("jobs/") && req.method === "GET") {
          const job = db
            .prepare("SELECT * FROM jobs WHERE case_id=? AND id=?")
            .get(id, action.slice(5));
          if (!job) fail(404, "Job not found");
          json(res, 200, job);
          return;
        }
        if (["history", "audit"].includes(action) && req.method === "GET") {
          const page = paginate(db, {
            table: action === "history" ? "evidence t" : "audit t",
            where: "t.case_id=?",
            params: [id],
            url,
            scope: u.id + "|" + u.role + "|" + action + "|" + id,
            key: cursorKey,
            descending: true,
          });
          if (action === "history") page.items = page.items.map(decodeEvidence);
          json(res, 200, page);
          return;
        }
        if (!action && req.method === "GET") {
          const evidencePage = paginate(db, {
              table: "evidence t",
              where: "t.case_id=?",
              params: [id],
              url,
              scope: u.id + "|" + u.role + "|history|" + id,
              key: cursorKey,
              descending: true,
            }),
            auditPage = paginate(db, {
              table: "audit t",
              where: "t.case_id=?",
              params: [id],
              url: new URL("/", "http://localhost"),
              scope: u.id + "|" + u.role + "|audit|" + id,
              key: cursorKey,
              descending: true,
            });
          json(res, 200, {
            ...c,
            instrument: JSON.parse(c.instrument),
            obligation: JSON.parse(c.obligation),
            domain: domainSnapshot(db, id),
            history: evidencePage.items.map(decodeEvidence),
            historyPage: { nextCursor: evidencePage.nextCursor },
            currentEvidence: [
              ...history(id),
              decodeEvidence(latestFDR(db, id)),
            ].filter(Boolean),
            audit: auditPage.items,
            auditPage: { nextCursor: auditPage.nextCursor },
          });
          return;
        }
        if (action?.startsWith("documents/") && req.method === "GET") {
          const e = decodeEvidence(
            db
              .prepare(
                "SELECT * FROM evidence WHERE case_id=? AND id=? AND kind='document'",
              )
              .get(id, action.slice(10)),
          );
          if (!e) fail(404, "Document not found");
          const b = storage.read(e.id);
          if (hash(b) !== e.payload.sha256) fail(409, "Integrity failure");
          if (
            e.payload.mime === "application/pdf" &&
            url.searchParams.get("preview") === "1"
          ) {
            const page = Number(url.searchParams.get("page") || 1);
            if (!Number.isInteger(page) || page < 1 || page > 5)
              fail(400, "Invalid PDF page");
            if (activeValidators >= 2)
              fail(429, "Preview capacity reached; retry");
            activeValidators++;
            let result;
            try {
              result = JSON.parse(
                (
                  await exec(
                    process.execPath,
                    [
                      "--max-old-space-size=256",
                      join(root, "src", "pdf-preview-worker.js"),
                      storage.path(e.id),
                      "preview:" + page,
                    ],
                    { timeout: 15000, maxBuffer: 16777216, windowsHide: true },
                  )
                ).stdout,
              );
            } catch (error) {
              if (error.killed || error.code === "ETIMEDOUT")
                fail(
                  503,
                  "PDF preview timed out; retry when capacity is available",
                );
              fail(400, "PDF preview unavailable");
            } finally {
              activeValidators--;
            }
            reauthorize();
            if (hash(storage.read(e.id)) !== e.payload.sha256)
              fail(409, "Integrity failure");
            res.setHeader("Content-Type", "image/png");
            res.setHeader("X-Document-Pages", String(result.pages));
            res.setHeader("X-Document-Font-Mode", result.rendering.fontMode);
            res.setHeader(
              "X-Document-Viewport",
              JSON.stringify(result.viewport),
            );
            audit(u.id, "document_preview", id, {
              documentVersionId: e.id,
              page,
              fontMode: result.rendering.fontMode,
            });
            res.end(Buffer.from(result.png, "base64"));
            return;
          }
          res.setHeader("Content-Type", e.payload.mime);
          res.setHeader(
            "Content-Disposition",
            (url.searchParams.get("preview") === "1" &&
            e.payload.mime !== "application/pdf"
              ? "inline"
              : "attachment") +
              '; filename="evidence.' +
              (e.payload.mime === "image/png"
                ? "png"
                : e.payload.mime === "image/jpeg"
                  ? "jpg"
                  : e.payload.mime === "application/pdf"
                    ? "pdf"
                    : "txt") +
              '"',
          );
          audit(u.id, "document_read", id, { evidenceId: e.id });
          res.end(b);
          return;
        }
        if (req.method !== "POST") fail(405, "Method not allowed");
        const institution = () => {
            if (!isInstitution(u)) fail(403, "Institution role required");
          },
          officer = () => {
            if (!isReviewer(u)) fail(403, "Officer role required");
          };
        if (action === "policy-evaluate") {
          officer();
          if (
            body.policyBasis !== undefined &&
            !["recorded", "current"].includes(body.policyBasis)
          )
            fail(400, "Unsupported policy replay basis");
          if (
            typeof body.asOf !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(body.asOf) ||
            !Number.isFinite(Date.parse(body.asOf)) ||
            new Date(body.asOf).toISOString().slice(0, 10) !== body.asOf
          )
            fail(400, "Valid historical evaluation date required");
          let eid;
          tx(() => {
            let sourceId = body.evaluationId;
            if (!sourceId) {
              const latest = db
                .prepare(
                  "SELECT id,payload FROM evidence WHERE case_id=? AND kind='evaluation' ORDER BY rowid DESC LIMIT 1",
                )
                .get(id);
              const inputRevision = db
                .prepare(
                  "SELECT input_revision FROM case_operations WHERE case_id=?",
                )
                .get(id).input_revision;
              sourceId =
                latest &&
                JSON.parse(latest.payload).inputRevision === inputRevision
                  ? latest.id
                  : reevaluate(u.id, c);
            }
            eid = evidence(
              u.id,
              id,
              "evaluation_replay",
              replayPolicySnapshot(db, id, sourceId, body.asOf, {
                policies,
                scope: policyScope,
                verifiedSourceHashes,
                capsule: policyCapsule,
                basis:
                  body.policyBasis ||
                  (body.evaluationId ? "recorded" : "current"),
              }),
            );
          });
          json(res, 201, { evaluationId: eid });
          return;
        }
        if (action === "instruments") {
          institution();
          let result;
          tx(() => {
            result = addInstrument(db, u, c, body);
            evidence(u.id, id, "instrument_registered", result);
            refresh(u.id, c);
          });
          json(res, 201, result);
          return;
        }
        if (action === "instrument-primary") {
          institution();
          if (body.revision !== c.revision) fail(409, "Stale case revision");
          const record = db
            .prepare(
              "SELECT i.* FROM instruments i JOIN case_instruments x ON x.instrument_id=i.id WHERE x.case_id=? AND i.id=?",
            )
            .get(id, body.instrumentId);
          if (!record) fail(404, "Linked instrument not found");
          if (!body.reason?.trim()) fail(400, "Reason required");
          tx(() => {
            db.prepare(
              "UPDATE case_domains SET instrument_id=?,revision=revision+1 WHERE case_id=?",
            ).run(record.id, id);
            db.prepare(
              "UPDATE cases SET instrument=?,revision=revision+1 WHERE id=?",
            ).run(record.data, id);
            evidence(u.id, id, "instrument_primary", {
              before: JSON.parse(c.instrument),
              after: JSON.parse(record.data),
              instrumentId: record.id,
              reason: body.reason,
            });
            refresh(u.id, db.prepare("SELECT * FROM cases WHERE id=?").get(id));
          });
          json(res, 200, { ok: true });
          return;
        }

        if (["lifecycle", "assignment", "instrument-links"].includes(action)) {
          let result;
          tx(() => {
            result =
              action === "lifecycle"
                ? transition(db, u, c, body)
                : action === "assignment"
                  ? assignOfficer(db, u, c, body)
                  : linkInstruments(db, u, c, body);
            evidence(u.id, id, action, result);
            refresh(u.id, db.prepare("SELECT * FROM cases WHERE id=?").get(id));
          });
          json(res, 200, result);
          return;
        }

        if (action === "regulatory-context") {
          institution();
          let context;
          try {
            context = validateContext(body.context);
          } catch (e) {
            fail(400, e.message);
          }
          if (body.revision !== c.revision) fail(409, "Stale case revision");
          tx(() => {
            db.prepare("UPDATE cases SET revision=revision+1 WHERE id=?").run(
              id,
            );
            evidence(u.id, id, "regulatory_context", {
              context,
              claimedBy: u.id,
            });
            c = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
            refresh(u.id, c);
          });
          json(res, 201, { ok: true });
          return;
        }
        if (action === "proof-reviews") {
          officer();
          const allowed = [
            "applicability",
            "government_status",
            "prior_regulator",
            "ugc_recognition",
            "prior_release_noc",
            "special_category",
            "payment_affidavit3",
          ];
          const ctx = history(id)
            .filter((e) => e.kind === "regulatory_context")
            .at(-1);
          if (
            !ctx ||
            body.contextId !== ctx.id ||
            !allowed.includes(body.type) ||
            !["accepted", "rejected"].includes(body.decision) ||
            typeof body.reason !== "string" ||
            !body.reason.trim() ||
            body.reason.length > 2000 ||
            typeof body.documentId !== "string" ||
            !db
              .prepare(
                "SELECT id FROM evidence WHERE case_id=? AND id=? AND kind='document'",
              )
              .get(id, body.documentId)
          )
            fail(
              400,
              "Current context, source document, decision, type and reason required",
            );
          tx(() => {
            evidence(u.id, id, "proof_review", {
              contextId: ctx.id,
              documentId: body.documentId,
              type: body.type,
              decision: body.decision,
              reason: body.reason,
              reviewedBy: u.id,
            });
            refresh(u.id, c);
          });
          json(res, 201, { ok: true });
          return;
        }
        if (action === "ifsc") {
          const ref = await ifscProvider.lookup(JSON.parse(c.instrument).ifsc);
          reauthorize();
          if (
            db.prepare("SELECT revision FROM cases WHERE id=?").get(id)
              .revision !== c.revision
          )
            fail(409, "Declaration changed; retry lookup");
          tx(() => {
            evidence(u.id, id, "ifsc_reference", ref);
            refresh(u.id, c);
          });
          json(res, 200, ref);
          return;
        }
        if (action === "sandbox-consent") {
          institution();
          const provider = new SetuSandboxProvider();
          if (!provider.configured) {
            json(res, 503, {
              error: "Setu sandbox is not configured",
              status: "unavailable",
            });
            return;
          }
          let r;
          try {
            r = await provider.createConsent(body);
          } catch {
            fail(502, "Sandbox consent request failed or invalid");
          }
          reauthorize();
          tx(() => {
            evidence(u.id, id, "sandbox_consent", {
              ...r,
              dataRange: body.dataRange,
            });
            refresh(u.id, db.prepare("SELECT * FROM cases WHERE id=?").get(id));
          });
          json(res, 201, r);
          return;
        }
        if (action === "sandbox-session") {
          institution();
          if (typeof body.consentId !== "string")
            fail(400, "Consent ID required");
          const consent = db
            .prepare(
              "SELECT id FROM evidence WHERE case_id=? AND kind='sandbox_consent' AND json_extract(payload,'$.id')=?",
            )
            .get(id, body.consentId);
          if (!consent) fail(404, "Consent is not bound to this case");
          let r;
          try {
            r = await new SetuSandboxProvider().createSession(
              body.consentId,
              body.dataRange,
            );
          } catch {
            fail(502, "Sandbox session unavailable or consent invalid");
          }
          reauthorize();
          tx(() => {
            evidence(u.id, id, "sandbox_session", r);
            refresh(u.id, db.prepare("SELECT * FROM cases WHERE id=?").get(id));
          });
          json(res, 201, r);
          return;
        }
        if (action === "sandbox-evidence") {
          officer();
          if (
            typeof body.consentId !== "string" ||
            typeof body.sessionId !== "string"
          )
            fail(400, "Consent and session IDs required");
          const session = db
            .prepare(
              "SELECT id FROM evidence WHERE case_id=? AND kind='sandbox_session' AND json_extract(payload,'$.id')=? AND json_extract(payload,'$.consentId')=?",
            )
            .get(id, body.sessionId, body.consentId);
          if (!session) fail(404, "Session is not bound to this case");
          const r = await new SetuSandboxProvider().retrieve(body);
          reauthorize();
          if (
            db.prepare("SELECT revision FROM cases WHERE id=?").get(id)
              .revision !== c.revision
          )
            fail(409, "Declaration changed; retry provider retrieval");
          tx(() => {
            evidence(u.id, id, "external", {
              ...r,
              instrumentId: db
                .prepare(
                  "SELECT instrument_id FROM case_domains WHERE case_id=?",
                )
                .get(id).instrument_id,
            });
            refresh(u.id, c);
          });
          json(res, 200, r);
          return;
        }

        if (action === "documents") {
          institution();
          if (
            typeof body.base64 !== "string" ||
            body.base64.length > 6 * 1024 * 1024 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)
          )
            fail(400, "Invalid file");
          const b = Buffer.from(body.base64, "base64");
          if (!b.length || b.length > 4 * 1024 * 1024)
            fail(413, "File must be 1 byte to 4 MiB");
          const mime = b
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              ? "image/png"
              : b[0] === 255 && b[1] === 216 && b[2] === 255
                ? "image/jpeg"
                : b.subarray(0, 5).toString() === "%PDF-"
                  ? "application/pdf"
                  : null,
            text =
              body.mime === "text/plain" &&
              !b.includes(0) &&
              !b.toString("utf8").includes("\uFFFD");
          if (!mime && !text)
            fail(400, "Only PDF, PNG, JPEG or UTF-8 text accepted");
          const eid = randomUUID(),
            p = {
              sha256: hash(b),
              mime: mime || "text/plain",
              bytes: b.length,
            };
          storage.write(eid, b);
          try {
            const duplicate = db
              .prepare(
                "SELECT v.id FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE d.case_id=? AND v.sha256=? ORDER BY v.rowid LIMIT 1",
              )
              .get(id, p.sha256);
            if (duplicate) p.duplicateOf = duplicate.id;
            if (mime) {
              if (activeValidators >= 2)
                fail(429, "Image validation capacity reached; retry");
              activeValidators++;
              try {
                await exec(
                  process.execPath,
                  [
                    "--max-old-space-size=256",
                    join(
                      root,
                      "src",
                      mime === "application/pdf"
                        ? "pdf-worker.js"
                        : "image-validator.js",
                    ),
                    storage.path(eid),
                    mime === "application/pdf" ? "validate" : mime,
                  ],
                  {
                    timeout: 10000,
                    maxBuffer: 1000,
                    windowsHide: true,
                    env: { ...process.env, DISABLE_SYSTEM_FONTS_LOAD: "1" },
                  },
                );
              } catch (error) {
                if (error.killed || error.code === "ETIMEDOUT")
                  fail(
                    503,
                    "Document validation timed out; retry when processing capacity is available",
                  );
                fail(400, "Invalid or oversized document content");
              } finally {
                activeValidators--;
              }
              reauthorize();
              c = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
            }
            tx(() => {
              Object.assign(p, prepareDocument(db, c, body));
              db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?)").run(
                eid,
                id,
                "document",
                JSON.stringify(p),
                new Date().toISOString(),
                u.id,
              );
              registerVersion(db, eid, p, u);
              audit(u.id, "document_uploaded", id, { evidenceId: eid });
              refresh(u.id, c);
            });
          } catch (e) {
            try {
              storage.remove(eid);
            } catch {
              audit(u.id, "storage_cleanup_failed", id, {
                documentVersionId: eid,
              });
            }
            throw e;
          }
          json(res, 201, { id: eid, ...p });
          return;
        }
        if (action === "process") {
          institution();
          const fd = latestFDR(db, id),
            d = fd ? { ...fd, payload: JSON.parse(fd.payload) } : null;
          if (!d) fail(409, "Upload first");
          if (hash(storage.read(d.id)) !== d.payload.sha256)
            fail(409, "Document integrity failure");
          if (
            db
              .prepare("SELECT count(*) n FROM jobs WHERE status='processing'")
              .get().n >= 2
          )
            fail(429, "OCR capacity reached; retry later");
          if (
            db
              .prepare(
                "SELECT id FROM jobs WHERE document_id=? AND status='processing'",
              )
              .get(d.id)
          )
            fail(409, "Document already processing");
          const extractionHead = history(id)
            .filter((e) => e.kind === "extraction")
            .at(-1)?.id;
          const jid = randomUUID();
          db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?)").run(
            jid,
            id,
            d.id,
            "processing",
            null,
            new Date().toISOString(),
          );
          audit(u.id, "processing_started", id, { jobId: jid });
          const processDocument = async () => {
            const start = performance.now();
            let text = "",
              method = "text-import",
              status = "completed",
              error = null,
              raw = null;
            try {
              if (d.payload.mime === "text/plain")
                text = storage.read(d.id).toString("utf8");
              else if (d.payload.mime === "application/pdf") {
                method = "pdf-text-or-ocr";
                const r = await exec(
                  process.execPath,
                  [
                    "--max-old-space-size=384",
                    join(root, "src", "pdf-worker.js"),
                    storage.path(d.id),
                    "process",
                  ],
                  { timeout: 60000, maxBuffer: 4194304, windowsHide: true },
                );
                raw = JSON.parse(r.stdout);
                text = raw.text;
              } else {
                method = ocr ? "tesseract-native" : "tesseract-wasm";
                const r =
                  !ocr && ocrRunner === exec
                    ? {
                        stdout: JSON.stringify(
                          await ocrPool.run(storage.path(d.id)),
                        ),
                      }
                    : await ocrRunner(
                        ocr || process.execPath,
                        ocr
                          ? [storage.path(d.id), "stdout", "--psm", "6"]
                          : [
                              join(root, "src", "ocr-worker.js"),
                              storage.path(d.id),
                            ],
                        {
                          timeout: 60000,
                          maxBuffer: 4194304,
                          windowsHide: true,
                        },
                      );
                if (ocr) {
                  text = r.stdout;
                  raw = { text, blocks: [], engine: "native-tesseract" };
                } else {
                  raw = JSON.parse(r.stdout);
                  text = raw.text;
                }
              }
            } catch {
              status = "failed";
              error = "OCR unavailable, timed out or rejected document";
            }
            try {
              if (hash(storage.read(d.id)) !== d.payload.sha256)
                fail(409, "Document integrity changed during processing");
            } catch (e) {
              db.prepare(
                "UPDATE jobs SET status='failed',error='Document integrity changed or unavailable' WHERE id=?",
              ).run(jid);
              audit(u.id, "processing_failed", id, {
                jobId: jid,
                documentVersionId: d.id,
              });
              throw e;
            }
            if (latestFDR(db, id)?.id !== d.id) {
              db.prepare("UPDATE jobs SET status='superseded' WHERE id=?").run(
                jid,
              );
              fail(409, "Document changed; retry");
            }
            try {
              reauthorize();
            } catch (e) {
              db.prepare(
                "UPDATE jobs SET status='failed',error='Authorization changed' WHERE id=?",
              ).run(jid);
              throw e;
            }
            const newerExtraction = history(id)
              .filter((e) => e.kind === "extraction")
              .at(-1)?.id;
            if (newerExtraction !== extractionHead) {
              tx(() => {
                db.prepare(
                  "UPDATE jobs SET status='superseded' WHERE id=?",
                ).run(jid);
                evidence(u.id, id, "processing_superseded", {
                  documentId: d.id,
                  jobId: jid,
                  raw,
                  reason: "Extraction corrected while OCR was running",
                });
              });
              fail(
                409,
                "Extraction changed during processing; result preserved as superseded",
              );
            }
            c = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
            const p = {
              documentId: d.id,
              fields: extract(text, {
                blocks: raw?.blocks,
                pages: raw?.pages,
                fieldAttempts: raw?.fieldAttempts,
                documentVersionId: d.id,
                processedAt: new Date().toISOString(),
              }),
              raw,
              method,
              status,
              error,
              durationMs: performance.now() - start,
            };
            tx(() => {
              db.prepare("UPDATE jobs SET status=?,error=? WHERE id=?").run(
                status,
                error,
                jid,
              );
              evidence(u.id, id, "extraction", { ...p, jobId: jid });
              refresh(u.id, c);
            });
            return p;
          };
          if (body.background === true) {
            const task = processDocument()
              .catch((e) => {
                db.prepare(
                  "UPDATE jobs SET status='failed',error='Background processing failed' WHERE id=? AND status='processing'",
                ).run(jid);
                audit(u.id, "processing_failed", id, {
                  jobId: jid,
                  status: e.status || 500,
                });
              })
              .finally(() => pendingJobs.delete(task));
            pendingJobs.add(task);
            json(res, 202, { jobId: jid, status: "processing" });
          } else json(res, 200, await processDocument());
          return;
        }

        if (action === "extraction-corrections") {
          if (!isInstitution(u) && !isReviewer(u))
            fail(403, "Evidence reviewer permission required");
          const previous = history(id)
              .filter((e) => e.kind === "extraction")
              .at(-1),
            doc = (() => {
              const e = latestFDR(db, id);
              return e ? { ...e, payload: JSON.parse(e.payload) } : null;
            })();
          if (
            !previous ||
            previous.id !== body.extractionId ||
            previous.payload.documentId !== doc?.id
          )
            fail(409, "Extraction changed or missing; reload");
          if (
            typeof body.reason !== "string" ||
            !body.reason.trim() ||
            body.reason.length > 2000 ||
            !body.values ||
            typeof body.values !== "object" ||
            Array.isArray(body.values) ||
            !Object.keys(body.values).length
          )
            fail(400, "Field values and reason required");
          let values;
          try {
            if (
              Object.keys(body.values).some(
                (k) =>
                  ![
                    "reference",
                    "amountPaise",
                    "bank",
                    "ifsc",
                    "issued",
                    "matures",
                    "institutionName",
                    "depositor",
                    "branch",
                    "currency",
                    "type",
                  ].includes(k),
              )
            )
              throw Error("Unsupported field");
            values = validate({ ...JSON.parse(c.instrument), ...body.values });
          } catch (e) {
            fail(400, e.message);
          }
          const fields = { ...previous.payload.fields };
          for (const k of Object.keys(body.values))
            fields[k] = {
              ...fields[k],
              status: "HUMAN_CORRECTED",
              engineConfidence: null,
              reasons: [],
              value: values[k],
              confidence: null,
              method: "human-correction",
              previousValue: fields[k]?.value ?? null,
              sourceExtractionId: previous.id,
              reason: body.reason,
            };
          tx(() => {
            evidence(u.id, id, "extraction", {
              documentId: doc.id,
              fields,
              method: "human-correction",
              status: "completed",
              correctedFrom: previous.id,
              reason: body.reason,
            });
            refresh(u.id, c);
          });
          json(res, 201, { ok: true });
          return;
        }

        if (action === "corrections") {
          institution();
          let inst;
          try {
            inst = validate({
              ...JSON.parse(c.instrument),
              ...body.instrument,
            });
          } catch (e) {
            fail(400, e.message);
          }
          if (
            !Number.isInteger(body.revision) ||
            typeof body.reason !== "string" ||
            !body.reason.trim() ||
            body.reason.length > 2000
          )
            fail(400, "Revision and reason required");
          tx(() => {
            if (
              !db
                .prepare(
                  "UPDATE cases SET instrument=?,revision=revision+1 WHERE id=? AND revision=?",
                )
                .run(JSON.stringify(inst), id, body.revision).changes
            )
              fail(409, "Concurrent edit; reload");
            evidence(u.id, id, "correction", {
              before: JSON.parse(c.instrument),
              after: inst,
              reason: body.reason,
            });
            const oldReference = JSON.parse(c.instrument).reference;
            c = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
            refresh(u.id, c, oldReference);
          });
          json(res, 200, { ok: true });
          return;
        }
        if (action === "external") {
          officer();
          if (!mockScenarios.includes(body.scenario))
            fail(400, "Unknown scenario");
          const inst = JSON.parse(c.instrument),
            p = await depositProvider.retrieve(inst, body.scenario);
          reauthorize();
          if (
            db.prepare("SELECT revision FROM cases WHERE id=?").get(id)
              .revision !== c.revision
          )
            fail(409, "Declaration changed during provider request; retry");
          tx(() => {
            evidence(u.id, id, "external", {
              ...p,
              instrumentId: db
                .prepare(
                  "SELECT instrument_id FROM case_domains WHERE case_id=?",
                )
                .get(id).instrument_id,
            });
            refresh(u.id, c);
          });
          json(res, 200, p);
          return;
        }
        if (["clarifications", "responses", "observations"].includes(action)) {
          if (action === "responses") institution();
          else officer();
          if (
            typeof body.text !== "string" ||
            !body.text.trim() ||
            body.text.length > 4000
          )
            fail(400, "Text required, max 4000 characters");
          if (
            action === "responses" &&
            (typeof body.requestId !== "string" ||
              !db
                .prepare(
                  "SELECT id FROM evidence WHERE case_id=? AND kind='clarifications' AND id=?",
                )
                .get(id, body.requestId))
          )
            fail(400, "Valid requestId required");
          tx(() => {
            const conversation = evidence(u.id, id, action, {
              text: body.text,
              requestId: body.requestId ?? null,
              findingCode: body.findingCode ?? null,
              fields: body.fields ?? [],
              documents: body.documents ?? [],
              deadline: body.deadline ?? null,
            });
            recordConversation(db, u, c, action, body, conversation);
            refresh(u.id, c);
          });
          json(res, 201, { ok: true });
          return;
        }
        if (action === "evaluate") {
          json(res, 201, { id: tx(() => refresh(u.id, c)) });
          return;
        }
        fail(404, "Not found");
      } catch (e) {
        try {
          audit(
            ctx.actor,
            e.status && e.status < 500 ? "request_denied" : "request_failed",
            null,
            { status: e.status || 500 },
          );
        } catch {}
        if (!res.headersSent)
          json(res, e.status || 500, {
            error: e.status ? e.message : "Internal service failure",
          });
        else res.end();
      }
    });
  });
  server.requestTimeout = 70000;
  server.headersTimeout = 10000;
  let reminderPosition = 0;
  const reminderTimer = setInterval(() => {
    let event;
    try {
      const result = tx(() =>
        runReminderBatch(db, { after: reminderPosition }),
      );
      reminderPosition = result.next;
      event = { category: "reminder_scheduler", outcome: "SUCCESS", ...result };
    } catch (error) {
      event = {
        category: "reminder_scheduler",
        outcome: "FAILURE",
        errorCode: /^[A-Z_0-9]{1,80}$/.test(String(error.code))
          ? error.code
          : "INTERNAL_ERROR",
      };
    }
    try {
      logSink(event);
    } catch {}
  }, 60000);
  reminderTimer.unref();
  return {
    server,
    db,
    close: () =>
      new Promise((done) =>
        server.close(async () => {
          clearInterval(reminderTimer);
          ocrPool.close();
          await Promise.allSettled([...pendingJobs]);
          try {
            auditIntegrity.checkpoint();
          } catch {
          } finally {
            try {
              db.close();
            } catch {}
          }
          releaseLock();
          done();
        }),
      ),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createApp();
  if (!app.db.prepare("SELECT count(*) n FROM users").get().n) {
    console.error("Run node scripts/setup.js first");
    await app.close();
    process.exitCode = 1;
  } else
    app.server.listen(
      Number(process.env.PORT || 3000),
      process.env.APP_HOST || "127.0.0.1",
      () =>
        console.log(
          "FDR Sentinel: http://127.0.0.1:" + (process.env.PORT || 3000),
        ),
    );
}
