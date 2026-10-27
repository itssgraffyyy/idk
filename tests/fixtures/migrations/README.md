# Frozen synthetic migration fixtures

These are populated schemas 13, 14 and 15, frozen from checkpoint `ca4eb76` before adding schema 17. They contain only fictional test accounts/cases, actual extraction of synthetic text and immutable version/evaluation records. Sessions are removed. No authentic banking evidence, private institution data or production credentials are included.

Each database has a separate SHA-256 manifest. Tests verify that digest before copying the database into a new temporary directory, then run the current migrations and compare exact case, evidence, source-version and notification rows. Source hashes represent the synthetic source bytes; the database fixtures do not include private source-file storage. Schema 14 includes a legacy notification whose original message/key/time must survive with explicitly incomplete provenance.

`scripts/freeze-migration-fixtures.js` is an archival generator restricted to schema-16 code. It refuses to overwrite a frozen file and uses temporary databases only. To reproduce, use the schema-16 checkpoint plus that generator; do not regenerate these fixtures after future migrations. Add a separately versioned fixture when another historical schema needs coverage.

SQLite triggers provide application-level immutability here. These fixtures do not establish resistance to database-administrator tampering or production restore readiness.
