# Threat model
Assets: private documents, session credentials, institution boundaries, financial facts, source history and officer observations.
Actors: unauthenticated visitor, malicious institution, officer outside assignment, compromised local user and malformed image author.

| Threat | Implemented boundary | Residual risk |
|---|---|---|
| Cross-tenant ID guessing | Per-object tenant/assignment check; inaccessible case returns 404 | Database/file administrator bypasses app |
| Session theft/CSRF | HttpOnly/SameSite cookie, CSRF secret, origin check, expiry/revocation | Local HTTP is unsuitable beyond loopback |
| SQL injection | Bound statements | Trusted deployment/operator changes remain privileged |
| XSS/file execution | Escaped UI text, CSP, MIME validation, attachment default | Dependency and browser vulnerabilities |
| Traversal | UUID storage IDs; exact route matching; no filename-based paths | Host filesystem compromise |
| Malicious raster | Decode checks, pixel/memory limits, bounded child process | Child process is not an OS sandbox |
| Evidence tampering | Hash-on-download and immutable DB triggers | No independent cryptographic checkpoint; DB owner can remove triggers |
| Denial of service | Body/file limits, login throttling, OCR concurrency cap | No distributed/global API rate limiting; histories unpaginated |

No compliance certification or penetration-test claim is made. Private filesystem storage is not encryption. Windows inherits directory ACLs; operators must secure runtime directories. Keep this installation local until a deployment security review.
