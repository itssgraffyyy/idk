// Node22.14's iterator does not retain its StatementSync against GC (nodejs/node#57569).
// Pin streaming statements explicitly; do not materialize unbounded audit histories.
const activeStatements = new Set();
export function* iterateRows(db, sql, ...parameters) {
  const statement = db.prepare(sql);
  activeStatements.add(statement);
  try {
    yield* statement.iterate(...parameters);
  } finally {
    activeStatements.delete(statement);
  }
}
