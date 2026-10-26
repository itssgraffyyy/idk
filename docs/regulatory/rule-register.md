# Versioned AICTE reference rule register
Current code: src/regulatory.js. Machine-readable versions and sources: GET /api/policies.
The publications are AICTE-authored PDFs, downloaded and visually reviewed, with SHA-256 recorded in resources/source-manifest.json. Copies are mirrored by an institution and third-party repositories. The official issuer site displayed maintenance and its source paths failed retrieval on 26 October 2026. Therefore issuerHostConfirmed=false and authorityVerified=false. Calculations are explainable reference findings, not an official compliance determination.

| Rules | Applicability/version | Source |
|---|---|---|
| Programme/level amounts | 2024-25 to 2026-27, supported combinations only | APH 1.12, Table1.4; PDF page26 |
| Government / government-aided | New institution; existing new programme differs for aided ownership | APH1.12 and2.25 |
| Prior-regulator exemption | Clause1.3.3, strictly more than five years and reviewed proof | APH1.12(i) |
| University exemption | Government university or private/deemed-private recognition conditions; new programme changes from2025-26 | APH4.10, PDF58; 2025 addendum PDF251 |
| Prior release / remaining balance | Reviewed NOC; conversion/remaining period needs case-specific determination | APH1.12(ii)–(iii),2.25(d) |
| Lease adjustment | Private lease in2024/2025; any lease in2026 | APHTable1.4; 2026 addendum PDF4 |
| Special-category concession | 2026 new institution/new programme/new level; listed categories and reviewed proof | 2026 addendum PDF4 |
| Council holding period | Actual Council deposit date, distinct from FDR tenor; extension/forfeiture possible | APH1.12(iv)–(v) |
| Payment/affidavit interval | Existing-institution approvals; 15-day evidence interval; penalties require calendar and authority review | APH2.25(f); 2026 addendum PDF11 |
| Release prerequisites | Application, affidavit, instrument/payment proof, current approval and departmental clearances | APH6.46 PDF77–78; 2026 addendum PDF14 |

Every rule includes clause/page, source hash, applicability and tests in tests/regulatory.test.js. Programme thresholds use integer paise, with supported-cell tests. There is no invented aggregate multi-programme amount or automatic release. Combined lease/concession application is unresolved because interaction requires clarification. Unsupported programmes/years, missing classification/proofs, incomplete historical deposits and unclear source authority return human_review_required.

Institutional facts are append-only context claims. Assigned officers accept/reject a referenced case document for a specific evidence type and context version; reasons and previous decisions remain preserved. New context invalidates prior-context proof applicability. Acceptance is an officer observation, not automated authentication of government documents.

Source copies:
- https://www.pvpitsangli.edu.in/wp-content/uploads/AICTE-APPROVAL-PROCESS-HANDBOOK-2024-25-2025-26-2026-27.pdf
- https://edu-ecosys.com/AICTE-APH-26-27.pdf (combined handbook and 2025-26 addendum; filename is not its applicability year)
- https://avantiscdnprodstorage.blob.core.windows.net/legalupdatedocs/52940/AICTE-issued-the-Corrigendum-regarding-the-Approval-Process-2026-27-February202026.pdf
Full source copies and hash manifest are local for auditability. No legal-source verification is inferred from a search snippet.
