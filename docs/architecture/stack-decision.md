# Stack decision after the Phase 1/2 audit
Decision: preserve the existing Node/SQLite implementation during remediation; do not describe it as the specified Next.js + FastAPI + PostgreSQL stack.

Correction from the final-gap audit: the original attachment contains sections 2–17 and explicitly specifies Next.js, FastAPI and PostgreSQL. The earlier omission claim was incorrect. The prior implementation selected available Node as a runtime convenience; this was not an approved waiver. The latest owner instruction explicitly preserves the current architecture during targeted repairs. Original stack requirements remain unmet and are recorded as such; no rewrite is performed.

Node and Tesseract WASM are capable of the implemented workloads; language choice is not the cause of the identified authorization/evidence races. Those defects were fixed directly. PostgreSQL is justified for Phase 3: SQLite permits one service owner/writer here, synchronous queries block the event loop, and cross-department worker leases and independent transactions need stronger deployment semantics. The current JSON case model is deliberately small and does not replace a normalized multi-instrument ledger.

A staged migration should preserve user IDs, tenant IDs, case/evidence UUIDs, file hashes, audit timestamps and evaluation supersession links:
1. Back up existing SQLite and private bytes. Export operational records and immutable evidence separately with counts/hashes; validate restoration.
2. Add normalized PostgreSQL institutions, obligations, instruments and assignments plus JSONB immutable evidence, transaction-level idempotency and indexed audit/event records.
3. Implement a storage boundary behind the same API. Run current contract/security/race tests against both backends, plus PostgreSQL RLS and concurrent-worker tests.
4. Move job ownership to database leases; add independent checkpoints and deployment/backup operations.
5. Introduce FastAPI behind the preserved contract if required by the agreed deployment/team standard. Move Next.js UI routes/form components incrementally when adding assignments/escalation, with existing Playwright journeys as acceptance gates.
6. Reconcile exported counts/hashes and run parallel read verification before cutover. Retain rollback and original history.

No PostgreSQL/FastAPI/Next.js migration has been performed or silently claimed. Current code has separated policy, financial providers, security, extraction and migrations into modules. The HTTP route module and string-rendered UI remain technical debt. Pagination of large case/history workspaces is still required before large institutional deployment. The owner should approve the concrete migration implementation after this review; no migration permission is being requested to complete the current fixes.
