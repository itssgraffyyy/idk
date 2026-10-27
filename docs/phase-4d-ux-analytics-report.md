> Final local acceptance: [Phase3 +4 completion report](phase-3-4-completion-report.md).186 backend tests,21 browser journeys, frozen OCR/load/native-install checks pass; older pending-milestone statements below are historical. External authority/deployment limits remain.

# Phase 4D: operational overview and measured interaction

Implemented in the existing role portals: a compact attention overview beside the registry, source-safe case links, optional expanded analytics, role-specific team aggregation, keyboard focus on view changes, a skip link, reachable mobile navigation, stronger small-text contrast and collapsible secondary metrics. The original registry, evidence comparison, protected viewer, domain administration and review workflows remain connected.

`src/workflow-metrics.js` and additive migration22 persist optional, immutable task measurements and derive inventory/history from current case authorization. Cases are bounded at500 and history categories at10000; oversized queries return413. Institution accounts see their tenant, officers assigned cases, supervisors/auditors their authority. Department grants do not grant broad analytics. Reassignment revokes metric contributions. No financial or document values enter measurement events. Measurements store enum task, elapsed duration, unique changed control count, validation corrections, clicks, errors and help opens; abandoned tasks are discarded. Actor/time and optional authorized case link provide provenance. Raw user values, field names, document contents, coordinates, keystrokes and browser fingerprints are not collected. No automatic tracking starts.

Current stage/finding categories are inventory, separate from the selected7/30/90/365-day UTC event window. Recorded non-superseded instruments and linked obligations are not certified active bank deposits or legal compliance. Pending department signals mean latest recorded request state, not independent evidence of applicable clearance. Aging means time since last operational update. Timings distinguish first preparation, clarification response, first internal decision, department response, extraction duration and ready-to-review waiting; absent samples remain unknown. Repeated reviews/reopening and evaluation finding trends come from persisted events. All definitions appear in the UI.

## Feature integration

| Workflow / user | Purpose and reused records | Permission and failure behavior |
| --- | --- | --- |
| Attention / all signed-in roles | Missing evidence, changed inputs, clarifications, maturity and pending requests reuse cases, versions and operational state | Existing full-case authorization; bounded failure offers retry/queues |
| Evidence / institution and reviewers | Existing comparison, finding source links, corrections and protected document viewer | Existing selected versions and correction history; no inferred bank confirmation |
| Lifecycle / institution and reviewers | Existing continuity proposals, timelines and reminders reuse obligation/instrument relationships | Guarded registration; bank release remains independent |
| Administration / configured reviewers | Existing conditional departments, scoped grants and maker/checker decisions | Source/configuration/current-input binding; errors preserve history |
| Relationships and scenarios / case users | Existing collapsed in-case graph tables and read-only snapshots | Same case authorization, bounded queries; no live-state mutation |
| Analytics / case users; team totals for supervisors/auditors | Database event timings, stage backlog, finding trends and workload | Live accessible-case predicate; no global cross-tenant totals |
| Optional measurement / domain writers | User-started task categories and counts reuse audit/session identity | Explicit action, CSRF, bounded exact contract; no content; auditors cannot write |

Institution records, new submission, actions/clarifications and clearance queues remain purpose-specific existing navigation; related lifecycle/report/help content stays in its case context. No duplicate standalone graph/chatbot product was added.

## Validation

Twelve analytics/operational/notification tests pass61.96s, including live tenant/assignment/authority boundaries, read-only auditors, private count isolation, immutable measurements, invalid payload rejection, exact completion windows, repeated-review/processing/waiting timings, current department request supersession and excessive-history rejection. Build80files, typecheck and structural lint pass. Two new browser journeys pass35.5s before final palette/current-request presentation changes; final integrated rerun follows. Keyboard/mobile navigation and actual saved measurement counters are checked. Screenshots inspected; measurement controls were moved into a normal-flow disclosure to eliminate content overlap, and secondary metric tables collapsed.

`evaluation/phase-4d-task-comparison.json` records six alternating current-build registry/overview trials with the same three synthetic cases and maturity-opening task. Both use one click and four API requests. Scripted timings include rendering/loopback effects; this is not a historical-build or human productivity study and establishes no productivity gain. A representative, consented human-task study remains external validation.

Final whole-suite/all-browser/migration/load/clean-start acceptance is pending separately. No production readiness claimed.
