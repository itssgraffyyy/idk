# Local deployment and recovery

Use patched Node22.23.4 or a later supported Node22.x release; the CLI rejects older or unqualified runtimes. `npm ci --ignore-scripts --no-audit`, `npm run setup`, then `npm start`. Setup prints credentials only for new accounts; retain them privately. Rerunning setup preserves credentials/data. Set DATA_DIR to a private persistent directory. One process owns each directory; never remove an active owner's lock. See .env.example: variables must be set explicitly; there is no automatic dotenv loading.

## Runtime configuration

- APP_HOST defaults127.0.0.1; PORT defaults3000. Set COOKIE_SECURE=true with correctly configured HTTPS and explicit ALLOWED_HOSTS in deployment. Do not expose an unprotected development instance.
- POLICY_FILE, PROCEDURE_FILE and PROCEDURE_CONFIRMATIONS_FILE point to operator-owned JSON registers. Defaults do not establish real authority. See procedure-confirmations.md and regulatory docs. Never mark unconfirmed real issuer rules verified. Client input cannot create issuer confirmation.
- MFA_REQUIRED_ROLES is a comma-separated role list. Configure external MFA_KEY_FILE, AUDIT_KEY_FILE and AUDIT_CHECKPOINT_FILE as needed; defaults under DATA_DIR/security are local convenience, not independent custody. Keep keys/checkpoints and backup verification material protected. Never delete/change keys to reset existing enrollment or audit history.
- CLAMAV_HOST/PORT configure actual INSTREAM scanning; UPLOAD_SCAN_REQUIRED=true fails uploads closed unless a valid scanner observation is obtained. Unconfigured/unavailable is explicit, not clean. A scanner result does not authenticate a bank document.
- LOG_REQUESTS=true emits structured scrubbed request metadata. TESSERACT_PATH optionally selects native Tesseract; otherwise packaged local WASM/model is used. Document children receive a minimal environment. Real Setu sandbox configuration remains optional and requires an authorized product/consent; no credentials are supplied.

## Containers and CI

`docker compose build`; before first start use `docker compose run --rm sentinel node scripts/setup.js`, record generated credentials privately, then `docker compose up -d`. Existing Node application is packaged without framework conversion. Named volume preserves SQLite/private files; node user, dropped capabilities and loopback publishing are configured. /api/health and /api/ready support probes. Secret/local-work paths are excluded from the build context. Docker is unavailable on this host; these commands are configuration, not an executed container acceptance result.

The Windows quality workflow runs lint, types, verification, benchmarks, native clean installation and browser journeys. It disables implicit npm advisory transmission. Advisory upload is opt-in via repository variable ALLOW_NPM_ADVISORY_AUDIT=true; the local owner-approved audit is separately recorded. No remote CI run or push is claimed. Use CHROME_PATH for a supported installed Chrome path; browser fixtures use isolated temporary databases and dynamically assigned loopback ports.

## Storage and recovery

Private storage uses immutable UUID objects, exclusive writes, flushing and SHA256 verification on read. Interrupted/unreferenced objects are quarantined under recovery/orphans at startup; inspect before manual deletion. Missing/corrupt committed bytes fail closed. Alternative adapters must satisfy src/contracts.d.ts and storage contract tests; S3 remains optional/unconfigured.

Use the implemented stopped-source signed bundle and isolated restore commands in [backup-and-restore.md](backup-and-restore.md). Database and referenced private/draft objects are copied together, verified with external keys and restored only to a new directory; copied sessions are revoked. Never silently replace a production checkpoint with an old archive. Keep the source, keys, independent checkpoints and migration backups until explicit recovery review.

Production operation additionally requires managed TLS/Host settings, private volume ACL/encryption, real scanning, independently protected signing/checkpoint/backup custody, consented issuer/bank acceptance and operational security review. Child time/heap/concurrency bounds are not OS filesystem/network sandboxing or a total-RSS limit. SQLite supports a single owning process; distributed deployment requires a deliberate shared database/storage/leased-worker design.

Native clean install/start/upload/process/restart is exercised by `npm run validate:clean` in an isolated directory. Full local acceptance and load results are recorded separately; no configuration file alone establishes successful deployment or production scale.

