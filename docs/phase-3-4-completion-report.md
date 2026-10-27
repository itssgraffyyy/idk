# Phase 3 + 4 completion and local acceptance report

27 October 2026. Existing repository extended in place from70869f3. Application code frozen at98e0029 for final acceptance, using checksum-verified Node22.23.4 on Windows. No working-data reset, framework replacement, remote push or production deployment. All requested local acceptance gates now pass; unavailable external/environment acceptance is listed separately.

## Product and requirement status

Implemented and locally verified: **3A,3B,3C,3D,4A,4B,4C,4D and local4E acceptance**. This means operational application behavior, not independent bank/issuer authority or production certification.

- Guided saved upload-first drafts, selective prefill, readiness/acknowledgement, source-linked findings, explicit correction provenance, evaluation deltas, targeted clarification/response/review, guarded workflow and scoped queues.
- Independent institution/programme/approval/obligation/instrument/document/version identities; recorded lifecycle, predecessor/successor, no pooling/double counting, replacement proposals, source-bound timeline and immutable opt-in notifications.
- Versioned conditional departmental DAG, narrow grants/selected evidence, request/response/withdraw/reassignment, exact blockers, source-bound independent maker/checker, retained decision history and guarded closure/reopening. Internal approval never asserts bank release.
- Frozen policy configuration/facts/evidence/rules/exceptions/review explanations and historical replay; trusted procedure-confirmation capability; declared/registered programme/level contradictions force review. Real AICTE policy/procedure authority remains unverified.
- Genuine OCR improvements, original source coordinates/pages/confidence/method/version history, conservative conflict withholding and frozen synthetic evaluation. Authorized relational relationships and immutable read-only what-if snapshots/scenarios/replay.
- MFA, password/factor step-up and recovery; session/object authorization after private reads; scanner boundary on both upload paths; reduced child credentials; HMAC audit root/seals/checkpoints and consistent verifier; signed stopped-source backup and tested isolated restore.
- Authorized operational attention/analytics with exact definitions/ranges, optional content-free task measurements, responsive navigation, keyboard focus/skip link, improved contrast and progressive disclosure.

Phase1-2 C1-C3/H1-H10 foundation requirements remain implemented and tested. Concrete medium requirements are mapped in phase-1-2-implementation-results.md; an authoritative M1-M9 numbering was absent from the checked-in audit, so no invented per-ID mapping is claimed. Current detailed mapping: requirements/traceability.md; feature-purpose/permission/failure map: product/feature-coverage.md.

## Actual acceptance results

| Gate | Observed result | Artifact |
| --- | --- | --- |
| Entire automated suite | **186/186 pass**,0 fail/skip;787.65s | evaluation/phase-4e-all-tests.txt |
| All browser journeys | **21/21 pass**,5.6m | evaluation/phase-4e-all-browser.txt |
| Build/type contracts |82 files validated; TypeScript contract compilation succeeds | evaluation/phase-4e-build-types.txt |
| Structural lint |0 errors,0 warnings, including final benchmark scripts | evaluation/phase-4e-eslint.json |
| Dependency audit |0 known package vulnerabilities; explicit metadata consent; patched runtime checked separately | evaluation/phase-4e-dependency-audit.json |
| Financial reconciliation |20/20 original v1 cases; precision1,recall1 against retained conflict expectations plus required uncertainty/missing-field findings | evaluation/reconciliation-audit-results.json |
| Fresh native installation | Actual locked production npmci, idempotent setup, login, registration, upload, processing, restart; source hash and3 evaluations retained | evaluation/clean-start.json |
| Migrations |18 checksum migrations5-22 present on clean installation; populated historical13/14/15 fixtures preserve hashes, IDs and evaluations in full tests | foundation, clearance, notifications, policy-history, analysis, audit and backup tests |
| Concurrency/security/recovery | Tenant/object/session/grant isolation, optimistic edits, simultaneous submissions/responses/checkers, audit rollback/concurrent verification, provider/worker failures and25 missing-key/recovery cycles pass | Full backend/browser artifacts; targeted failure/repair evidence retained |
| Backup/restore | Actual signed isolated restore starts/restarts; sessions revoked; exact private bytes retained | backup.test.js in full186-test run |

A-M end-to-end coverage: A saved submission(submission browser); B amount discrepancy(resolution); C real OCR/IFSC ambiguity(ocr-review/journeys); D replacement(continuity); E departments and F maker/checker(clearances); G historical facts/policy/viewer(policy-history/viewer); H relationships and I read-only simulation(analysis); J provider failures(provider plus API tests); K frozen OCR release runs; L200-case load; M clean installation/restart. These use synthetic/internal contracts where external authority is unavailable.

Machine-readable aggregate: **evaluation/phase-3-4-acceptance.json**. UTF16 shell logs were normalized to UTF8 for review; observations and failure text are retained, not rewritten as passes.

## OCR before/after and release repeat

The first untouched held-out evaluation followed recognition freeze526b07b. Baselineabecded used identical images/dependencies. Release repeat at98e0029 is regression reuse of those frozen sets, not a newly untouched evaluation. No recognition tuning followed held-out results.

| Field | Original held-out baseline | Improved/release held-out | Release original48 present fields |
| --- | --- | --- | --- |
| Reference |6/12 |12/12 |46/46 |
| Amount |6/12 |12/12 |46/46 |
| Bank |6/12 |12/12 |46/46 |
| IFSC |10/10 |10/10;2 deliberately conflicting values withheld |40/45; baseline37/45 |
| Issued |6/12 |12/12 |46/46 |
| Maturity |6/12 |12/12 |46/46 |
| Institution |6/12 |12/12 |12/12 |
| Depositor |5/10 |10/10 |12/12 |
| Branch |6/12 |12/12 |12/12 |
| Currency |5/10 |10/10 |12/12 |
| Explicit type |0/12 |12/12 |Not present in original48 truth |

Release:12/12 held-out and48/48 regression documents complete,0 processing failures and0 incorrect unflagged candidates. Held-out bank has1 review candidate, IFSC4; original IFSC has37 review candidates. Exact proposals are not automatically accepted/confirmed evidence. Original image hashes remain frozen. Original85% aggregate included correctly absent fields and is not a present-field accuracy estimate.

Release held-out cold wall2660.95ms;11 warm median994.90ms, maximum8476.88ms; cold CPU including startup3.421s; warm mean CPU2.147s; peak worker RSS404400KiB. Original48 repeat peak429124KiB. Earlier baseline/revised resource comparison with its disclosed cache limits and per-layout/field coverage/errors are in phase-4a-ocr-report.md. Runtime/cache differed in this release repeat; no causal speed gain is claimed. Raw release summaries and full provenance/resource journals: evaluation/phase-4a/final-release-{heldout,regression}.{json,jsonl}.

## Local load and task measurements

Actual200 persisted synthetic cases across two institution tenants, one SQLite owner, HTTP loopback. Requests admitted at4/sec beneath the default300/IP/minute limit; admission waits excluded from request latency and recorded separately. Configured concurrency and actual maximum in flight are reported separately: search observed3, other groups1. These figures are not unrestricted throughput or a production SLA.

| Operation | Samples | p95ms |
| --- | ---: | ---: |
| Case creation with signed checkpoints |200 |445.02 |
| Tenant search/stable page |40 |12.67 |
| Bounded case/history read |40 |14.61 |
| Scoped analytics150 cases |20 |178.49 |
| Relationships200 accessible cases |10 |292.25 |
| Empty configured departmental queue |20 |6.47 |
| Whole audit verification |5 |864.81 |
| Private synthetic text publish |5 |298.23 |
| Text extraction/reevaluation(not OCR) |5 |478.59 |
| Actual local MOCK provider/API/evaluation |10 |527.68 |
| Source-linked policy explanation |20 |200.60 |
| Read-only scenario persistence |10 |283.84 |

All completed groups have0 failures; cross-tenant object read denied. Wall105.29s, parent CPU9.921s user+4.359s system, peak sampled parent RSS271167488bytes. Exact samples/admission waits: phase-4e-load.json and its linked progress journal. Findings do not justify a framework rewrite; single-owner/bounded-query limits still constrain distributed rollout.

Six alternating scripted maturity-opening trials reuse the same three cases/account/current build, conventional registry versus attention overview. Both variants require1 click/4 API requests. Automated timing is retained in phase-4d-task-comparison.json. No historical-build human study or productivity gain is claimed. Optional real task measurements collect category/duration/changed-control/correction/click/error/help counts only, with no entered values/document content.

## Failures investigated and fixed

1. First full run182/184: stale migration-count assertion and startup ERR_INVALID_STATE/statement has been finalized atcycle16. Minimal Node22.14 forced-GC repro fails afterone row; all four streaming query sites now pin their prepared statements until completion/return/throw.250rows/50 forced-GC cycles pass,21 focused regressions pass, then final186-pass rerun. Upstream iterator lifetime fix: https://github.com/nodejs/node/pull/57569 . Original lost-stack failure remains archived; later matching symptom has deterministic evidence.
2. Prior Node22.14 deployment pin was stale. Official22.23.4 security baseline is pinned in engines/CLI/CI/container/version files; official Windows archive SHA verified. System installation/running user service were not changed. Use the workspace-local patched runtime or install the supported release. Provenance/security source: phase-4e-runtime-provenance.json and https://nodejs.org/en/blog/vulnerability/october-2026-security-releases . No independent release-signature verification claimed.
3. First load attempt correctly hit429. Second used an incomplete hypothetical scenario date fixture, correctly rejected. Final protocol retains rate controls, explicit dates and per-group journals; succeeds. Both failed consoles retained.
4. Legacy reconciliation benchmark omitted subsequently required type findings. Its only40 extra findings were missing_declaration_type/missing_type on20 type-absent fixtures. Required missing-field expectations were updated; original ground truth/conflict expectations unchanged. First report retained, then20/20 pass.
5. Earlier used audit parameter removed during lint cleanup was restored; operational/notification regressions and final lint/full suite pass. Initial failed evidence is retained.

## Remaining internal limits versus external dependencies

No known failing internal acceptance gate remains. This does not prove absence of unknown defects. Deliberate limits/debt: single SQLite owner, synchronous bounded queries, overview500-case/10000-event caps, bounded private processing, large orchestration/string-rendered UI modules, partial shared typing rather than a full TypeScript conversion, uncalibrated OCR and five unresolved original-corpus IFSC matches requiring review. Runtime history compatibility fixtures preserve prior scenario behavior. Optional S3/distributed leases/graph database/framework conversion are not claimed.

External/environment acceptance still required:

- Authorized Setu sandbox product/credentials/configured consent and independent bank data acceptance; user explicitly authorized contract tests without credentials.
- Official AICTE issuer/source/amendment/interpretation/procedure confirmations; real rules remain unverified, synthetic fixtures never real authority.
- Representative consented real-bank documents and human task/accessibility studies; current synthetic/scripted evidence does not establish those outcomes.
- Real scanner deployment/engine operation, production TLS/Host/private volume ACL/encryption, independent key/checkpoint/backup custody and operational security review. Child controls are not OS filesystem/network sandboxing or total-RSS limits. Audit HMAC is not a signature over every mutable DB field; pre-enrollment and never-checkpointed lost-tail trust limits remain.
- Docker-enabled execution and actual remote CI: configured but unexecuted here; no push authorized/performed. Native clean deployment is verified separately.

## Readiness verdict and Git

**Ready for local reviewed Phase3/4 operation and further development within these tested bounds. Not approved for unattended bank/regulatory decisions, distributed rollout or production deployment.** No Phase5 workflow was started.

Logical local commits preserve history. Notable latest code milestones: aa8f684(infrastructure isolation/lint/recovery), e9c59f6(operational analytics/private measurements),98e0029(SQLite GC repair/patched runtime). Earlier3A-4C commits are listed in evaluation/phase-3-4-commits.txt. Final evidence/documentation commit is recorded by Git after this report. Changed-file manifest: evaluation/phase-3-4-files-changed.txt. Working data were not used for tests or migrated/restarted as part of this validation; migration behavior was proven on isolated populated fixtures and clean installations. No remote push.
