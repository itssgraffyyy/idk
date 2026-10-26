> Current status: see [audit update](audit-status-update.md) and [completion report](phase-1-2-completion-report.md). Baseline descriptions below are retained for history.

# API and frontend
Frontend route / serves login, registry and case views according to authenticated role. It is one buildless application, not separately routed demo screens.

All endpoints use JSON except protected downloads. Money uses integer paise. POSTs require X-CSRF-Token from login/me and same-origin browser requests. Cookie auth is HttpOnly. Errors return {error}; internal details are suppressed.

| Method | Endpoint | Behavior |
|---|---|---|
| POST | /api/login | Email/password; returns role and CSRF; sets session cookie |
| GET | /api/me | Current session |
| POST | /api/logout | Revoke current session |
| GET | /api/institution | Own registered institution profile |
| GET | /api/cases | Tenant records or officer assignments |
| POST | /api/cases | Institution: {name, obligation:{amountPaise}, instrument:{reference,amountPaise,bank,ifsc,issued,matures}} |
| GET | /api/cases/:id | Authorized facts, evidence and audit history |
| POST | /api/cases/:id/documents | Institution: {base64,mime}; 4 MiB decoded limit |
| GET | /api/cases/:id/documents/:documentId | Authorized hashed download; ?preview=1 permits inline preview |
| POST | /api/cases/:id/process | Process latest source; await bounded OCR result; job persisted |
| GET | /api/cases/:id/jobs | Authorized processing states |
| POST | /api/cases/:id/corrections | Institution: {instrument,revision,reason}; 409 on stale edit |
| POST | /api/cases/:id/extraction-corrections | Institution: {extractionId,values,reason}; append corrected extraction |
| POST | /api/cases/:id/external | Assigned officer: {scenario: unavailable/mock_confirmed/mock_conflict} |
| POST | /api/cases/:id/evaluate | Append an evaluation; refresh related duplicate cases |
| POST | /api/cases/:id/clarifications | Assigned officer: {text} |
| POST | /api/cases/:id/observations | Assigned officer: {text} |
| POST | /api/cases/:id/responses | Institution: {requestId,text} |
| GET | /api/ifsc?code= | Fictional local directory response |
| GET | /api/policies | Active unverified policy registry |

Examples of statuses: 400 invalid input/file, 401 authentication, 403 role/CSRF/origin, 404 inaccessible object, 409 stale correction/source change, 413 oversized request, 429 login/OCR capacity, 500 generic service failure. No delete API exists. API supports synthetic/private development only.
