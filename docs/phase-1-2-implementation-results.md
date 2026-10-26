# Phase 1 + 2 implementation results

27 October 2026. Existing Node/SQLite application extended in place. No repository reset, working-data deletion, framework replacement, remote push or Phase 3 workflow implementation.

## Requirement closure

The C/H mapping below follows the implementation order in the user's current instruction. The checked-in earlier audit uses DOMAIN-F1/FIELD-F1/OPS-F1 identifiers and does not contain an authoritative M1–M9 definition. Medium work is therefore recorded by concrete requirement, without inventing an original per-ID mapping.

| ID | Implemented behavior | Code | Acceptance evidence |
|---|---|---|---|
| C1 | Five roles, tenant/authority/assignment restrictions, read-only auditor, role-family account administration, status/session revocation | `src/permissions.js`, `src/administration.js`, `src/server.js` | foundation, administration, app, quality-audit tests; administrator/supervisor/auditor browser journeys |
| C2 | Independent obligations, instruments, case associations, logical documents and immutable document versions; instrument-specific evidence | `src/foundation-migration.js`, `src/migrations.js`, `src/domain.js`, `src/current-evidence.js` | populated migration, FK/hash/history preservation, proof/FDR separation, replacement evidence isolation tests |
| C3 | Persisted initial administrative state, guarded role/revision transitions, assignments, immutable predecessor/successor links, cycle/tenant checks | `src/domain.js`, migrations 7/11 | role/state/concurrency and instrument tests; supervisor browser transition |
| H1 | Revisioned institution profile, programme/approval history and independent obligation administration, connected UI | `src/administration.js`, `public/domain.js` | persistence, correction, tenant/role tests; administrator browser journey |
| H2 | Validated instrument type, INR currency, branch, institution/depositor and exact money/date metadata; multiple linked instruments | `src/engine.js`, `src/administration.js`, `public/app.js`, `public/domain.js` | normalization, administration, instrument-evidence tests |
| H3 | Ten-field extraction and missing/mismatch findings across declaration/document/provider | `src/extraction.js`, `src/engine.js` | intelligence/normalization tests; frozen v3 raster benchmark |
| H4 | Genuine secondary visual IFSC recognition, raw OCR retained, ambiguous/low-confidence results reviewed | `src/glyph-ocr.js`, `src/ocr-worker.js`, template manifest | IFSC extraction/intelligence tests; identical-image before/after benchmark; no directory or truth substitution |
| H5 | PDF page/coordinate system, raw text/blocks, methods/confidence, document-version/timestamp provenance and immutable correction history | `src/pdf-worker.js`, `src/extraction.js`, `src/server.js` | PDF, intelligence, correction/race and historical evidence tests |
| H6 | Actual local provider missing/holder-conflict/stale/malformed/partial/consent-denied/outage scenarios; Setu contract adapter | `src/financial.js`, `src/setu.js` | providers/final-gap/intelligence tests; provider → API → evaluation → browser journey |
| H7 | Trusted synthetic operational policy selection, active versions/effective periods, outcomes and independent current/frozen-snapshot policy replay; official trust gate | `src/policy-runtime.js`, `src/policy-replay.js`, `src/server.js`, `public/domain.js` | policy-runtime and regulatory tests; correction cannot change a frozen replay's facts; reviewer replay browser action |
| H8 | Deterministic severity and separate automated assessment/administrative state; no automatic final approval | `src/policy-runtime.js`, `src/engine.js` | severity/outcome and lifecycle tests |
| H9 | Signed tenant/role/filter/case-scoped cursors, stable row ordering and snapshot ceiling; bounded case/history/audit/job/account/obligation/domain pages | `src/pagination.js`, `src/current-evidence.js`, routes/UI | reliability/background tests, cross-tenant cursor rejection; old history remains accessible |
| H10 | Correlation IDs, structured request logs, audit category/outcome, evidence and before/after references, credential redaction | `src/observability.js`, migration 9, `src/server.js` | reliability tests: concurrent request IDs, denied outcomes and absent passwords/session cookies |

## Medium work implemented

| Concrete requirement | Implementation and proof |
|---|---|
| Useful private-storage abstraction | `src/storage.js` / `src/contracts.d.ts`; exclusive UUID writes, flushed files, hash checks, injected adapter, startup orphan quarantine, failed-read behavior and restart tests. S3 deployment remains optional. |
| Protected PDF viewing | Authorized bounded PDF-to-PNG page preview, source hash recheck and post-await authorization; PDF API tests and dedicated browser journey. No browser execution of uploaded PDF active content. |
| Reusable OCR/model and processing workflow | Two bounded reusable child processes, model reuse, recycling, timeout/death recovery; durable 202 background jobs and tenant-protected polling connected to the institution UI. Real warm recognition and injected failure tests. PDF raster processing reuses its model within a document. |
| Portal administration and reviewed work queues | Profile/programme/approval, obligation and account controls, initial lifecycle/assignment/replacement controls, search/status filter, stable registry/history pages, exact totals, distinct provider classification and operational outcome/replay. |
| Typed API boundary | Runtime request envelopes and domain validation; shared `.d.ts` contracts; local pinned TypeScript compiler, strict positive/negative client contract compilation via `npm run typecheck`. This does not claim full application conversion to TypeScript. |
| Modularization | Permission, domain, administration, extraction, provider, policy-runtime, pagination, observability, current-evidence, storage and worker modules. Large orchestration/UI modules remain a maintainability limitation. |
| Deployment/validation | Dockerfile/Compose, non-root service, persistent volume, probes and setup instructions; isolated fresh `npm ci` + setup/start/login/upload/process/restart validation. CI includes typecheck. Container execution is unverified because Docker is unavailable locally. |
| Duplicate-content clarity | Identical bytes receive a same-case `duplicateOf` reference and visible warning; independent immutable versions are preserved. No destructive deduplication. |
| Architecture preservation | Existing stack retained as instructed; checksum migrations and tests instead of an unnecessary framework rewrite. Distributed workers/PostgreSQL migration are deployment-scale decisions. |

## Migrations and data preservation

Migrations 5/6 retain their original checksums. Migration 7 expands roles and backfills independent identities; 8 adds profiles and relationship/money guards; 9 adds correlated audit fields/indexes; 10 binds logical documents to instruments; 11 prevents selecting an existing instrument from spuriously amending its revision/state and preserves superseded predecessors. Populated databases receive pre-migration SQLite backups. Foreign keys are checked before commit, and failed migrations roll back.

The populated-v6 regression preserves user bindings, original document evidence IDs and hashes, historical evaluations and foreign keys. Existing legacy documents are associated with the case's migrated primary instrument; this preserves the old case association, not independent proof of historical deposit ownership. Newly uploaded documents have explicit immutable instrument associations. Private bytes are never rewritten by these migrations.

Policy replay can select an immutable evaluation snapshot, including its original regulatory-context and proof-review IDs. It reevaluates the selected operational policy while keeping historical financial findings and their original assessment date explicitly attributed. It neither updates the current assessment nor claims to reconstruct unrecorded historical facts or independently revalidate a bank deposit.

## Validation evidence

Current raw evidence is in `docs/evaluation/phase-1-2-tests.txt`, `current-browser.txt`, `clean-start.json`, `system-audit-results.json`, `reconciliation-audit-results.json` and `final-gap/ocr-results.json`.

The machine-readable [acceptance summary](evaluation/acceptance-summary.json) records source commit `68a7b05`. The complete [changed-file list](evaluation/changed-files.txt) covers the implementation since `9b3c564`; the code/test table above identifies the principal files by requirement.

- Full automated suite: 84 tests passed, zero failures; includes populated migrations, role/tenant isolation, stale revisions, races, upload/session/provider failures, worker recovery and private-document checks. Build passed. Typed client contracts compiled separately and are now included by `verify`.
- Final full-suite duration: 81.85 seconds; 35 application/public files passed the build check. A subsequent targeted policy test also covers inactive-version fallback and both inclusive effective-period boundaries.
- Browser acceptance: seven journeys, including genuine processing/review conversations, ambiguity correction, administration, PDF preview, provider scenarios, supervisor transitions/auditor denial and historical replay. See the current raw browser log for the final duration/result.
- Reconciliation benchmark: 20 preserved synthetic cases, precision 1.0, recall 1.0 for the asserted findings, zero failing cases. This is not a real-world diagnostic performance estimate.
- Local API benchmark: 20 records, 100 sequential HTTP-loopback list requests, p50 1.62 ms, p95 2.29 ms. This does not establish concurrent or production capacity.
- Fresh temporary production-dependency installation, idempotent account provisioning, readiness/login/registration/upload/text processing and restart persistence succeeded. Original hash and evaluation counts survived reopening; foreign-key check passed. No existing data directory was used for this probe.

### OCR results

All 48 PNG attempts use actual Tesseract recognition. V1/v2 raster files remain unchanged. V3's 12 layouts were frozen before first recognition and were not used to tune the recognizer. The final repeat validates the frozen pipeline; it is not a newly unseen holdout. Per-document raw observations and hashes remain in the JSON artifact.

| Field | V1 before → after | V2 before → after | V3 held-out before → after |
|---|---|---|---|
| Reference | 18/18 → 18/18 | 16/16 → 16/16 | 12/12 → 12/12 |
| Amount | 18/18 → 18/18 | 16/16 → 16/16 | 12/12 → 12/12 |
| Bank | 18/18 → 18/18 | 16/16 → 16/16 | 12/12 → 12/12 |
| IFSC | 0/18 → 17/18 | 5/15 → 11/15 | 9/12 → 9/12 |
| Issue date | 18/18 → 18/18 | 16/16 → 16/16 | 12/12 → 12/12 |
| Maturity date | 18/18 → 18/18 | 16/16 → 16/16 | 12/12 → 12/12 |
| Institution name | not present | not present | 0/12 → 12/12 |
| Depositor | not present | not present | 0/12 → 12/12 |
| Branch | not present | not present | 0/12 → 12/12 |
| Currency | not present | not present | 0/12 → 12/12 |

Before/after applies the archived parser and current extraction pipeline to the same genuine OCR observations; secondary visual proposals are included only in the current pipeline. V2's preceding reviewed parser scored 9/15, before the new visual step. V3 IFSC does not improve exact matches: the three untrustworthy strings are withheld instead, reducing coverage from 12/12 to 9/12. Every secondary glyph correction remains explicitly human-review-required; extraction exact match is not automatic verification. Unsupported layouts and real-bank documents have no accuracy certification. Runtime confidence is retained, not claimed calibrated.

Final OCR repeat: zero processing failures across all 48 rasters; mean time per document was 3291.96 ms (v1), 2537.74 ms (v2) and 3752.96 ms (v3). In the final full-suite worker-reuse test, cold/warm requests took 2993.89/2215.49 ms with identical recognized text/proposals and the same worker PID. These local timings vary with concurrent validation load and are not production throughput guarantees.

## Remaining limitations and external dependencies

No critical internal defect is currently reproduced by the acceptance suite. Known limits remain: imperfect IFSC recognition; single-owner synchronous SQLite; no distributed worker lease; retained large orchestration/UI modules; case-list totals require a tenant-scoped scan; no full-browser/security certification. These are explicit limits, not evidence of completed production-scale acceptance.

Setu consent-to-data live acceptance requires owner-provided sandbox credentials/product/consent configuration. Official AICTE rules remain UNVERIFIED_POLICY until authoritative issuer sources and interpretations are confirmed. IFSC directory membership confirms a reference record only. MOCK and SANDBOX never establish independently confirmed bank evidence. Docker execution and remote CI remain unexecuted environment checks; no push was authorized.

Production TLS, managed private storage/encryption, independent backup/restore operations and operating-system document isolation remain deployment prerequisites. Advanced clearance, release, escalation and maker-checker workflows were not started.

## Phase 3 verdict

The internal role/domain/evidence/policy/lifecycle foundations now support scoped Phase 3 design and reviewed local development. Production financial or regulatory automation and distributed Phase 3 rollout are **not approved** by this work. Obtain issuer/bank acceptance and choose the deployment/worker architecture before that rollout.

Local commits: `438c46b` foundations; `592baee` administration; `b6bec16` intelligence/policy; `51c5282` reliability/private processing; `e25fe25` deployment/clean installation; `68a7b05` final integrity/frozen replay. The acceptance-documentation commit is identified in Git history and the final response. No push performed.
