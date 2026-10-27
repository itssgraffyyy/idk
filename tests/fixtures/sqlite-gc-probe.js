import { DatabaseSync } from "node:sqlite";
import { iterateRows } from "../../src/sqlite-rows.js";
const db = new DatabaseSync(":memory:");
const sql =
  "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<250) SELECT x FROM n";
let rows = 0;
try {
  if (typeof globalThis.gc !== "function")
    throw Error("Run child with --expose-gc");
  const iterator =
    process.argv[2] === "unsafe"
      ? db.prepare(sql).iterate()
      : iterateRows(db, sql);
  for (const row of iterator) {
    if (row.x !== ++rows) throw Error("Row ordering changed");
    if (rows % 5 === 0) globalThis.gc();
  }
  for (const row of iterateRows(db, sql)) {
    if (row.x !== 1) throw Error("Early exit changed ordering");
    break;
  }
  try {
    for (const row of iterateRows(db, sql)) {
      if (row.x === 1) throw Error("intentional consumer failure");
    }
  } catch (error) {
    if (error.message !== "intentional consumer failure") throw error;
  }
  const first = iterateRows(db, sql);
  if (first.next().value.x !== 1) throw Error("Reuse failed");
  first.return();
  console.log(
    JSON.stringify({
      node: process.version,
      rows,
      passed: rows === 250,
      forcedGCCycles: 50,
      earlyExitAndConsumerFailure: true,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      node: process.version,
      rows,
      passed: false,
      message: error.message,
      stack: error.stack,
    }),
  );
  process.exitCode = 1;
} finally {
  db.close();
}
