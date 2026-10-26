> Current status: see [audit update](../audit-status-update.md) and [completion report](../phase-1-2-completion-report.md). Baseline descriptions below are retained for history.

# Security controls and limits
Implemented: scrypt (random per-user salt), cryptographic random session/CSRF tokens, stored token digests, absolute 8-hour expiry, logout revocation, server roles/tenant checks, assigned-officer filtering, origin/CSRF checks, login throttle (15 attempts/minute/IP), parameterized queries, payload bounds, strict financial/date validation, 4 MiB upload limit, image decode and 10-megapixel bounds, private UUID paths, SHA-256 retrieval checks, immutable evidence/audit triggers, revision conflicts, CSP and no-store headers.

Tests cover unauthorized/other-tenant/other-officer access, privilege escalation, static private-path rejection, invalid/truncated/oversized images, large upload rejection, malformed JSON, CSRF/origin, expired/revoked sessions, immutable audit/history and negative money. See tests/app.test.js and tests/resilience.test.js.

Security tests align thematically with OWASP ASVS 5.0 authentication, session management, authorization, validation, file handling and logging. This is not a complete ASVS requirement assessment. Official reference: https://asvs.owasp.org/ (consulted 26 October 2026).

Limitations: no MFA, account recovery/password rotation UI, distributed throttling, malware scanner, OS sandbox, encrypted storage, audit chaining/checkpoints, independent audit log, release/maker-checker authorization, automatic backups, production TLS configuration or hardened multi-instance operations. JSON history is currently unpaginated. Future extension points are documentation, not implemented controls. Node 22 node:sqlite is experimental; pin/test runtime upgrades.

Runtime data is ignored by Git. Protect filesystem ACLs and use synthetic data only. Production must require HTTPS/Secure cookies, protected secrets/keys and reviewed user provisioning.
