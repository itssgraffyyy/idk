# Phase34 API additions

All application APIs require a live session except login/health/readiness. Mutations require CSRF and current role/object authorization. Existing case authorization is institution tenant, assigned officer or same-authority supervisor/auditor; departmental grants permit only their selected request/document surface. Audit reviewers may use their own account security but cannot perform domain writes. Enabled MFA must assure the session; sensitive actions require recent step-up. Exact runtime validation lives in the named modules, not this summary.

| Surface | Routes and behavior | Implementation |
| --- | --- | --- |
| Saved submission | GET/POST /api/drafts[/:id]; POST draft/:id/documents, process, submit; GET readiness and selected document; revision and explicit field/source confirmation | operations-api.js, submissions.js |
| Operational lifecycle | GET/POST /api/cases/:id/operations; guarded action/revision/reason; acknowledgement and retained workflow_transition evidence | operations-api.js, operations.js |
| Clarification | Existing clarifications/responses with findingCode, supported fields, selected documents, deadline, requestId/revision; GET clarification-templates; POST disputed-fields and clarification review | operations-api.js, resolution.js |
| Work and messages | GET /api/work-queue, /api/notifications; POST notification/:id/read; bounded scope-bound cursors | operations-api.js |
| Viewer | GET case viewer/versions and version-specific metadata/pages; optional historical extraction identity; original source bytes remain separate protected attachments | viewer.js; pdf-worker.js; viewer-geometry.js |
| Continuity | Case continuity summary/proposals/events and lifecycle/timeline; case reminders and reminders/history; guarded proposal resolution and opt-in settings | continuity-api.js, lifecycle.js |
| Clearance administration | GET /api/clearance/configuration; POST activations/grants; GET queue and requests/:encodedEntity; POST request response; GET request selected documents | clearance-api.js; narrow request-event recheck after read |
| Case clearance | GET /api/clearance/cases/:id[/history]; POST bind, requests, withdraw, proposals, confirm, close, reopen | clearance-service.js; current input/source/configuration, independent maker/checker and revision guards |
| Policy explanation | GET case policy-decisions[?evaluationId=], policy-decisions/history; existing policy replay endpoints retain immutable facts/configuration | policy-decisions.js, policy-history.js |
| Relationships | GET case relationships; GET/POST legal-entity claim (write institution administrator only) | analysis-api.js; case-scoped relational expansion and unverified self-declaration |
| What-if | POST case analysis/snapshots {inputRevision}; POST analysis/scenarios {snapshotId,changes}; GET analysis/history and analysis/records/:id[/replay] | analysis-api.js, scenario-analysis.js; immutable read-only sandbox, no operational writes |
| Own security | GET /api/security/mfa; POST mfa/enroll, mfa/confirm, mfa/recovery, mfa/disable, step-up, password | account-security.js, mfa.js; masked UI/recovery once, secrets absent from logs |
| Audit verification | GET /api/security/audit-integrity for supervisor/auditor | Outcome/trust only, no global event IDs/counts; standalone verify-audit.js is read-only |
| Operational analytics | GET /api/analytics?days=7/30/90/365 | Current authorized inventory plus completed events in explicit UTC window;500-case/10000-per-category caps return413 |
| Optional measurement | POST /api/workflow-measurements {task,durationMs,clicks,errors,help,manualFields,validationCorrections,caseId?} | Exact keys; task enum submission/review/correction/clearance/evidence/clarification, integer bounds, optional authorized UUID case, immutable audited row; no document/field values |

Mutation conflicts return409; inaccessible resources404; role/CSRF/grant failures403; required reauthentication401; overload/size bounds429/413; unavailable required services503. There is no deletion/history rewrite or client issuer-confirmation shortcut. Private documents/scenarios are never banking verification. Source scanners and providers expose actual missing/unavailable/contract-test classifications rather than fabricated successful connections.

MainCLI requires patched Node22.23.4+Node22.x before opening the data directory. Configuration remains operator-owned. See deployment.md, procedure-confirmations.md, backup-and-restore.md and phase reports for trust/operational contracts. Docker and remote CI execution remain separate from endpoint tests.
