> Current status: see [audit update](../audit-status-update.md) and [completion report](../phase-1-2-completion-report.md). Baseline descriptions below are retained for history.

# Domain model
| Record | Identity and constraints |
|---|---|
| User | Unique email, scrypt password digest and salt, institution/officer role, tenant |
| Institution | Tenant primary key, initial registered name, created time |
| Session | SHA-256 token digest, user FK, CSRF secret, absolute expiry |
| Case | UUID, tenant, assigned officer FK, name, obligation facts, declared instrument JSON, optimistic revision |
| Evidence | UUID, case FK, kind, payload, actor, timestamp; update/delete blocked by triggers |
| Job | UUID, case/document IDs, status, error, created |
| Audit | Monotonic ID, actor, action, case, payload, timestamp; update/delete blocked |
| Migration | Applied schema-version integer |

Financial values use integer paise with safe-integer validation and database guards on case insertion and instrument changes. Dates use strict ISO calendar dates. Obligation and instrument snapshots use JSON in this small SQLite model; they are not a multi-instrument accounting ledger. One obligation/instrument per case is supported. Duplicate references are findings, not uniqueness constraints.

Extraction records reference source document IDs and retain recognized lines, raw OCR blocks/coordinates and uncalibrated confidence. Human corrections append new extraction records with prior values and source IDs. Evaluation records embed facts, rule identifier, findings, source references, version, case revision and supersedes ID. Re-evaluation appends records; older conclusions remain readable. Correction of a reference also refreshes affected duplicate cases in the same tenant.
