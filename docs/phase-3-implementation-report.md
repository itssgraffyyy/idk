# Phase 3 implementation report

Status: in progress, 27 October 2026. Existing application extended from `70869f3`; no framework/database rewrite or remote push.

## Baseline

Reproduced 84 passing automated tests, build/type checks and seven passing browser journeys before implementation. This is an actual local baseline, not a production or issuer/bank certification.

## 3A: resolution and guided submission

Checkpoint 1 implemented and validated; full 3A milestone acceptance remains in progress:

- Migration 12 adds operational workflow dimensions, input/transition revisions, immutable evaluation-resolution records, structured clarifications, deduplicated in-app notifications and owner-scoped drafts. Existing initial-domain states/API behavior remain available.
- `src/operations.js` guards submission/intake/review/clarification transitions. Readiness distinguishes required invalid/missing inputs from review warnings. Unverified policies do not become fabricated legal submission blockers. Evidence processing, bank confirmation, regulatory assessment and administrative state remain distinct.
- `src/resolution.js` records changed facts, finding dependencies, resolved/new/outstanding discrepancies, independent-verification requirements and recommended reviewer action. The current deterministic engine is inexpensive, so it deliberately uses safe full recomputation rather than claiming a partial optimization. Old evaluations remain immutable.
- `src/operations-api.js` connects contextual editable clarification templates, explicit optional deadlines, attachments, responses, closure/reopening and corrections restricted to requested fields. Queues filter actual authorized database state; notifications are deduplicated and checked against current case permissions.
- Migration 13 and `src/submissions.js` implement upload-first private drafts without fabricated placeholder instruments. Saved progress/values, original blobs, genuine extraction attempts and confirmations persist. New sources invalidate earlier confirmations. Submission is transactionally idempotent and transfers the same version UUID/hash into the normal evidence ledger.
- `public/operations.js` integrates review steps, comparisons and focused corrections into the case. `public/submission.js` implements the five-step institution/obligation → source → explicit prefill/confirmation → readiness → final review/acknowledgement flow. Known saved values are not silently replaced by extraction proposals.
- Draft extraction attempts are append-only; failed/rejected attempts are retained. Recognition failures permit manual source confirmation after processing ends. No recognition result is bank authentication.

Targeted API/domain tests cover readiness, simultaneous transitions/submissions, tenant/role restrictions, correction scope, unchanged-field preservation, history, notification ownership, draft recovery, source-version confirmation and immutable extraction attempts. Frozen-source acceptance passed 91 automated tests (83.66s), build/type checks and all eight browser journeys (42.5s), including upload-first saved submission. Raw outputs: `evaluation/phase-3-4-tests.txt` and `evaluation/phase-3-4-browser.txt`.

Remaining 3A acceptance includes the advanced page-specific evidence viewer/version comparison and additional review journeys; initial private page viewing already exists. Phase 3B–3D are not yet implemented. See [progress](implementation-progress.md) for the exact next checkpoint.

## Validation issues retained

An initial concurrent full-suite/browser run saturated the local machine: valid PNG/PDF validation exceeded the unchanged ten-second child-process budget. Verification now bounds test-file concurrency to two and runs browser acceptance after the backend suite. Timeout responses are retryable service errors; malformed content still fails validation. Assertions, file/page/pixel budgets and worker limits were not weakened. A subsequent draft fixture needed the new explicit confirmed-document reference; the updated positive/negative source-binding tests pass. Final raw results will be recorded after the frozen-source acceptance run.

## Later milestones and external limits

Financial continuity, configured departmental clearances, maker-checker decisions, advanced relationships/simulation, audit checkpoints, new held-out OCR evaluation, expanded analytics/accessibility and final A–M acceptance remain outstanding. Setu credentials, official AICTE confirmation and external issuer execution remain unavailable. No administrative release or production validation is claimed.
