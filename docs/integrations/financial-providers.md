# Financial and bank-reference providers
## IFSC
Replaced the fictional directory with the pinned Razorpay IFSC public-domain dataset v2.0.62 (release2026-09-01), containing183,214 branch records. resources/ifsc/manifest.json records upstream/archive and normalized-dataset hashes. The compressed normalized dataset is committed; the large input archive is ignored and reproducible via scripts/download-reference-data.js and scripts/import-ifsc.js.

IFSCProvider queries https://ifsc.razorpay.com/<code> with fixed host, no redirect, timeout, response-size bounds and matching-identifier/schema validation. Network/invalid/error responses fall back to the pinned offline dataset. Results identify public_service/offline_fallback/offline_dataset, source/version, timestamp/hash and branch details. A pinned reference cannot guarantee that a branch has not changed since release. A directory match never authenticates a deposit. Case IFSC checks are retained as evidence and invalidate their applicability after an IFSC correction.

An actual successful public lookup is recorded in evaluation/ifsc-live-check.json. Tests cover real dataset records, fixed-host request contract, malformed service data and offline fallback. IFSC case validation always remains distinct from external deposit evidence.

## Setu AA sandbox
SetuSandboxProvider implements the source-pinned v2 OAuth/consent/session/data contracts. resources/setu-contract.json links the exact SetuHQ/docs commit and ReBIT term-deposit schema. It validates consent/session/account ownership bindings, active/unexpired TERM_DEPOSIT consent, requested range, delivered status, JSON format, schema version, exact INR-to-paise conversion, IFSC and ISO dates. Legacy data lacking currency does not receive an invented INR amount. No receipt reference or bank name is inferred from account/FIP IDs.

Environment configuration:
- SETU_PRODUCT_INSTANCE_ID
- SETU_ACCESS_TOKEN, or SETU_CLIENT_ID and SETU_CLIENT_SECRET
Credential values are never accepted through HTTP forms or returned to the browser. Authentication uses the endpoint in the pinned official OpenAPI contract. Tokens remain in process memory. Transport is sandbox-only and fixed-host; response bodies and redirects are bounded. Consent request asks for TERM_DEPOSIT/PROFILE/SUMMARY and ONETIME fetch. Notifications/webhook ingestion is not enabled; the portal supports explicit session/fetch polling actions.

Institutions create their own case-bound consent/session. Assigned officers may retrieve that session's selected linked account. External values include sandbox classification, source hash, selected raw summary and field mapping. No sandbox response is independently confirmed bank evidence. A separate DevelopmentDepositProvider remains visibly labeled simulation.

The owner confirmed no sandbox credentials are available. Therefore the adapter is contract-tested only; no successful Setu connection or real banking sandbox session is claimed. Missing configuration returns503/unavailable, and no fake consent/session is inserted. Contract tests cover token requests, request fields/headers, supported schemas, expired/revoked/mismatched consent, partial data, failures and unavailable evidence.

Production/FIU certification, real customer consent/data lifecycle, callback verification, institutional-account eligibility, bank agreements and independent confirmation remain prerequisites for a live integration. No production endpoint is enabled.
