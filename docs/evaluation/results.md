> Current status: see [audit update](../audit-status-update.md) and [completion report](../phase-1-2-completion-report.md). Baseline descriptions below are retained for history.

# Measured local results
Dataset: synthetic-v1; Node v22.14.0; Windows; reference date 26 October 2026.
Machine-specific measurements are committed in adjacent JSON files.

| Measurement | Result |
|---|---|
| Text-import exact match (including absent fields) | 100.0% over 120 slots |
| Text present-field accuracy | 100.0% |
| Text field coverage | 90.0% |
| Reconciliation precision / recall | 100.0% / 100.0% |
| Reconciliation false-positive rate | 0.0% |
| Real raster OCR field exact match | 85.0% |
| Raster OCR reference exact match | 100.0% |
| Raster OCR field coverage | 90.0% |
| Raster OCR processing failure rate | 0.0% |
| Mean raster document processing | 1734.6 ms |
| Authenticated API GET /cases p50 / p95 | 1.15 / 1.84 ms |

OCR's 0% process-failure rate does not mean all fields were correct. IFSC character recognition remains a known weakness. Rotation retry recovered the rotated fixture. Field confidence is not calibrated. These are 20 synthetic documents; no real-bank generalization or production SLA is claimed.

Reconciliation expected outcomes are manually specified scenario expectations; perfect synthetic scores do not validate banking authenticity or regulatory correctness. Policy tests use synthetic rules and check unsupported/date/scope/exemption safety. No verified AICTE rules have been benchmarked.

Executed test evidence is summarized in implementation-report.md and actual test artifacts. UTF-8 parser and image OCR results are deliberately separate.
