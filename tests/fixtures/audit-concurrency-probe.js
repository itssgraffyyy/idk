import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { verifyAudit, auditPaths } from "../../src/audit-integrity.js";
const [dir, release] = process.argv.slice(2),
  db = new DatabaseSync(join(dir, "sentinel.sqlite"), { readOnly: true });
try {
  const prepare = db.prepare.bind(db);
  let paused = false;
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (!paused && sql.startsWith("SELECT a.*,s.previous_mac"))
      return {
        iterate(...args) {
          const iterator = statement.iterate(...args),
            first = iterator.next();
          paused = true;
          process.send?.({ pinned: true });
          const deadline = Date.now() + 20000;
          while (!existsSync(release)) {
            if (Date.now() > deadline)
              throw Error("Concurrent writer did not release verifier");
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          }
          return (function* () {
            try {
              if (!first.done) yield first.value;
              yield* iterator;
            } finally {
              iterator.return?.();
            }
          })();
        },
      };
    return statement;
  };
  process.send?.({ result: verifyAudit(db, auditPaths(dir)) });
} catch (error) {
  process.send?.({ error: error.message });
  process.exitCode = 1;
} finally {
  db.close();
}
