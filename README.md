# FDR Sentinel
A local evidence and review application for fictional security deposits. This is a functional development baseline, not a completed production compliance system. AICTE policy decisions remain unconfirmed; banking evidence and IFSC lookups use explicitly fictional adapters.

## Run (Windows PowerShell)
Requires Node.js 22.13+ (tested 22.14), npm, and Google Chrome for browser tests.
```powershell
npm ci
npm run setup
npm start
```
Save the random passwords printed by setup. Open http://127.0.0.1:3000. Setup creates institution@sentinel.local, other@sentinel.local and officer@sentinel.local. Re-running setup never resets existing credentials. Do not use real financial documents in this development environment.

Institution: register obligation and instrument, upload a TXT/PNG/JPEG, process it, review findings, correct declarations/extracted fields, respond to clarification. Officer: open assigned cases, preview/download sources, retrieve fictional provider scenarios, compare findings, request clarification and record observations. Every persisted operation uses a backend API.

Money is integer paise: 10000000 means INR 100,000. Original evidence, document bytes and evaluation versions are retained. Upload a new version instead of deleting one. Every case remains subject to authorized human review.

## Verify
```powershell
npm test
npm run test:e2e
npm run dataset
powershell -NoProfile -File scripts/render-fixtures.ps1
npm run benchmark
npm run benchmark:ocr
npm run benchmark:system
```
The browser runner owns an isolated database, starts port 3107, uses installed Chrome, and tears down its server. Avoid another server on that port. CHROME_PATH overrides Chrome's executable path. The frontend is buildless; Node syntax checks and Playwright verify its executable assets. No frontend compilation step is required.

The raster fixtures are committed, so image tests work without regenerating them. Windows System.Drawing is only needed to regenerate raster fixtures. Dataset expansion: node scripts/dataset.js 100; then render and benchmark. The 20-case default has 16 development and 4 held-out cases with an unseen layout. Small synthetic benchmarks are not estimates of accuracy on real bank documents.

## Configuration
| Variable | Default | Purpose |
|---|---|---|
| PORT | 3000 | HTTP port, bound to loopback |
| DATA_DIR | data | SQLite and private evidence directory |
| COOKIE_SECURE | false | Set true behind a correctly configured HTTPS deployment |
| TESSERACT_PATH | unset | Optional native Tesseract executable; otherwise local Tesseract.js WASM and packaged English model |
| CHROME_PATH | Windows Google Chrome path | Browser test executable |
| EXTERNAL_SERVER | unset | Internal Playwright runner flag |
No banking API credentials are used. OCR does not download models at runtime. Runtime data and passwords are not committed.

## Repository
- src: HTTP API, SQLite migrations, intelligence, policy gate, financial adapter, OCR isolation.
- public: responsive institution and officer portals.
- datasets/v1: reproducible fictional text and raster cases plus ground truth.
- tests: API, security, policy, resilience and Playwright journeys.
- docs: architecture, traceability, threat model, rule register and measured results.

Read [implementation report](docs/implementation-report.md), [results](docs/evaluation/results.md), [limitations](docs/security/security-controls.md), and [API](docs/api.md) before extending or deploying. Phase 1/2 are not declared fully complete: outstanding acceptance items are explicitly listed in traceability.
