# Current implementation status — 26 October 2026

This update supersedes baseline counts and provider/policy descriptions in older architecture, security, API, requirements and evaluation notes. See [completion report](phase-1-2-completion-report.md) for measured results and remaining acceptance gaps.

## Security and persistence

49 automated tests and two browser journeys pass. Bounded async scrypt, uniform missing-user checks, single-instance locking, post-await session/assignment checks, stale-revision rejection, superseded OCR attempt retention, isolated bounded image decoding, Host allowlist, request/body/time limits, transactional checksum migration 5 and case-creation idempotency are implemented. Migration preserves versions 1–4 and backs up existing populated databases before upgrade. Audit triggers remain an application-level control, not administrator-resistant cryptographic integrity. Runtime SQLite and unpaginated histories still limit scale.

## API additions

All case routes retain tenant/assigned-officer authorization and session/CSRF protection.

| Method | Route                             | Behavior                                                                           |
| ------ | --------------------------------- | ---------------------------------------------------------------------------------- |
| GET    | /api/ifsc?code=                   | Real public provider with pinned offline fallback; directory evidence only         |
| GET    | /api/policies                     | Versioned reference register plus unresolved authority state                       |
| POST   | /api/cases                        | Optional Idempotency-Key header binds retry to actor and payload                   |
| POST   | /api/cases/:id/ifsc               | Persist lookup evidence; reauthorize and check revision after await                |
| POST   | /api/cases/:id/regulatory-context | Institution supplies {context, revision}; validated immutable claims               |
| POST   | /api/cases/:id/proof-reviews      | Assigned officer supplies current contextId, documentId, type, decision and reason |
| POST   | /api/cases/:id/sandbox-consent    | Institution starts configured Setu TERM_DEPOSIT consent                            |
| POST   | /api/cases/:id/sandbox-session    | Institution requests data session for a consent already bound to this case         |
| POST   | /api/cases/:id/sandbox-evidence   | Assigned officer retrieves a session already bound to this case                    |

Proof review types: applicability, government_status, prior_regulator, ugc_recognition, prior_release_noc, special_category, payment_affidavit3. Decisions accepted/rejected; a new applicability context invalidates prior-context review applicability without deleting history. Provider failures return unavailable or explicit errors, never fabricated success.

## Requirements status

Real IFSC reference lookup is implemented and publicly smoke-tested. Setu is contract-tested only; owner confirmed no sandbox credentials. Programme-specific AICTE rules/amendments and proof handling are implemented as source-pinned references; issuer-host confirmation and unsupported interpretations still require human review. Five OCR fields score 18/18 among present fields; IFSC 0/18. The held-out four-layout-C subset has the same pattern. Phase 2 acceptance therefore remains incomplete. Existing data/fixtures/history were preserved; no production-readiness claim is made.
