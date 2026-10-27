# Phase 4A OCR acceptance

Recognition was frozen at `526b07b` before the first recognition of the twelve held-out V4 documents. Baseline uses `abecded` in `.scratch/ocr-baseline`, the same pinned dependencies and genuine OCR. No tuning follows these held-out results. Corpus manifest SHA-256: `e4e5efd4524a6de18ffe36242f61eb1e2dd1552ffe4efa2ce3239c2bbfd7e931`.

## Held-out present-field exact matches

| Field | Baseline | Revised |
|---|---:|---:|
| Reference | 6/12 | 12/12 |
| Amount | 6/12 | 12/12 |
| Bank | 6/12 | 12/12 |
| IFSC | 10/10 | 10/10 |
| Issue date | 6/12 | 12/12 |
| Maturity date | 6/12 | 12/12 |
| Institution | 6/12 | 12/12 |
| Depositor | 5/10 | 10/10 |
| Branch | 6/12 | 12/12 |
| Currency | 5/10 | 10/10 |
| Explicit type | 0/12 | 12/12 |

Both runs completed 12/12 with zero processing failures. Revised coverage is 100% for present fields, zero false extractions for intentionally absent fields. Both deliberately conflicting IFSCs are withheld. Baseline incorrect unflagged candidates: reference 6, bank 5, institution 6, branch 5; revised: zero for every field. Revised bank has one review candidate and IFSC four; exact proposals are not automatically accepted evidence or bank confirmation. Each layout R/S has six samples: revised all present fields exact in both; baseline R has merged-column failures, S all present fields exact except unsupported type. Raw per-field, coverage, review, layout and resource metrics are in `evaluation/phase-4a/final-*-heldout.json`; complete recognized blocks and provenance in their `.jsonl` journals.

Cold document latency (one fresh worker each): baseline 2635ms, revised 3764ms. Warm latencies (eleven each) and process CPU deltas are recorded individually. Peak worker RSS: baseline 432524KiB, revised 435056KiB. These sequential runs share uncontrolled filesystem cache on an i5-8250U/8 logical CPUs/8GB Windows host. No speed improvement or production SLA is claimed. The 384MiB flag limits V8 old space, not native/WASM or total RSS. CPU and startup resources are retained per row.

## Development and regression

The original 85% aggregate counted correctly absent fields; it is not a present-field accuracy measure. Frozen V4 has 18 development, 12 validation and 12 held-out synthetic images. Development/validation baseline completed 30/30: reference/amount/bank/dates/branch 18/30, institution 17/30, depositor/currency 15/25, IFSC 24/25, type 0/30. Final pipeline: all present fields exact except institution 29/30, with one genuine disagreement withheld; all five deliberately conflicting IFSCs withheld; no incorrect unflagged candidates or processing failures.

Fresh paired original-48 regression: IFSC 37/45 to 40/45 present (V1 17/18 unchanged, V2 11/15 to14/15, V3 9/12 unchanged). All other original present-field results unchanged, including V3 names 12/12. Original image hashes are unchanged. See `original-48-frozen-baseline` and `original-48-regression-gated` artifacts.

Merged recognized columns motivated label/word-span segmentation. Genuine IFSC fragments separated by blank lines are boundedly joined with raw fragments and review flags. Explicit types are extracted. The best rotation's actual pixels feed genuine cropped Tesseract OCR; inverse rotation preserves original image coordinates and recognition coordinates. Conflicting repeated/secondary readings are withheld with observations. Name crops are limited to rotated readings below engine confidence 90, an uncalibrated heuristic. Rejected intermediate runs remain archived: secondary OCR incorrectly changed holder 27 to277 and once included a label. Exact value spans and the conservative trigger fixed those development regressions. Secondary OCR is never promoted as silent name correction. Viewer, findings, approval blockers and explicit reasoned corrections preserve history.

Validation before held-out: 144 automated tests passed (300.77s), build/type checks passed, fifteen browsers passed (3.1m); extra real-image geometry/ink-overlap tests passed 2/2 (16.28s), runtime unchanged. Logs: `evaluation/phase-4a/development-tests.txt`, `development-all-browser.txt`.

## Limits

These are limited synthetic tests. R shares two-column geometry with development N but changes font; S changes order and font. They do not establish accuracy on representative real bank documents, calibrated confidence or issuer verification. No corpus/labels were altered after freezing. Original corpora are regression data, not untouched evaluation. Phases 4B-4E remain open.