import { createApp, seed } from "../src/server.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "sentinel-latency-")),
  app = createApp({ dir });
seed(app.db, [
  {
    id: "a",
    email: "a@test.local",
    password: "benchmark-only-password",
    role: "institution",
    tenant: "a",
  },
  {
    id: "o",
    email: "o@test.local",
    password: "benchmark-only-password",
    role: "officer",
    tenant: "authority",
  },
]);
await new Promise((ok) => app.server.listen(0, "127.0.0.1", ok));
const base = "http://127.0.0.1:" + app.server.address().port;
try {
  const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "a@test.local",
        password: "benchmark-only-password",
      }),
    }),
    cookie = login.headers.get("set-cookie").split(";")[0],
    u = await login.json();
  for (let i = 0; i < 20; i++) {
    const r = await fetch(base + "/api/cases", {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": u.csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Fictional Benchmark Institute",
        instrument: {
          reference: "BENCH-" + i,
          amountPaise: 10000000,
          bank: "Synthetic Bank",
          ifsc: "SYNB0000001",
          issued: "2026-01-01",
          matures: "2030-01-01",
        },
        obligation: { amountPaise: 10000000 },
      }),
    });
    if (r.status !== 201) throw Error("Case setup failed");
    await r.json();
  }
  const latencies = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now(),
      r = await fetch(base + "/api/cases", { headers: { cookie } });
    if (r.status !== 200) throw Error("Benchmark failed");
    await r.json();
    latencies.push(performance.now() - start);
  }
  latencies.sort((a, b) => a - b);
  const report = {
    node: process.version,
    platform: process.platform,
    configuration: {
      dataset: "20 generated fictional records",
      endpoint: "GET /api/cases",
      samples: 100,
      concurrency: 1,
      transport: "HTTP loopback",
    },
    latencyMs: {
      p50: latencies[49],
      p95: latencies[94],
      max: latencies.at(-1),
      mean: latencies.reduce((a, b) => a + b, 0) / 100,
    },
  };
  writeFileSync(
    "docs/evaluation/system-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
