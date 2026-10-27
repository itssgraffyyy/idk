// Test-only subprocess: probes failed startup cleanup against a synthetic database.
import { createApp } from "../../src/server.js";
import { syntheticPolicy } from "../support/clearance-fixtures.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
let result;
try {
  const app = createApp({
    dir: process.argv[2],
    policies: [syntheticPolicy],
    policyScope: "synthetic-test",
    procedures: [],
  });
  await app.close();
  result = { unexpectedSuccess: true };
} catch (error) {
  result = {
    status: error.status,
    ownerLockRemains: existsSync(join(process.argv[2], ".server.lock")),
  };
}
process.stdout.write(JSON.stringify(result));
