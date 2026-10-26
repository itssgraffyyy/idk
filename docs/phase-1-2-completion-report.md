# Phase 1 + 2 final gap-closure report

26 October 2026. Repair baseline: commit2846d76. The existing application, original raster fixtures, private-data paths and Git history were preserved. No remote push or Phase 3/4 workflow implementation was performed.

## 1. Baseline and audit correction

Before changes, the reported49 automated tests,2 browser journeys and build passed again. Genuine OCR reproduced five fields at18/18 and IFSC at0/18. Baseline evidence is retained under evaluation/final-gap-baseline/.

The previous audit incorrectly stated that original master sections2–17 were absent. Re-reading the original attachment confirms that they exist, including the specified stack and additional domain, role and PDF requirements. The [traceability matrix](requirements/traceability.md) now records those requirements explicitly. The current instruction preserves the existing architecture; it does not retroactively satisfy the original stack.

## 2. IFSC root cause and repairs

The v1 generator creates structurally valid fictional codes, such as SYNB0000001; these are not known current-directory records. Tesseract reads the rendered Consolas zero glyphs as O/Q/L. Some results violate the fifth-character zero rule; others remain structurally valid because branch suffixes may be alphanumeric. The old parser returned all of them as field values. Neither a simple all-O-to-zero replacement nor directory membership can safely reconstruct a fictional identifier.

The new pipeline separates labeled candidates, case/separator normalization, syntax, reference lookup and confidence/review state. It joins split tokens/lines, handles punctuation, detects multiple alternatives, retains raw text and correction proposals, and withholds malformed or ambiguous values. Suggestions never silently replace identifier characters. Unknown but structurally valid values remain observed values with explicit review. Bank mismatch, old reference and low engine confidence also require review. Search and variant work are bounded; truncation cannot select a value.

## 3. Measured before/after

Old and new parsers processed identical genuine OCR output. Original20 PNGs were not changed. A separate16-document v2 dataset introduced public branch identifiers in explicitly synthetic deposits, varied fonts and fresh G/H layouts.

| Measure                            | Before       | After        |
| ---------------------------------- | ------------ | ------------ |
| Original v1 IFSC exact match       | 0/18         | 0/18         |
| V2 IFSC exact match                | 5/15 (33.3%) | 9/15 (60.0%) |
| V2 fresh-layout IFSC               | 2/4          | 3/4          |
| V2 IFSC coverage                   | 15/15        | 9/15         |
| V2 ambiguous-case false extraction | 1            | 0            |
| Other five fields, v1              | 18/18 each   | 18/18 each   |
| Other five fields, v2              | 16/16 each   | 16/16 each   |

No original-fixture accuracy improvement is claimed. Withholding invalid candidates reduces coverage honestly. V1 contains14invalid-syntax review cases,4incorrect/unknown glyph strings and2correctly absent IFSCs. V2 contains9exact fields,6syntax-review cases and1ambiguity correctly withheld. Full OCR:36 attempts,0 processing failures; mean2309.51ms/v1 and2331.77ms/v2. These are small synthetic benchmarks, not real-bank-document accuracy estimates.

## 4. Regulatory validation

Ten stable reference rules retain source hashes, document editions, clause/page references, academic-year applicability, evidence requirements, exceptions, validation status and test references. Programme cells, positive/negative exemptions, historical amendments, missing proof, lease/concession interaction, holding period and release safety are tested.

Two internal calculation defects were repaired: a prior-release NOC no longer grants a blanket technical-new-institution exemption, and overlapping2024government-university/new-programme clauses now return unresolved interpretation instead of an assumed exemption.

**No rule was promoted to issuer-verified authority.** Fresh direct probes returned HTML at the issuer root,404 at two handbook PDF paths and a timeout at the alternate host. Browser fetches also failed; transport differences are recorded. The reviewed mirrored publication copies remain references. Exact notice effective dates, renewal/replacement restrictions and unsupported interpretations remain unverified. A matured FDR does not authorize release; a matching amount does not prove deposit existence.

## 5. Financial integration status

The real Razorpay IFSC service succeeded in a fresh smoke check, with bank/branch/version/provenance retained. The183214-record pinned directory has integrity checks and explicit offline fallback. Lookup confirms branch-reference information only.

Setu consent/session/term-deposit contracts are tested without credentials, as the owner requested. Added returned-range containment, provider identity, stale-data classification and negative tests cover denied/expired consent, missing/different accounts, invalid/partial records, duplicate/conflicting records, unavailable sessions and amount conflicts. Retrieval time is not treated as a financial snapshot timestamp. Stale values are preserved but do not drive current mismatch findings.

All mock results are MOCK; Setu data is SANDBOX. Production bank confirmation remains UNCONFIRMED. A linked account is not silently treated as an FDR reference. No successful Setu sandbox connection or real bank confirmation is claimed.

## 6. Evidence consistency and UI

Active regulatory findings are unique per rule code, with calculation subchecks retained. Findings now serialize conflicting values, classifications, exact evidence/extraction references, policy rule, missing proof, suggested reviewer action and evaluation version. Repeated corrections preserve all prior evaluations and supersession links; stale and unauthorized writes fail.

The existing portals now show IFSC ambiguity/proposals, actual provider classification and explicit production-confirmation uncertainty. An accessible scenario label and visible loading state were added. The new browser regression verifies ambiguous evidence, explicit manual correction and preserved source candidates.

## 7. Security, persistence and PDF repairs

Migration 6 adds active/disabled accounts, denies disabled login/session use, revokes their sessions and requires new login after reactivation. Existing migrations/checksums/data remain intact.

Previously missing PDF support now validates and privately stores the supported subset, extracts embedded text or rasterizes and performs actual Tesseract OCR, retains page provenance and enforces five-page/pixel/time/output limits. Tests cover malformed/active/large-page PDFs, cross-tenant denial, attachment retrieval and version history. PDF viewing uses private download; encrypted/XFA/attached PDFs are unsupported. Worker bounds do not constitute an OS sandbox or malware scanner.

Health/readiness endpoints are tested, including503on database failure. A Windows CI workflow is configured; it has not been run remotely. See [security audit](security/security-audit.md) for negative controls and residual risks.

## 8. Actual verification

The final automated suite has63 passing tests and0 failures, plus build validation of21 files. Three browser journeys passed in the recorded final runs; exact latest runtime and logs are in [results](evaluation/results.md). Reconciliation:20 cases,precision1.0,recall1.0. Local100-request sequential benchmark:p501.319ms,p951.861ms,max161.704ms; not a capacity claim.

An intermediate browser run timed out after sign-out and is disclosed in results. Subsequent three-journey runs passed without weakening business assertions. A PDF cleanup API mismatch discovered in a smoke run was fixed before passing PDF regression. No failures were reclassified as successful integrations.

## 9. Remaining internal requirements

The original full Phase 1/2 scope still contains substantive missing functionality: institution-admin/supervisor/audit-reviewer roles, richer profile administration, independent obligation/instrument domain relationships, replacement links and initial lifecycle states, additional OCR target fields, interchangeable object-storage interface, pagination, typed API/Compose and complete correlated structured logging. These are identified in the [final gap audit](phase-1-2-final-gap-audit.md); they are not silently assigned to future phases.

The route/UI modules remain large, SQLite is single-instance with synchronous queries, and operational histories are unbounded. Production deployment additionally needs managed secrets/TLS/storage protections/backups and independent security review.

## 10. Phase 1 assessment

The tested two-role local prototype foundation works, now including bounded PDF handling and account status. **The complete original Phase 1 scope is not implementation-complete** because the role/domain/infrastructure gaps above remain.

## 11. Phase 2 assessment

Targeted IFSC extraction, financial-contract, regulatory-safety and evidence-consistency defects were repaired and measured. **The complete original Phase 2 scope is not implementation-complete**: six-field extraction is narrower than requested, difficult IFSC glyphs still need review, and issuer regulation confirmation remains unavailable. External access limits are distinguished from missing internal functionality.

## 12. Phase 3 readiness

The UUID/evidence/provenance contracts are useful foundations. Full Phase 3 rollout still requires domain/permission completion and operational storage/worker changes; no promise of structural readiness without that work is made. See [readiness assessment](architecture/phase-3-readiness.md). No production readiness or autonomous clearance/release is claimed.

## 13. Reproduction and artifacts

npm run verify; npm run test:e2e; npm run benchmark; npm run benchmark:system; npm run benchmark:ocr:final. Rendering/source probes and per-field/category artifacts are documented in evaluation/results.md. The source-probe command succeeding means access checks ran, not regulations verified. No real credentials are needed for internal tests.

## 14. Git

Focused local implementation and evidence/documentation commits are recorded in the final response and final-gap validation summary. No push is performed. Runtime data is ignored and was not reset. Working-tree status is checked after committing.
