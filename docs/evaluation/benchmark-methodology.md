# Benchmark methodology
Version synthetic-v1 uses a deterministic generator with 20 scenario archetypes. Default split: 16 development cases across layouts A/B and 4 held-out cases in layout C. Layout C is withheld from development. Run generator with count >=100 for expansion. No real institution/bank documents are used. Every page is visibly labeled synthetic.

Cases cover amount mismatch, missing identifiers, duplicate references, bank/IFSC mismatch, unreadable content, rotation, missing/reversed dates, unsupported/synthetic exemption metadata, external conflict/unavailability, shortfall and expiry. Ground truth lists extracted values, expected code sets, evidence status, policy version, review outcome and confidence behavior. Exemption applicability is tested against fictional policies, never AICTE.

Text benchmark: parser exact match includes correctly absent fields, coverage is returned fields divided by all 120 field slots. Reconciliation compares full expected code sets (including unresolved findings). Precision/recall measure the synthetic scenario suite only. Version correctness means selecting unverified-1, not validating actual law.

OCR benchmark: render raster files with System.Drawing; run Tesseract.js local English model in isolated child process; parse actual OCR text. Store per-case fields, confidence, duration and match counts in ocr-results.json. PNG rotation retries occur only when fewer than four labels are found. Raw text and block coordinates are retained by application processing. Confidence is uncalibrated; manual field confidence remains null. Field exact match includes absent ground-truth values; reference exact match is separately reported. No evaluation data is used to train the English model.

System benchmark: 20 local case records, 100 sequential authenticated GET /api/cases requests over HTTP loopback, Node runtime and OS recorded; p50/p95/max/mean. These are local measurements, not capacity or production SLAs.

Security/API suite and real browser journeys use isolated SQLite/filesystem data. No benchmark number is hard-coded. Rerun on target hardware; results vary.
