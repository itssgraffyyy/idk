# Current acceptance results — 27 October 2026

See [implementation results](../phase-1-2-implementation-results.md) for current before/after metrics, field coverage, 84-test acceptance, browser validation, migrations, clean startup and deployment limits. Raw current artifacts are phase-1-2-tests.txt, current-browser.txt, clean-start.json, system-audit-results.json, reconciliation-audit-results.json and final-gap/ocr-results.json. Historical measurements below are retained for comparison, not the current completion claim.
# Final-gap validation results

26 October 2026. Node22.14.0, Windows, local loopback, synthetic evidence. Original baseline2846d76. These results supersede earlier aggregate-only reporting.

## Commands and evidence

| Actual command                                                                            | Exit / counts / scope                                                                                                                                | Artifact                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| npm run verify                                                                            | Exit0;63 tests passed,0 failed; unit/API/database/security/provider/regulatory/reconciliation suite; build validates21 files and packages static assets | phase-1-2-tests.txt                                    |
| npm run test:e2e                                                                          | Exit0;3/3 passed, 34.0s, after final UI clarity edits                                                                                                 | final-gap/browser.txt                                  |
| node scripts/benchmark-final-ocr.js                                                       | Exit0;36actualPNG OCR attempts,0 processing failures; old/new parser applied to identical raw recognition                                             | final-gap/ocr-results.json                             |
| node scripts/summarize-final-ocr.js                                                       | Exit0; error categories derived from retained observations without changing fields/ground truth                                                      | Same JSON, categorySummaryCommand                      |
| npm run benchmark                                                                         | Exit0;20 cases, precision1.0,recall1.0,0 failures                                                                                                      | reconciliation-audit-results.json                      |
| npm run benchmark:system                                                                  | Exit0;20 cases/100sequentialHTTPrequests; p501.319ms,p951.861ms,max161.704ms,mean3.194ms                                                              | system-audit-results.json                              |
| npx --no-install prettier --check src public tests scripts package.json package-lock.json | Exit0 on last check; final formatting check recorded below                                                                                           | Command output / final summary                         |
| node scripts/ifsc-live-check.js                                                           | Exit0; real public-service reference_match forHDFC0000001,26October2026T16:56:40.883Z                                                                | ifsc-live-check.json                                   |
| node scripts/probe-official-sources.js                                                    | Exit0 means probe completed, not policy verified: root200HTML, two issuerPDF paths404, alternate host timeout                                        | final-gap/official-source-access.json                  |
| node scripts/render-pdf-fixtures.js                                                       | Exit0; bothPDFs rendered and inspected; embedded text and genuine scanned-pageOCR pass API tests                                                     | final-gap/embedded-synthetic.png,scanned-synthetic.png |

Build is syntax/static-reference validation and asset packaging for the preserved buildless application. No TypeScript compiler/linter is configured; this is not a Next.js/Python build. CI workflow configuration is not a passing remote CI run. No live Setu test was attempted because credentials are unavailable. Dependency offline lock refresh reported0advisories; no fresh independent security certification is inferred.

## Before/after exact match and coverage

Accuracy denominator is present ground-truth fields. Coverage counts returned values among present fields; withheld ambiguous/invalid values count as uncovered, not correct.

| Field      | v1 before→after | v2 before→after | v2 G/H heldout before→after |
| ---------- | --------------- | --------------- | --------------------------- |
| Reference  | 18/18→18/18     | 16/16→16/16     | 4/4→4/4                     |
| Amount     | 18/18→18/18     | 16/16→16/16     | 4/4→4/4                     |
| Bank       | 18/18→18/18     | 16/16→16/16     | 4/4→4/4                     |
| IFSC       | 0/18→0/18       | 5/15→9/15       | 2/4→3/4                     |
| Issue date | 18/18→18/18     | 16/16→16/16     | 4/4→4/4                     |
| Maturity   | 18/18→18/18     | 16/16→16/16     | 4/4→4/4                     |

IFSC coverage: v1 18/18→4/18; v2 15/15→9/15; v2heldout4/4→3/4. This lower coverage reflects withholding malformed/ambiguous strings. V2 ambiguous-case false extraction fell1→0. Among returned v2 present IFSC values,9/9 matched; that is **not**9/9document accuracy or evidence of authenticity.

The preserved v1 glyph failures are14invalid-syntax review cases,4structurally valid but incorrect/unknown glyph strings and2correctly absent IFSCs. V2 has9exact fields,6invalid-syntax review cases and1ambiguity correctly withheld. Mean complete-process time: v12309.51ms, v22331.77ms, including worker startup and reference loading. Baseline pre-edit v1 rerun2100.07ms; no speedup claimed. Word confidence remains uncalibrated.

V1 layoutC was used in previous audits and is no longer a fresh holdout. V2 G/H were frozen before their first evaluation and were not used for parser tuning. Final resource-bound changes affect only oversized searches, not these fixtures. No known real financial documents or bank authenticity labels were used. All36PNGs and their hashes/expected fields remain reproducible.

## Failure observations

An intermediate two-journey browser run timed out waiting for the login form after sign-out (1pass/1fail). Subsequent fresh three-journey runs passed without weakening assertions. A visible loading state and accessible classification labels were added; timing on this host varied materially. The intermediate timeout is not omitted or treated as proof of a backend failure.

A PDF worker smoke attempt exposed use of an unavailable PDFDocumentProxy.destroy API; it was corrected to the loading task's destroy method before PDF/API regression passed. No failing PDF result is reported as a success.

Synthetic reconciliation expected codes add explicit review of fictional IFSC references; original domain mismatch expectations and v1 source fixtures are unchanged. The precision/recall result measures this fixture set only. Sequential local latency excludes cold-start capacity and is not a concurrency/load certification.
