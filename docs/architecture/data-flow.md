> Current status: see [audit update](../audit-status-update.md) and [completion report](../phase-1-2-completion-report.md). Baseline descriptions below are retained for history.

# Data flow
1. Authenticate; store only hashed session token server-side and issue HttpOnly SameSite cookie.
2. Authorize tenant ownership or exact officer assignment for each case resource.
3. Register institution profile, obligation and declaration atomically.
4. Validate file size and UTF-8/image content; fully decode PNG/JPEG with pixel/memory bounds. Store UUID file privately and record SHA-256.
5. Record processing job; extract text directly from TXT or run image OCR in a bounded child process. Preserve failed attempts.
6. Preserve extracted values and document provenance; do not replace original evidence after corrections.
7. Compare declaration, document extraction, registered obligation and fictional financial evidence. IFSC reference is separately queryable and explicitly fictional.
8. Generate review findings and unresolved policy/bank status. Embed immutable input snapshots.
9. Officer requests clarification; institution responds using request ID. Both remain in history.
10. Save new evaluation on relevant evidence or correction. Preview/download authorization is rechecked; SHA-256 mismatch rejects retrieval.

Text import is not called OCR. No financial provider response authenticates a deposit. A new upload makes earlier extraction inapplicable until processed; historical extraction is preserved.
