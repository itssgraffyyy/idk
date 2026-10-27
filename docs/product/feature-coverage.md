# Product coverage and integration

27 October 2026. Phase 3–4 work is in progress; statuses are implementation-specific, not a declaration of complete product acceptance.

| Feature | User/problem/workflow | Reused data and permissions | Failure behavior and evidence | Status |
|---|---|---|---|---|
| Evidence-to-resolution | Institution/reviewer understands what changed and what remains outstanding, inside the case | Current and immutable prior evaluations, source fields/IDs; existing tenant/assignment/authority checks | Full recomputation fallback; previous results retained; `tests/operations.test.js` | Implemented with protected viewer; 95 tests and ten journeys passed |
| Guided saved submission | Institution avoids repeated entry and lost draft/source progress | Institution/profile/obligation records, private versioned draft files, extracted proposals and explicit owner confirmations | Invalid/readiness failures keep draft data; source changes require reconfirmation; `tests/submissions.test.js`, browser submission journey | Implemented; saved-submission browser passed |
| Structured clarifications | Reviewer asks a precise editable question; institution corrects only disputed fields | Active findings, source documents, immutable communication history; institution/responding reviewer permissions | Stale revisions, invalid attachments and unrelated correction fields rejected; operation tests | Core implemented |
| Notifications and work queues | Institution/reviewer sees its pending action without invented urgency | Database stages/findings, explicit deadlines and declared maturities, current access predicates | No cross-tenant/cursor leakage; deduplicated messages; no external email integration | Core implemented; configurable lifecycle reminders pending |
| Financial continuity | Institution/reviewer tracks renewal/replacement evidence without assuming release | Independent obligations/instruments/relationships and evidence | Unknown/unsupported pooling must stay inconclusive | Declared continuity/proposals and opt-in reminders implemented; 105 tests and eleven browser journeys passed; unified timeline/broader notification categories pending |
| Clearance dependencies | Authorized departments coordinate prerequisite reviews and explain blockers | Versioned procedure/configuration, grants and evidence | Pending/rejected/withdrawn/stale approvals block sensitive actions | Planned 3C |
| Regulatory decision intelligence | Reviewer can explain rules/evidence/uncertainty within findings | Existing pinned register, operational policies and frozen replay | Unverified official sources remain unverified; no synthetic authority | Existing foundation; 3D extension pending |
| Evidence graph | Reviewer explores authorized relationships/conflicts in the case | Relational identities, versions and findings | Relationship signal is not a fraud determination | Planned 4B |
| What-if simulator | Institution/reviewer tests proposed changes without mutating real records | Frozen case facts, continuity/policy/procedure inputs | Explicit hypothetical/provisional outcomes; no real submissions/approvals | Planned 4B |
| Audit/infrastructure hardening | Auditor/operator verifies integrity and recovers service | Existing append-only audit, storage, jobs and migrations | Chain/checkpoint trust assumptions and external execution limits disclosed | Planned 4C extension |
| Accessible workspace/analytics | Each role sees useful actions and measured workload, not decorative charts | Actual authorized database aggregates and minimal task telemetry | Clear empty/error states; no invented statistics or productivity claims | Existing UI retained; 4D refinement pending |

No duplicate portal or separate graph service is introduced. Each new capability belongs to submission, case review, lifecycle or administrative decision workflows. Every completed milestone must add authorization, persistence, failure and browser evidence before its status is promoted.

Accepted follow-up: lifecycle timeline, evidence-bound amount observations and broader notification categories are implemented; 114 tests, build/types and twelve journeys pass. Private immutable reminder delivery history is visible in the existing case workspace. Clearance-delay/release events remain dependent on 3C. See the continuity report for exact scope and limitations.

Clearance implementation is now connected to the existing portal: versioned server-configured procedure activation, department permissions, selected-source review queues, explicit blockers, internal maker/checker, retained decision history and guarded closure/reopening. Targeted tests pass; integrated acceptance remains pending. Official procedure confirmation/external release remain unavailable; synthetic fixtures are visibly fictional. See phase-3-clearances-report.md.

Clearance acceptance: 128 tests/build/types and thirteen browser journeys passed. Internal workflow checkpoint is accepted; official-source confirmation and external execution are not established. Remaining Phase 3D/4 scope remains open.

Policy decision explanation/history now implemented and connected to the case portal: recorded source/rule/fact references, authority separation, missing evidence, explicit recorded/current replay and exact historical extraction viewing. Accepted with 136 tests/build/types and fourteen journeys. Official authority remains unconfirmed; Phase 4 extensions remain pending.


## Phase 4A accepted held-out checkpoint
Recognition frozen at 526b07b before both final held-out runs. Twelve completions each, zero failures. Revised all eleven present fields exact, zero incorrect unflagged; two deliberately conflicting IFSCs withheld. Bank one and IFSC four review candidates remain. Baseline IFSC already10/10, most other fields6/12, type0/12. No subsequent OCR tuning. See phase-4a-ocr-report.md and raw final-*-heldout artifacts. Full144 tests/build/types/fifteen browser evidence remains applicable, source unchanged. Proceed to4B authorized relationships/read-only simulator, then4C-4E; overall scope remains incomplete.
