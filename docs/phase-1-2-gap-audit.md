# Phase 1 and 2 implementation audit
Audit baseline: b798615, 26 October 2026. Existing history and runtime data are retained. Status updates and measured remediation results are appended below; baseline findings are not erased.

## Scope and stack decision
Inspected every tracked application module, browser asset, schema/trigger, fixture generator, benchmark, test and dependency manifest. The earlier supplied attachment contained sections 1 and 18–28; it omitted sections 2–17 and did not contain the Next.js/FastAPI/PostgreSQL mandate now identified by the owner. The prior turn chose Node because Node 22 was usable and the python command was inaccessible. This was an implementation convenience, not an approved architecture waiver. No evidence supports claiming equivalence with the specified stack.

Do not rewrite the application to fix a naming discrepancy. Node/Tesseract WASM can perform actual OCR securely when bounded; buildless UI can support the current two portals. Concrete limitations are SQLite's single writer, synchronous password hashing/decoding/queries, a large route module, no PostgreSQL adapter, shallow migration tracking, whole-history loading and absence of multi-instance job ownership. Before Phase 3 multi-department concurrent operation, adopt PostgreSQL and independently leased workers behind a storage/service boundary. Next.js is justified when client complexity/SSR/accessibility tooling merits it; FastAPI is justified if the deployment/team requires Python services or native OCR integration. Neither framework by itself repairs authorization or evidence correctness. Preserve the current API/domain tests as migration contracts.

## Implemented and tested baseline
The committed baseline contains 28 Node checks and two Chrome/Playwright journeys (recorded previous results, rerun required after fixes):
- Institution/officer login, scrypt password hashes, random HttpOnly SameSite sessions, token digests, expiry/logout and CSRF/origin checks.
- Institution isolation, exact officer assignment checks and private case/document access.
- Institution profile, one obligation and instrument per case, integer paise, calendar dates and optimistic declaration revisions.
- PNG/JPEG/TXT uploads, private UUID storage, SHA-256, retained document/evidence versions.
- Actual Tesseract WASM image OCR and separately labeled TXT import; raw block provenance and manual correction history.
- Declaration/document/obligation/simulated-provider comparisons, duplicate/date/amount findings and append-only evaluations.
- Officer clarification/observation, linked institutional response and backend-connected portals.
- Synthetic fixtures, image benchmark, local API benchmark and documented operational limits.

## Baseline gaps and exact priorities
| ID / priority | Finding and impact | Required remediation |
|---|---|---|
| SEC-01 P0 | OCR started before a correction can append an older extraction afterward, making a human correction cease to be current | Detect extraction-head changes after awaits; retain processing attempt as superseded; never replace current correction |
| SEC-02 P0 | Provider awaits use stale case snapshots; session/assignment can change in flight | Re-read/re-authorize after async work, reject stale revisions, preserve safe failures |
| SEC-03 P1 | Synchronous scrypt and full raster decode run on HTTP thread; absent users incur extra hashing | Async bounded scrypt with uniform dummy verification; isolated bounded file decoder |
| SEC-04 P1 | No Host allowlist; origin check trusts Host; no authenticated request throttle | Validate loopback/configured hosts, explicit origin, request limits and timeout tests |
| SEC-05 P1 | Database money-update guard omits obligation, role can be null, jobs lack FK/status guards | Non-destructive transactional migration, constraints/triggers, indexes and migration preservation tests |
| SEC-06 P1 | Append-only DB triggers are not cryptographic integrity; local administrator can alter DB | State boundary accurately; add backup/checkpoint extension guidance; no certification claim |
| DATA-01 P1 | Migration IDs inserted on every bootstrap; not actual transactional upgrade history | Add ordered checksum-verified transactional migration runner; preserve existing v1–4 data |
| BANK-01 P1 | IFSC only recognizes SYNB0000001; not a real directory | Pinned legitimate dataset, integrity manifest, real HTTPS lookup with timeout/schema validation and offline fallback |
| BANK-02 P1 | Deposit adapter only copies declarations; no Setu HTTP contracts | Documented sandbox consent/session/data adapter; bound ownership, validated payloads, explicit unavailable/sandbox/simulated states |
| REG-01 P1 | No active AICTE rules; policy_unverified always emitted | Source-pinned rule register with programme/level, exemption, property, holding and administrative checks; source/version/applicability tests |
| REG-02 P1 | Missing applicability facts/proof review workflow; no amendment mapping | Immutable institutional context claims and assigned-officer evidence review; resolve version by academic year; unsupported combinations stay human review |
| OCR-01 P1 | 85% aggregate masks near-total IFSC errors; score includes absent fields | Per-field and split metrics; development-only tuning; constrained image re-recognition, never declaration-based guessing |
| OCR-02 P1 | Label parser only recognizes internal camelCase names | Bank-document label aliases, strict money/date normalization, raw values/coordinates and ambiguous-data review |
| OPS-01 P1 | New process marks every processing job interrupted, even if another instance owns it | Single-instance lock for this SQLite service; explicit restart recovery; distributed leases deferred to PostgreSQL |
| OPS-02 P1 | No bounded list/history or atomic case idempotency; potential unbounded reads/duplicates | Bounded API responses, idempotency key for submissions, database-level tests |
| UI-01 P1 | Policy label and development evidence copy are hard-coded; no applicability/proof workspace | Render API policy/source states, expose actual regulatory context and proof review workflow |
| QA-01 P1 | Missing real-provider contract tests, policy tables/amendments and async races | Expand unit/API/security/concurrency/failure/recovery/browser checks; capture actual outputs |
| DEBT-01 P2 | Source/route/storage concerns concentrated in server.js; JSON case snapshots | Extract provider/policy/security/migration modules; retain versioned JSON evidence but plan normalized PostgreSQL operational model |

## Remaining production controls
TLS deployment, local directory ACL/encryption, MFA, user provisioning/recovery, malware scanning/OS isolation, independent audit checkpoints, backups and a complete ASVS assessment were not implemented by the baseline. These are not silently considered complete. The original Phase 1/2 prompt lists some as future controls; they remain Phase 3/production prerequisites where appropriate.

## Remediation status
In progress. Final source verification, exact fixes/tests/benchmarks, residual blockers, local commits and Phase 3 readiness will be recorded here after execution. No live Setu connection is claimed without real credentials and actual responses.
