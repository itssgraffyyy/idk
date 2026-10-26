import { SetuSandboxProvider } from "./setu.js";
import { assessAICTE, ruleRegister, validateContext } from "./regulatory.js";
import {
  verifyPassword,
  acquireLock,
  permittedHost,
  requestLimiter,
} from "./security.js";
import { IFSCProvider } from "./ifsc.js";
import { DevelopmentDepositProvider, lookupIFSC } from "./financial.js";
import { registry as policyRegistry } from "./policy.js";
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { openStore, password, hash } from "./store.js";
import { validate, evaluate, extract } from "./engine.js";
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
    db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)").run(
      u.id,
      u.email,
      password(u.password),
      u.role,
      u.tenant,
    );
}
export function createApp({
  dir = resolve(process.env.DATA_DIR || "data"),
  ocr = process.env.TESSERACT_PATH || null,
  ocrRunner = exec,
  depositProvider = new DevelopmentDepositProvider(),
  ifscProvider = new IFSCProvider(),
} = {}) {
  mkdirSync(dir, { recursive: true });
  const releaseLock = acquireLock(dir);
  let db;
  try {
    db = openStore(dir);
  } catch (e) {
    releaseLock();
    throw e;
  }
  mkdirSync(join(dir, "private"), { recursive: true });
  const rates = new Map(),
    limitRequest = requestLimiter();
  let activeValidators = 0;
  const audit = (u, a, id, p = {}) =>
    db
      .prepare(
        "INSERT INTO audit(actor,action,case_id,payload,created) VALUES(?,?,?,?,?)",
      )
      .run(u, a, id ?? null, JSON.stringify(p), new Date().toISOString());
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
    audit(u, kind, id, { evidenceId: eid });
    return eid;
  }
  db.prepare(
    "UPDATE jobs SET status='interrupted',error='Service restarted during processing' WHERE status='processing'",
  ).run();
  const history = (id) =>
    db
      .prepare("SELECT * FROM evidence WHERE case_id=? ORDER BY rowid")
      .all(id)
      .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  function reevaluate(u, c) {
    const h = history(c.id),
      last = (k) => h.filter((e) => e.kind === k).at(-1),
      d = last("document"),
      x = last("extraction"),
      b = last("external");
    const context = last("regulatory_context"),
      reviews = h
        .filter(
          (e) =>
            e.kind === "proof_review" && e.payload.contextId === context?.id,
        )
        .map((e) => e.payload),
      proofs = reviews.filter(
        (p, i) =>
          reviews.findLastIndex(
            (x) => x.documentId === p.documentId && x.type === p.type,
          ) === i,
      );
    const r = evaluate({
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
        .prepare("SELECT id,instrument FROM cases WHERE tenant=? AND id!=?")
        .all(c.tenant, c.id)
        .filter(
          (x) =>
            JSON.parse(x.instrument).reference ===
            JSON.parse(c.instrument).reference,
        )
        .map((x) => x.id),
    });
    r.sourceReferences = {
      declaration: last("correction")?.id ?? last("declaration")?.id,
      document: d?.id,
      extraction: x?.id,
      external: b?.id,
      obligationCase: c.id,
      regulatoryContext: context?.id,
      proofReviews: h.filter((e) => e.kind === "proof_review").map((e) => e.id),
    };
    r.version = h.filter((e) => e.kind === "evaluation").length + 1;
    r.supersedes = last("evaluation")?.id ?? null;
    r.caseRevision = c.revision;
    return evidence(u, c.id, "evaluation", r);
  }
  function refresh(u, c, previousRef = null) {
    let target;
    const refs = [JSON.parse(c.instrument).reference, previousRef];
    for (const row of db
      .prepare("SELECT * FROM cases WHERE tenant=?")
      .all(c.tenant))
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
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  const server = http.createServer(async (req, res) => {
    const secure = process.env.COOKIE_SECURE === "true";
    for (const [k, v] of Object.entries({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
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
        ["/", "/app.js", "/review.js", "/style.css"].includes(path)
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
        if (!(await verifyPassword(body.password, u?.password))) {
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
      if (!u || !["institution", "officer"].includes(u.role))
        fail(401, "Authentication required");
      const reauthorize = () => {
        const live = db
          .prepare(
            "SELECT u.role,u.tenant,c.assigned,c.tenant case_tenant FROM users u JOIN cases c ON c.id=? JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.token=? AND s.expires>?",
          )
          .get(id, u.id, hash(token), Date.now());
        if (
          !live ||
          live.role !== u.role ||
          (u.role === "institution"
            ? live.tenant !== live.case_tenant
            : live.assigned !== u.id)
        )
          fail(403, "Authorization changed during processing");
      };
      if (req.method !== "GET" && req.headers["x-csrf-token"] !== u.csrf)
        fail(403, "CSRF required");
      if (path === "/api/me" && req.method === "GET") {
        json(res, 200, {
          id: u.id,
          email: u.email,
          role: u.role,
          csrf: u.csrf,
        });
        return;
      }
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
        json(res, 200, { legacy: policyRegistry, ...ruleRegister });
        return;
      }
      if (path === "/api/institution" && req.method === "GET") {
        if (u.role !== "institution") fail(403, "Institution role required");
        json(
          res,
          200,
          db
            .prepare("SELECT * FROM institutions WHERE tenant=?")
            .get(u.tenant) ?? { tenant: u.tenant, name: null },
        );
        return;
      }
      if (path === "/api/ifsc" && req.method === "GET") {
        const code = url.searchParams.get("code");
        json(res, 200, await ifscProvider.lookup(code));
        return;
      }
      if (path === "/api/cases" && req.method === "GET") {
        json(
          res,
          200,
          db
            .prepare(
              u.role === "officer"
                ? "SELECT * FROM cases WHERE assigned=?"
                : "SELECT * FROM cases WHERE tenant=?",
            )
            .all(u.role === "officer" ? u.id : u.tenant)
            .map((c) => ({
              ...c,
              instrument: JSON.parse(c.instrument),
              obligation: JSON.parse(c.obligation),
            })),
        );
        return;
      }
      if (path === "/api/cases" && req.method === "POST") {
        if (u.role !== "institution") fail(403, "Institution role required");
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
            "SELECT id FROM users WHERE role='officer' ORDER BY id LIMIT 1",
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
          evidence(u.id, id, "declaration", inst);
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
      if (
        !c ||
        (u.role === "institution" ? c.tenant !== u.tenant : c.assigned !== u.id)
      ) {
        audit(u.id, "access_denied", id);
        fail(404, "Case not found");
      }
      if (action === "jobs" && req.method === "GET") {
        json(
          res,
          200,
          db
            .prepare("SELECT * FROM jobs WHERE case_id=? ORDER BY created")
            .all(id),
        );
        return;
      }
      if (!action && req.method === "GET") {
        json(res, 200, {
          ...c,
          instrument: JSON.parse(c.instrument),
          obligation: JSON.parse(c.obligation),
          history: history(id),
          audit: db
            .prepare("SELECT * FROM audit WHERE case_id=? ORDER BY id")
            .all(id),
        });
        return;
      }
      if (action?.startsWith("documents/") && req.method === "GET") {
        const e = history(id).find(
          (e) => e.id === action.slice(10) && e.kind === "document",
        );
        if (!e) fail(404, "Document not found");
        const b = readFileSync(join(dir, "private", e.id));
        if (hash(b) !== e.payload.sha256) fail(409, "Integrity failure");
        res.setHeader("Content-Type", e.payload.mime);
        res.setHeader(
          "Content-Disposition",
          (url.searchParams.get("preview") === "1" ? "inline" : "attachment") +
            '; filename="evidence.' +
            (e.payload.mime === "image/png"
              ? "png"
              : e.payload.mime === "image/jpeg"
                ? "jpg"
                : "txt") +
            '"',
        );
        audit(u.id, "document_read", id, { evidenceId: e.id });
        res.end(b);
        return;
      }
      if (req.method !== "POST") fail(405, "Method not allowed");
      const institution = () => {
          if (u.role !== "institution") fail(403, "Institution role required");
        },
        officer = () => {
          if (u.role !== "officer") fail(403, "Officer role required");
        };

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
          db.prepare("UPDATE cases SET revision=revision+1 WHERE id=?").run(id);
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
          !history(id).some(
            (e) => e.id === body.documentId && e.kind === "document",
          )
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
        const consent = history(id).find(
          (e) =>
            e.kind === "sandbox_consent" && e.payload.id === body.consentId,
        );
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
        const session = history(id).find(
          (e) =>
            e.kind === "sandbox_session" &&
            e.payload.id === body.sessionId &&
            e.payload.consentId === body.consentId,
        );
        if (!session) fail(404, "Session is not bound to this case");
        const r = await new SetuSandboxProvider().retrieve(body);
        reauthorize();
        if (
          db.prepare("SELECT revision FROM cases WHERE id=?").get(id)
            .revision !== c.revision
        )
          fail(409, "Declaration changed; retry provider retrieval");
        tx(() => {
          evidence(u.id, id, "external", r);
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
              : null,
          text =
            body.mime === "text/plain" &&
            !b.includes(0) &&
            !b.toString("utf8").includes("\uFFFD");
        if (!mime && !text) fail(400, "Only PNG, JPEG or UTF-8 text accepted");
        const eid = randomUUID(),
          p = { sha256: hash(b), mime: mime || "text/plain", bytes: b.length };
        writeFileSync(join(dir, "private", eid), b, {
          flag: "wx",
          mode: 0o600,
        });
        try {
          if (mime) {
            if (activeValidators >= 2)
              fail(429, "Image validation capacity reached; retry");
            activeValidators++;
            try {
              await exec(
                process.execPath,
                [
                  "--max-old-space-size=128",
                  join(root, "src", "image-validator.js"),
                  join(dir, "private", eid),
                  mime,
                ],
                { timeout: 10000, maxBuffer: 1000, windowsHide: true },
              );
            } catch {
              fail(400, "Invalid or oversized image content");
            } finally {
              activeValidators--;
            }
            reauthorize();
            c = db.prepare("SELECT * FROM cases WHERE id=?").get(id);
          }
          tx(() => {
            db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?)").run(
              eid,
              id,
              "document",
              JSON.stringify(p),
              new Date().toISOString(),
              u.id,
            );
            audit(u.id, "document_uploaded", id, { evidenceId: eid });
            refresh(u.id, c);
          });
        } catch (e) {
          unlinkSync(join(dir, "private", eid));
          throw e;
        }
        json(res, 201, { id: eid, ...p });
        return;
      }
      if (action === "process") {
        institution();
        const d = history(id)
          .filter((e) => e.kind === "document")
          .at(-1);
        if (!d) fail(409, "Upload first");
        if (hash(readFileSync(join(dir, "private", d.id))) !== d.payload.sha256)
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
        const start = performance.now();
        let text = "",
          method = "text-import",
          status = "completed",
          error = null,
          raw = null;
        try {
          if (d.payload.mime === "text/plain")
            text = readFileSync(join(dir, "private", d.id), "utf8");
          else {
            method = ocr ? "tesseract-native" : "tesseract-wasm";
            const r = await ocrRunner(
              ocr || process.execPath,
              ocr
                ? [join(dir, "private", d.id), "stdout", "--psm", "6"]
                : [
                    join(root, "src", "ocr-worker.js"),
                    join(dir, "private", d.id),
                  ],
              { timeout: 60000, maxBuffer: 4194304, windowsHide: true },
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
        if (
          history(id)
            .filter((e) => e.kind === "document")
            .at(-1)?.id !== d.id
        ) {
          db.prepare("UPDATE jobs SET status='superseded' WHERE id=?").run(jid);
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
            db.prepare("UPDATE jobs SET status='superseded' WHERE id=?").run(
              jid,
            );
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
          fields: extract(text, { blocks: raw?.blocks }),
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
        json(res, 200, p);
        return;
      }

      if (action === "extraction-corrections") {
        institution();
        const previous = history(id)
            .filter((e) => e.kind === "extraction")
            .at(-1),
          doc = history(id)
            .filter((e) => e.kind === "document")
            .at(-1);
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
          inst = validate(body.instrument);
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
        if (
          !["unavailable", "mock_confirmed", "mock_conflict"].includes(
            body.scenario,
          )
        )
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
          evidence(u.id, id, "external", p);
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
          !history(id).some(
            (e) => e.kind === "clarifications" && e.id === body.requestId,
          )
        )
          fail(400, "Valid requestId required");
        tx(() => {
          evidence(u.id, id, action, {
            text: body.text,
            requestId: body.requestId ?? null,
          });
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
      if (!res.headersSent)
        json(res, e.status || 500, {
          error: e.status ? e.message : "Internal service failure",
        });
      else res.end();
    }
  });
  server.requestTimeout = 70000;
  server.headersTimeout = 10000;
  return {
    server,
    db,
    close: () =>
      new Promise((done) =>
        server.close(() => {
          try {
            db.close();
          } catch {}
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
    app.db.close();
    process.exitCode = 1;
  } else
    app.server.listen(Number(process.env.PORT || 3000), "127.0.0.1", () =>
      console.log(
        "FDR Sentinel: http://127.0.0.1:" + (process.env.PORT || 3000),
      ),
    );
}
