# Phase 3 readiness

26 October 2026. Phase 3/4 implementation has not begun.

The current two-portal prototype has usable UUID evidence contracts, immutable source/correction history, integer paise, revision checks, provider trust classification and source-pinned reference rules. These are useful migration/extension boundaries. They do **not** establish readiness for full clearance/release orchestration.

## Preconditions

1. Finish original Phase 1 role/permission and institution/domain requirements. Institution administrator, supervisor and audit reviewer are original Phase 1 gaps, not new Phase 3 scope.
2. Separate institutions, obligations and instruments operationally; add instrument type/currency/branch, predecessor/successor links and explicit initial case status transitions. Existing case UUID/evidence contracts should remain stable. This is a substantive domain change; current JSON snapshots alone cannot promise no structural work.
3. Add bounded/paginated histories and list queries, then measure realistic concurrency. The current SQLite owner lock intentionally supports one service; synchronous database operations and whole-history loading limit scale.
4. Use PostgreSQL and leased workers for distributed operation. Preserve tenant IDs, actor IDs, case/evidence UUIDs, hashes, timestamps and supersession links; test export/restoration and dual-backend authorization contracts before cutover.
5. Complete issuer regulation verification and applicable interpretation, representative document accuracy and authorized bank integration acceptance before financial automation.
6. Establish deployment TLS, secure provisioning/recovery, managed private-storage access/encryption, independent backups/restore drills and audit checkpoints. Node PDF/image/OCR children are bounded processes, not OS sandboxes.

Next.js/FastAPI migration is not performed. The original master explicitly required that stack; the current repair instruction preserves the existing implementation. See stack-decision.md for concrete staged migration reasons. Framework choice alone does not fix the domain/security gaps.

## Assessment

Ready for continued local prototype development and reviewed demonstrations with synthetic data. **Not architecturally ready for full Phase 3 rollout without the domain and operational work above; not production-ready.** No clearance authority, automatic release, escalation system or banking confirmation is implied.
