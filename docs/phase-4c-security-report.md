# Phase 4C security and reliability status

Current status: capabilities implemented with targeted validation; final integrated acceptance is running. Earlier chronological checkpoints are retained in `implementation-progress.md` and Git history. This document describes the resulting controls and their actual limits.

| Control | Implementation | Proof |
| --- | --- | --- |
| Session, tenant and role boundaries | Five roles, current institution/assignment/authority checks, CSRF/origin/Host checks, expiry/revocation, post-await reauthorization | foundation, extra-security, quality-audit, storage-authorization, MFA and clearance tests |
| MFA and sensitive actions | RFC6238 TOTP, encrypted pending/enabled secrets, session-bound enrollment, anti-replay, persisted throttling, single-use recovery digests, password/factor step-up, required-role enrollment and session revocation | mfa.test.js; startup-recovery.test.js; browser/mfa.spec.js |
| Cryptographic audit | Additive schema19, canonical HMAC-SHA256 root/seals, monotonic IDs, atomic AFTER INSERT seals, external-key/checkpoint configuration, startup/standalone/API verification | audit-integrity.test.js includes deterministic concurrent writer/read-only verifier, tampering, truncation, missing anchors and historical fixtures |
| Private evidence access | Existing hash-checked private storage and protected page rendering; both session and exact departmental request event rechecked after storage read | storage-authorization.test.js, viewer.test.js, clearance.test.js, PDF/viewer browsers |
| Upload scanning | Actual bounded ClamAV INSTREAM adapter on draft and case upload paths; immutable version/hash-bound scan observations; fail-closed optional required-scan policy | upload-scanning.test.js uses actual local TCP contract server; worker-environment.test.js; draft/clearance regressions |
| Document workers | Bounded child concurrency/timeouts/heap, minimal environment, durable jobs and restart/recovery behavior; no provider/key credentials inherited | worker-environment, background, OCR recovery/resilience tests |
| Backup and isolated recovery | Stopped-source owner lock, consistent SQLite copy, all referenced document/draft objects, signed manifest, externally supplied keys, hashes/FKs/audit verification, isolated restore, copied sessions revoked | backup.test.js actually starts/restarts restored app and compares original private bytes |
| Procedure trust and applicability | Operator-owned version/source/review-bound confirmation register; explicit synthetic contract context; revocation invalidates live decisions; programme/level contradictions force review | procedure-confirmation, applicability, clearance, policy-history and scenario compatibility tests plus browsers |
| Dependency/CI/deployment | Pinned lockfile, structural ESLint, types/build/tests, explicit advisory transmission, secret-excluding container context and isolated clean-start configuration | phase-4d-eslint.json; phase-4c-infrastructure-tests.txt; build/type artifacts; final clean/install run pending |

Eight infrastructure/security/startup tests passed40.06s, including25 missing-MFA-key/restored-start cycles. No enrollment reset or owner-lock leak occurred. Earlier17-test selected security acceptance and other feature-specific results are retained under evaluation/phase-4c-*. Final integrated results will be recorded separately.

## Audit trust boundaries

Complete audit columns, IDs, previous MAC and payload digest are signed. Evidence and clearance audit events include source payload digests. Seals and database writes commit together; checkpoint replacement follows commit. Startup authenticates valid extensions past a surviving checkpoint before advancing it. A crash-uncheckpointed lost tail cannot be detected retrospectively. A protected checkpoint detects truncation beneath it. Legacy rows were enrolled as an explicitly signed baseline; their pre-enrollment authenticity cannot be established.

The verifier takes checkpoint bytes before a consistent SQLite read snapshot, avoiding false corruption reports during legitimate concurrent appends. It authenticates audit records; it is not a signature over every mutable database field, nor an independent issuer certification of referenced evidence. Hash-on-read protects private object bytes. Domain invariants and immutable tables provide application controls; a database administrator can alter triggers/state. An attacker controlling keys, checkpoints, application code or OS can forge history. Default key/checkpoint paths under DATA_DIR/security do not prove independent custody, Windows ACLs or volume encryption. No blockchain/WORM or independently witnessed anchor is claimed.

## Authentication and scanning limits

TOTP/recovery is not phishing-resistant hardware authentication. There is no administrator/helpdesk factor reset bypass. Recovery media and external MFA key custody require operational protection. Real ClamAV deployment is not configured or independently tested here: contract tests establish the wire adapter and failure behavior, not a malware-free certification. Unscanned/unavailable/legacy evidence remains explicit. A clean scanner result never proves banking authenticity. Document children have reduced credentials, but no OS filesystem/network sandbox or total-RSS cap is claimed.

## Backup limits

See backup-and-restore.md for commands and trust/custody requirements. Keys are not bundled. Restore never overwrites source or an existing target; an old archive uses its own explicitly archived checkpoint only in a new isolated directory. The production checkpoint is not silently rolled back. Backups are private local copies, not encrypted archives or geographically independent storage. Orphans, operator configuration, migration SQL backup copies and external object services are outside the stated referenced-object bundle. Deployment custody, retention, encrypted media and restore drills remain operator responsibilities.

## Dependency and infrastructure evidence

The public dependency-name/version audit was initially rejected by automatic review until explicit metadata consent. After the user approved, `npm audit --json --ignore-scripts --registry=https://registry.npmjs.org` completed successfully: **zero known vulnerabilities** at execution time. Raw result: evaluation/phase-4c-dependency-audit.json; locally reviewed manifest: evaluation/dependency-audit-payload.json. This is not proof of absence of unknown vulnerabilities. No remote CI run or push occurred. Docker CLI is unavailable on this host; Docker/Compose are configured but unexecuted. Native clean install/start/restart and broader load acceptance follow in Phase4E.

## Retained failure evidence

An earlier combined MFA run failed a missing-key startup assertion; its exact underlying exception was lost in truncated output. Isolated and exact combined reruns passed, then25 explicit failure/recovery cycles passed. Cause remains undiagnosed; do not relabel it a fixed vulnerability. Artifact: phase-4c-mfa-first-selected-failure.json. A later lint cleanup removed a used operationsGlobal audit parameter; current code restores it, final structural lint and operational/notification regressions pass. Intermediate lint output is not final acceptance evidence.

No live Setu product/consent test, bank confirmation, authoritative AICTE interpretation/issuer approval, production TLS/ACL/independent anchor custody, external security assessment or real-bank-document recognition accuracy is claimed.
