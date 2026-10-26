import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, seed } from "../../src/server.js";
export const instrument = {
  reference: "PHASE12-TEST",
  amountPaise: 12500000,
  bank: "HDFC Bank",
  ifsc: "HDFC0001234",
  issued: "2026-01-01",
  matures: "2031-01-01",
};
export async function harness(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-complete-")),
    app = createApp({ dir, ...options });
  const accounts = [
    ["a", "institution", "college-a"],
    ["admin", "institution_admin", "college-a"],
    ["b", "institution", "college-b"],
    ["o", "officer", "authority"],
    ["p", "officer", "authority"],
    ["s", "supervisor", "authority"],
    ["r", "audit_reviewer", "authority"],
    ["x", "supervisor", "other-authority"],
  ];
  seed(
    app.db,
    accounts.map(([id, role, tenant]) => ({
      id,
      role,
      tenant,
      email: id + "@test.local",
      password: "phase12-password",
    })),
  );
  await new Promise((ok) => app.server.listen(0, "127.0.0.1", ok));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const call = async (path, body, auth = {}, extra = {}) => {
    const res = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...auth, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const login = async (id) => {
    const r = await call("/login", {
      email: id + "@test.local",
      password: "phase12-password",
    });
    if (r.status !== 200) throw Error("Login failed " + id);
    return {
      cookie: r.headers.get("set-cookie").split(";")[0],
      "x-csrf-token": r.body.csrf,
    };
  };
  const create = async (auth, overrides = {}) => {
    const r = await call(
      "/cases",
      {
        name: "Synthetic College",
        instrument,
        obligation: { amountPaise: 12500000 },
        ...overrides,
      },
      auth,
    );
    if (r.status !== 201) throw Error("Create failed " + JSON.stringify(r));
    return r.body.id;
  };
  return {
    dir,
    app,
    base,
    call,
    login,
    create,
    close: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
