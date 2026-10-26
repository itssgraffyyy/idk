import { test as base, expect } from "@playwright/test";
import { createApp, seed } from "../../src/server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const test = base.extend({
  caseServer: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-browser-isolated-")),
      app = createApp({ dir });
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
      await use("http://127.0.0.1:" + app.server.address().port);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  baseURL: async ({ caseServer }, use) => use(caseServer),
});
export { expect };
