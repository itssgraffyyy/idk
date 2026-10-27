import { test as base, expect } from "@playwright/test";
import { createApp, seed } from "../../src/server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const test = base.extend({
  caseServer: [
    async ({}, use) => {
      const started = performance.now();
      const dir = mkdtempSync(join(tmpdir(), "sentinel-browser-isolated-")),
        app = createApp({
          dir,
          logSink: (event) => {
            if (
              event.category === "reminder_scheduler" ||
              process.env.BROWSER_DIAGNOSTICS === "true"
            )
              console.log(JSON.stringify(event));
          },
        });
      seed(
        app.db,
        [
          ["admin", "institution_admin", "fictional"],
          ["supervisor", "supervisor", "authority"],
          ["auditor", "audit_reviewer", "authority"],
          ["institution", "institution", "fictional"],
          ["officer", "officer", "authority"],
        ].map(([name, role, tenant]) => ({
          id: name === "institution" ? "a" : name === "officer" ? "o" : name,
          email: name + "@test.local",
          password: "test-" + name + "-password",
          role,
          tenant,
        })),
      );
      try {
        await new Promise((ok, no) =>
          app.server.once("error", no).listen(0, "127.0.0.1", ok),
        );
        console.log(
          JSON.stringify({
            browserFixture: { startupMs: performance.now() - started },
          }),
        );
        await use("http://127.0.0.1:" + app.server.address().port);
      } finally {
        if (base.info().status !== base.info().expectedStatus)
          console.log(
            JSON.stringify({
              browserFixtureFailure: {
                nodeTime: new Date().toISOString(),
                preferences: app.db
                  .prepare(
                    "SELECT windows,enabled,categories FROM reminder_preferences",
                  )
                  .all(),
                operations: app.db
                  .prepare(
                    "SELECT stage,updated,input_revision FROM case_operations",
                  )
                  .all(),
                deliveries: app.db
                  .prepare("SELECT count(*) n FROM reminder_deliveries")
                  .get().n,
              },
            }),
          );
        await app.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    { timeout: 120000 },
  ],
  baseURL: async ({ caseServer }, use) => use(caseServer),
});
export { expect };
