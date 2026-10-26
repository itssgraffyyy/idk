> Current status: see [audit update](../audit-status-update.md) and [completion report](../phase-1-2-completion-report.md). Baseline descriptions below are retained for history.

# Requirement traceability
Only sections 1 and 18–28 were present in the supplied prompt; sections 2–17 were absent. This register describes delivered behavior without inventing omitted requirements.

| Stage / requirement | Implementation | Evidence / status |
|---|---|---|
| 1: boot, schema, migrations | Node HTTP, SQLite WAL, four version records, reproducible initialization | app/resilience tests |
| 2: authentication and isolation | scrypt, hashed sessions, CSRF, role/tenant/assignment checks | rejected-access, expiry and logout tests |
| 3: institution/obligation/instrument | tenant profile, per-case integer-paise obligation and FDR, revision handling | HTTP and browser registration |
| 3: private documents | validated PNG/JPEG/TXT, UUID paths, SHA-256, immutable metadata and retained versions | content, oversize, hash and unauthorized retrieval tests |
| 3: audit/version history | DB triggers, append-only events and snapshots, supersession links | immutability and correction tests |
| 4: portals and case workspace | registry totals from API, institution and officer workflows, source preview/download | two passing Playwright journeys; screenshots |
| 5: actual OCR | local Tesseract WASM, bounded child, provenance, blocks, rotation retry, manual extraction correction | actual raster benchmark and OCR-through-API test |
| 5: confidence | raw engine confidence and null uncalibrated per-field confidence | no calibrated confidence claim |
| 6: IFSC/provider | fictional local directory and development term-deposit evidence envelope | explicitly mock; no real banking/AA access |
| 7: reconciliation | declaration/document/obligation/provider comparison, source snapshots, duplicate/date/amount/reference findings | 20-case synthetic expected-code comparison |
| 8: versioned policy | trusted scoped/effective-date resolver, supported operators, verification gate | safety tests; no verified AICTE rules available |
| 8: exemptions | synthetic proof-backed/unsupported tests and fixture metadata | not a real institutional exemption determination; no exemption onboarding UI |
| 9: intelligence/history | explainable findings, actions, current/latest version and superseded reports | HTTP/browser history; related duplicate refresh |
| 9: resolution | officer clarification and observation; linked institutional response | real HTTP and browser journey |
| 10 / 2.7: dataset | 20 fictional cases, A/B development and unseen C held-out, scalable generator, text/raster ground truth | committed data; synthetic-v1 |
| 10 / 2.8: benchmarks | real parser, raster OCR and local HTTP results | committed machine-readable metrics |
| Security | core security controls and tested boundaries | 28 Node checks and two browser tests in final run; not full ASVS certification |
| Background processing | persistent job states, bounded concurrency, interrupt marking, explicit retry | failure/interruption tests; no distributed automatic queue |
| Phase 3 groundwork | assignment filtering and basic clarification | sophisticated assignment/escalation/clearance/release deferred |

## Acceptance limitations
Phase 2 is not complete against the full definition of done: authoritative applicable AICTE policy verification and real institutional exemption proof handling remain unavailable. Financial adapters are fictional by design; private credentials and institutional consent infrastructure were not supplied. AA protocol certification is not implemented. IFSC does not use an authoritative directory.

Further unimplemented production controls and operational hardening appear in security-controls.md. Database-unavailable fault injection, all concurrent process/job race combinations, all unsafe-image fuzzing, a full independent ASVS audit, real-bank-layout OCR and a broad browser matrix have not been exhaustively tested. No live performance or compliance certification is implied. The system is a local functional baseline with explicitly reviewable gaps, not a completed financial authority.
