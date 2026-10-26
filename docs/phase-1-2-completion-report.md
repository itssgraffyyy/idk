# Phase 1 and 2 completion report

26 October 2026. Existing application, fixtures, history and data are preserved. No GitHub push performed.

## Outcome

This is a materially hardened and tested implementation, but **Phase 1 + 2 is not fully complete at the requested standard**. Setu sandbox contract behavior is tested without credentials; official-host confirmation of regulatory sources remains unavailable; OCR IFSC recognition remains inadequate. These are explicit acceptance gaps, not successful integrations.

## Implemented fixes

- Real Razorpay IFSC provider, pinned 183,214-branch offline directory, SHA-256/version manifest, bounded HTTPS, schema validation and explicit fallback. Case-bound lookup evidence is retained. A real public-service lookup succeeded; this confirms directory information only, never deposit authenticity.
- Setu consent/session/retrieval adapter against pinned official OpenAPI and ReBIT term-deposit contracts. Credentials stay server-side. Consent, session, linked-account and case bindings are checked. Sandbox, simulated, unavailable and independently confirmed evidence remain distinct. No Setu connection was performed: owner confirmed no credentials.
- Ten versioned regulatory reference rules cover programme amounts, applicability/exemptions, amendments, lease adjustments, concessions, holding periods and administrative evidence. Immutable context and document proof-review workflows are exposed in both portals. Unsupported combinations require review. AICTE's issuer site was in maintenance; downloaded AICTE-authored mirrored copies have hashes and reviewed pages, but issuer authenticity is **not confirmed**. All assessments therefore retain human-review state; none automatically certifies compliance.
- Bounded async password hashing, image-validation child processes, Host validation, request limits, bounded provider bodies and upload handling. Reauthorization/revision checks after awaits prevent stale provider writes. Concurrent OCR cannot supersede a human correction; the attempted result remains in history.
- Checksum-verified transactional migration 5, existing-data backup on upgrade, additional database guards/indexes, single-instance ownership/restart recovery, atomic observations/responses and retry-safe case creation.
- Bank-document label aliases, strict money/date normalization, raw text/value/coordinates/confidence and correction provenance. No declaration-derived guessing was introduced.

## Actual validation

| Command / check             | Result                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| npm run verify              | 49 tests passed, 0 failed; build checks passed                                                                      |
| npm run test:e2e            | 2 browser journeys passed, 22.8 seconds total                                                                       |
| npm run build               | Syntax/reference validation of 19 files and packaged static assets; buildless Node application, not a Next.js build |
| npm run benchmark           | 20 synthetic reconciliation cases, precision 1.0, recall 1.0                                                        |
| npm run benchmark:ocr:audit | Actual Tesseract on 20 unchanged synthetic PNGs; 0 processing failures; mean 1573.92 ms                             |
| npm run benchmark:system    | Local 20-case workload, 100 sequential list requests: p50 1.228 ms, p95 2.108 ms, max 11.323 ms                     |
| npm audit --json            | 0 reported dependency advisories at scan time; not proof of absence of vulnerabilities                              |
| Public IFSC smoke check     | HDFC0000001 returned real public-service bank/branch data                                                           |
| Setu sandbox live check     | Not run: credentials unavailable; contract tests only                                                               |

OCR exact match among present fields: reference, amount, bank, issue date and maturity date each **18/18**; IFSC **0/18**. On the four held-out layout-C images, those five fields each scored **4/4**, IFSC **0/4**. The old 85% slot score counted absent fields and concealed the IFSC failure. Development-only preprocessing experiments did not establish a reliable fix and were not promoted. No accuracy improvement is claimed. See [OCR analysis](evaluation/ocr-audit.md).

Raw evidence: [test output](evaluation/phase-1-2-tests.txt), [OCR results](evaluation/ocr-audit-results.json), [reconciliation results](evaluation/reconciliation-audit-results.json), [system results](evaluation/system-audit-results.json), [public IFSC response](evaluation/ifsc-live-check.json). Synthetic workload results do not establish production capacity or real-document accuracy.

## Remaining limitations and acceptance work

1. Confirm regulatory editions/amendments from the issuer, including source completeness and applicable interpretation. Until then retain human review. Have an authorized reviewer resolve overlapping lease/concession treatment and administrative applicability.
2. Supply Setu sandbox credentials/consent configuration locally, execute real consent-to-data acceptance tests, then separately address production AA onboarding. No sandbox result can independently confirm a real bank deposit.
3. Improve IFSC recognition on representative consented/redacted real documents and a new untouched holdout. Preserve existing failed observations. Manual corrections require review and remain traceable.
4. Bound/paginate list and history endpoints; split the large route/UI modules. Current idempotency fixes do not resolve unbounded histories.
5. Before production, implement deployment TLS, reviewed provisioning/MFA/recovery, private storage ACL/encryption, managed backups/restore drills, independent audit checkpoints, malware controls and a full security review. Append-only triggers do not protect against a database administrator.
6. SQLite is a single-instance local service with experimental Node SQLite runtime. Move to PostgreSQL and leased workers for multi-instance Phase 3 concurrency; migrate incrementally using current behavior tests. See [stack decision](architecture/stack-decision.md). A wholesale Next.js/FastAPI rewrite is not justified solely by framework names, but the original stack deviation was not an approved waiver.

## Phase 3 readiness

Suitable for continued local development with synthetic evidence and explicitly reviewed reference decisions. **Not ready for production or autonomous regulatory/bank verification.** Phase 3 can use the preserved domain/API contracts, but the unresolved acceptance work above must be scheduled and verified before regulated deployment.

## Git

Local commits separate the baseline audit, tested engineering changes, and final evidence/documentation. No remote push is authorized or performed. Run git log for exact commit identifiers; the final response records them.
