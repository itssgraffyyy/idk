> Current Phase3-4 extensions: [API additions](api-phase-3-4.md). Existing baseline tables below are historical; later role, viewer, clearance and security contracts supersede conflicting statements.

> Current status: see [audit update](audit-status-update.md) and [completion report](phase-1-2-completion-report.md). Baseline descriptions below are retained for history.

# API and frontend

## Current extensions — 27 October 2026

Roles are `institution`, `institution_admin`, `officer`, `supervisor`, `audit_reviewer`. Institution users operate in their own tenant; officers read assigned cases; supervisors and auditors read only their authority's assigned cases. Auditors cannot mutate. Account administrators cannot elevate outside their permitted role family. Shared client types are in `src/contracts.d.ts`; runtime envelopes and domain validators enforce server boundaries.

| Method | Endpoint | Current contract |
|---|---|---|
| POST | `/api/institution` | Revisioned name/classification/programmes/approvals profile; creation revision 0 |
| GET/POST | `/api/accounts` | Tenant-scoped permitted-role account create or status/role administration; responses omit password hashes |
| GET/POST | `/api/obligations[/:id]` | Independent programme/level/amountPaise/policyVersion/starts/ends/exemption/status records; revisions guard amendments |
| POST | `/api/cases/:id/instruments` | Register validated independent linked instrument |
| POST | `/api/cases/:id/instrument-primary` | `{instrumentId,revision,reason}` selects linked instrument; preserves evidence bindings |
| POST | `/api/cases/:id/instrument-links` | `{predecessor,successor,revision,reason}`; tenant/obligation/cycle guards |
| POST | `/api/cases/:id/lifecycle` | `{action,revision,reason}` guarded initial administrative transition |
| POST | `/api/cases/:id/assignment` | Supervisor only: `{officerId,revision,reason}` |
| GET | `/api/cases/:id/domain-records?kind=instruments|documents` | Authorized bounded pages of independent records |
| GET | `/api/cases/:id/history` or `/audit` | `{items,nextCursor}`; all earlier history remains accessible |
| POST | `/api/cases/:id/documents` | `{base64,mime,kind?,documentId?,instrumentId?}`; `documentId` identifies a logical document, response `id` is the immutable version/evidence UUID |
| GET | `/api/cases/:id/documents/:versionId?preview=1&page=1` | Private PDF-to-PNG preview; page and resource bounds; raw PDF download without preview query |
| POST | `/api/cases/:id/process` | `{background:true}` returns 202 `{jobId,status}`; omitted background retains awaited-result compatibility |
| GET | `/api/cases/:id/jobs/:jobId` | Authorized durable status; completed/failed/superseded/interrupted |
| POST | `/api/cases/:id/policy-evaluate` | Reviewer-only `{asOf:YYYY-MM-DD,evaluationId?}` appends policy replay over current facts or the selected immutable evaluation snapshot; leaves current evaluation unchanged |

List endpoints accept `limit` 1–100 and signed `cursor`. Cases also accept `q` and lifecycle `status`. Array endpoints expose `X-Next-Cursor`; cases expose exact `X-Total-Count` and `X-Total-Paise`. History/domain pages return cursors in JSON. Cursors are actor/role/tenant/filter/case scoped, expire on server restart, and reject mismatches with 400. New rows are excluded from an existing pagination snapshot. Detail returns recent 50 evidence/audit events and separate `currentEvidence`, avoiding loss of current facts when history is paged.

Every response has `X-Request-ID`; audit records link the same correlation ID, category and outcome. Policies cannot be activated through client bodies. Trusted operator configuration may load `POLICY_FILE`, with real official policies still requiring independent issuer/source confirmation. Automated compliance outcomes are distinct from administrative approval.

Frozen replay reuses the selected evaluation's instrument, context and proof references. It records `FROZEN_FACTS_POLICY_ONLY`, its original `financialAssessmentAsOf`, and `replays`/`sourceReferences.replaySource`. The selected policy is reevaluated; historical financial findings remain attributed to their source evaluation. This does not claim bank revalidation or reconstruction of facts that were never recorded.

## Historical baseline endpoint summary
Frontend route / serves login, registry and case views according to authenticated role. It is one buildless application, not separately routed demo screens.

All endpoints use JSON except protected downloads. Money uses integer paise. POSTs require X-CSRF-Token from login/me and same-origin browser requests. Cookie auth is HttpOnly. Errors return {error}; internal details are suppressed.

| Method | Endpoint | Behavior |
|---|---|---|
| POST | /api/login | Email/password; returns role and CSRF; sets session cookie |
| GET | /api/me | Current session |
| POST | /api/logout | Revoke current session |
| GET | /api/institution | Own registered institution profile |
| GET | /api/cases | Tenant records or officer assignments |
| POST | /api/cases | Institution: {name, obligation:{amountPaise}, instrument:{reference,amountPaise,bank,ifsc,issued,matures}} |
| GET | /api/cases/:id | Authorized facts, evidence and audit history |
| POST | /api/cases/:id/documents | Institution: {base64,mime}; 4 MiB decoded limit |
| GET | /api/cases/:id/documents/:documentId | Authorized hashed download; ?preview=1 permits inline preview |
| POST | /api/cases/:id/process | Process latest source; await bounded OCR result; job persisted |
| GET | /api/cases/:id/jobs | Authorized processing states |
| POST | /api/cases/:id/corrections | Institution: {instrument,revision,reason}; 409 on stale edit |
| POST | /api/cases/:id/extraction-corrections | Institution: {extractionId,values,reason}; append corrected extraction |
| POST | /api/cases/:id/external | Assigned officer: {scenario: unavailable/mock_confirmed/mock_conflict} |
| POST | /api/cases/:id/evaluate | Append an evaluation; refresh related duplicate cases |
| POST | /api/cases/:id/clarifications | Assigned officer: {text} |
| POST | /api/cases/:id/observations | Assigned officer: {text} |
| POST | /api/cases/:id/responses | Institution: {requestId,text} |
| GET | /api/ifsc?code= | Versioned legitimate public IFSC reference adapter with pinned offline fallback; never authenticates a deposit |
| GET | /api/policies | Active unverified policy registry |

Examples of statuses: 400 invalid input/file, 401 authentication, 403 role/CSRF/origin, 404 inaccessible object, 409 stale correction/source change, 413 oversized request, 429 login/OCR capacity, 500 generic service failure. No delete API exists. API supports synthetic/private development only.

Final-gap update: PDF is accepted as a private, bounded input; PDFs are always attachment downloads, including preview requests. GET /api/health is unauthenticated minimal liveness. GET /api/ready returns200 when the database can answer and503 otherwise. Disabled accounts cannot login or use sessions; migration6 revokes their existing sessions. See final-gap audit and security audit for actual limits.
