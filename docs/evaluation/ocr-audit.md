> Superseded by the final-gap per-field results in [results.md](results.md) and [completion report](../phase-1-2-completion-report.md). The original v1 glyph limitation below remains; new v2 extraction improvements are measured separately.

# OCR error analysis and held-out evaluation
The original85% aggregate included correctly absent fields. The actual baseline present-field results were:
| Field | Correct / present |
|---|---|
| Reference |18/18|
| Amount |18/18|
| Bank |18/18|
| IFSC |0/18|
| Issue date |18/18|
| Maturity date |18/18|

The main failure is the printed Consolas slashed-zero glyph: Tesseract reads O/Q/L in IFSC values. It is not missing OCR execution. A rotated document was recovered by genuine rotated-image OCR. Development-only experiments on case001 tried constrained single-line recognition, the packaged alternate English model and2x/3x raster scaling. These did not reliably resolve the identifier, so they were not promoted or reported as improvements. Branch suffixes can be alphanumeric; replacing O/Q with0 would manufacture correctness.

Implemented extraction improvements: bank-document label aliases, exact INR decimal/grouping conversion, named-month/ISO dates, explicit rejection of ambiguous/invalid dates and unsafe financial values, whitespace/case normalization with original values, block coordinates and uncalibrated value-word confidence. Low-confidence values generate review findings; no threshold is called calibrated. Original OCR and manual corrections remain separate immutable records.

The final rerun uses the same20 raster files, original ground truth and unseen layout C (four held-out cases). The per-field/split report is ocr-audit-results.json. IFSC exact recognition remains0/18 overall and0/4 held-out; the other five fields remain18/18 overall and4/4 held-out. No aggregate improvement is claimed. This is a material OCR limitation: review/correction is required before relying on an IFSC extracted from these scans. Real-directory validation is separate and must not be used to silently change source text.

The exact machine runtime and per-document timings are stored with results. Synthetic accuracy does not estimate performance on real bank layouts. Broader real-layout evaluation, better image-specific models and confidence calibration remain necessary before unattended document processing.
