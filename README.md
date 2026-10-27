# FDR Sentinel

An existing local evidence and review application, extended in place through Phase3 operational workflows and Phase4 intelligence/security/UX capabilities. Final integrated acceptance is in progress; [implementation progress](docs/implementation-progress.md) records actual checkpoints. No framework rewrite, working-data reset or remote push was performed.

Real banking/issuer confirmation is separate from application workflow. Official AICTE authority remains unverified; MOCK and Setu sandbox results are explicitly labelled. A real versioned IFSC reference does not authenticate an FDR. All final administrative decisions require authorized human review; maturity never implies bank release.

## Run

Use **patched Node22.23.4 or later Node22.x** and npm. `.node-version`/`.nvmrc`, package engines, CI and container configuration pin the supported security baseline. The CLI refuses older/unqualified runtimes. The globally installed Node on the development host was not replaced; a verified workspace-local22.23.4 binary is used for final validation.

```powershell
npm ci --ignore-scripts --no-audit
npm run setup
npm start
```

Open http://127.0.0.1:3000. Save the random setup passwords privately. Rerunning setup never resets existing credentials. No real financial documents are needed for local validation. Set DATA_DIR explicitly to choose a persistent private directory; only one app process may own it. Environment settings are explicit shell variables, not automatically loaded from .env. See [.env.example](.env.example) and [deployment](docs/deployment.md).

On this workspace, the verified patched executable can be invoked directly without changing the system installation:

```powershell
& .\.scratch\node-runtime\node-v22.23.4-win-x64\node.exe src/server.js
```

The ignored local runtime is not part of a clone or release bundle. Install the documented supported runtime on another host. Do not delete signing/encryption keys or checkpoints to bypass startup protection.

## Workflows

Institution users can manage saved upload-first submissions, explicitly accept extraction proposals, track obligations/instruments, resolve requested facts and inspect financial continuity. Reviewers use scoped queues, source-linked evidence comparison, protected PDF pages, immutable correction/evaluation history and structured clarifications. Configured departments receive only selected evidence; a separate checker records source-bound internal decisions. Administrators manage institution/programme/approval records and accounts according to their role.

Relationship exploration and what-if scenarios stay in the case context. Simulations freeze inputs and preserve exact replay without changing real evidence, workflow or approval state. Overview/analytics use actual currently authorized records; task measurement is optional and content-free. Money is exact integer paise;10000000 means INR100000.

## Validate

```powershell
npm run lint
npm run typecheck
npm run verify
npm run test:e2e
npm run validate:clean
node scripts/benchmark-phase-4.js
```

Browser fixtures use temporary databases and dynamically assigned loopback ports. Google Chrome is required; CHROME_PATH overrides the installed executable path. The frontend is buildless: syntax/asset validation is not a Next.js build. Heavy tests/benchmarks run sequentially to avoid contaminating resource measurements.

OCR uses real local engines and packaged models without mandatory paid APIs. Frozen42-case development/validation/held-out layouts and original48 rasters are retained; [OCR acceptance](docs/phase-4a-ocr-report.md) reports per-field accuracy, withheld conflicts, review load and cold/warm CPU/RSS. Synthetic recognition and scripted navigation do not establish real-document accuracy or human productivity gains. Do not regenerate frozen held-out data or tune from its results.

## Evidence and limits

- [Current traceability](docs/requirements/traceability.md) and [feature integration](docs/product/feature-coverage.md).
- [Security controls/trust boundaries](docs/phase-4c-security-report.md), [signed backup/isolated restore](docs/backup-and-restore.md), [procedure confirmations](docs/procedure-confirmations.md).
- [Operational UX/analytics](docs/phase-4d-ux-analytics-report.md), [relationship/scenario report](docs/phase-4b-analysis-report.md).
- [Architecture decision](docs/architecture/stack-decision.md): retain Node/browser/SQLite, use relational identities/graphs; distributed deployment requires deliberate shared database/storage/leased-worker design.

Docker/Compose and CI are configured; Docker is unavailable on this host and no remote CI run is claimed. Production requires protected TLS/Host/volume/key/checkpoint/backup custody, real scanner operation and independent issuer/bank/security acceptance. Local tests do not authorize unattended financial/regulatory automation.
