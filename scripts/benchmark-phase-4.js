import { harness, instrument } from "../tests/support/harness.js";
import { writeFileSync, appendFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";

const h = await harness();
const started = performance.now(),
  cpu = process.cpuUsage();
let peakRSS = process.memoryUsage().rss;
const memory = setInterval(() => {
  peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
}, 25);
const results = [];
const journal =
  "docs/evaluation/phase-4e-load-progress-" + Date.now() + ".jsonl";
appendFileSync(
  journal,
  JSON.stringify({
    node: process.version,
    admissionRatePerSecond: 4,
    admissionPacingExcludedFromRequestLatency: true,
  }) + "\n",
);
let nextAdmission = performance.now();
const admit = async () => {
  const now = performance.now(),
    slot = Math.max(now, nextAdmission);
  nextAdmission = slot + 250;
  if (slot > now) await new Promise((ok) => setTimeout(ok, slot - now));
  return performance.now() - now;
};
const sample = async (name, fn, n = 20, concurrency = 1) => {
  const times = [];
  let failures = 0,
    inFlight = 0,
    maxObservedInFlight = 0,
    admissionWaitMsTotal = 0;
  for (let offset = 0; offset < n; offset += concurrency)
    await Promise.all(
      Array.from({ length: Math.min(concurrency, n - offset) }, async () => {
        admissionWaitMsTotal += await admit();
        const t = performance.now();
        maxObservedInFlight = Math.max(maxObservedInFlight, ++inFlight);
        try {
          await fn();
        } catch (e) {
          failures++;
          throw e;
        } finally {
          inFlight--;
          peakRSS = Math.max(peakRSS, process.memoryUsage().rss);
          times.push(performance.now() - t);
        }
      }),
    );
  times.sort((a, b) => a - b);
  results.push({
    name,
    samples: times.length,
    concurrency,
    maxObservedInFlight,
    admissionWaitMsTotal,
    failures,
    p50Ms: times[Math.ceil(times.length * 0.5) - 1],
    p95Ms: times[Math.ceil(times.length * 0.95) - 1],
    maxMs: times.at(-1),
  });
  appendFileSync(
    journal,
    JSON.stringify({ ...results.at(-1), latenciesMs: times }) + "\n",
  );
};
try {
  const a = await h.login("a"),
    b = await h.login("b"),
    o = await h.login("o"),
    s = await h.login("s");
  let index = 0;
  const ids = [];
  await sample(
    "Create persisted cases with signed audit checkpoints",
    async () => {
      const id = await h.create(index < 150 ? a : b, {
        name: "Synthetic load cohort " + index,
        instrument: { ...instrument, reference: "LOAD-" + index++ },
      });
      ids.push(id);
    },
    200,
  );
  const path = "/cases/" + ids[0];
  const get = async (route, auth = a) => {
    const r = await h.call(route, undefined, auth);
    if (r.status !== 200)
      throw Error(
        route + " returned " + r.status + ": " + JSON.stringify(r.body),
      );
    return r.body;
  };
  await sample(
    "Tenant case search and stable page",
    () => get("/cases?q=LOAD&limit=25"),
    40,
    5,
  );
  await sample("Bounded case evidence history", () => get(path), 40, 5);
  await sample(
    "Scoped operational analytics:150 cases",
    () => get("/analytics?days=30"),
    20,
  );
  await sample(
    "Authorized relationships:200 accessible cases",
    () => get(path + "/relationships", o),
    10,
  );
  await sample(
    "Department queue:empty configured register",
    () => get("/clearance/queue?limit=25", o),
    20,
    5,
  );
  await sample(
    "Whole audit-chain verification by supervisor",
    () => get("/security/audit-integrity", s),
    5,
  );
  let uploads = 0;
  await sample(
    "Publish bounded synthetic text documents",
    async () => {
      const r = await h.call(
        path + "/documents",
        {
          name: "load-" + uploads++ + ".txt",
          mime: "text/plain",
          base64: Buffer.from(
            "Reference: LOAD-0\nDeposit Amount: INR 125000\nBank: HDFC Bank\nIFSC: HDFC0001234\nIssue Date: 2026-01-01\nMaturity Date: 2031-01-01",
          ).toString("base64"),
        },
        a,
      );
      if (r.status !== 201) throw Error(JSON.stringify(r.body));
    },
    5,
  );
  await sample(
    "Text extraction and complete deterministic reevaluation (not OCR)",
    async () => {
      const r = await h.call(path + "/process", {}, a);
      if (r.status !== 200) throw Error(JSON.stringify(r.body));
    },
    5,
  );
  await sample(
    "Local MOCK provider through API and deterministic evaluation",
    async () => {
      const r = await h.call(
        path + "/external",
        { scenario: "mock_confirmed" },
        o,
      );
      if (r.status !== 200) throw Error(JSON.stringify(r.body));
    },
    10,
  );
  await sample(
    "Source-linked regulatory decision explanation",
    () => get(path + "/policy-decisions", o),
    20,
  );
  const ops = await get(path + "/operations");
  const snapshot = await h.call(
    path + "/analysis/snapshots",
    { inputRevision: ops.input_revision },
    a,
  );
  if (snapshot.status !== 201) throw Error(JSON.stringify(snapshot.body));
  await sample(
    "Persist read-only baseline scenario",
    async () => {
      const r = await h.call(
        path + "/analysis/scenarios",
        {
          snapshotId: snapshot.body.id,
          changes: {
            asOf: "2026-10-27",
            starts: "2026-01-01",
            ends: "2031-01-01",
          },
        },
        a,
      );
      if (r.status !== 201) throw Error(JSON.stringify(r.body));
    },
    10,
  );
  const foreign = await h.call("/cases/" + ids.at(-1), undefined, a);
  if (foreign.status !== 404) throw Error("Cross-tenant object was accessible");
  const report = {
    node: process.version,
    platform: process.platform,
    cpu: cpus()[0]?.model,
    logicalCPUs: cpus().length,
    totalMemoryBytes: totalmem(),
    dataset: {
      syntheticCases: 200,
      institutionA: 150,
      institutionB: 50,
      realBankData: false,
    },
    method:
      "Sequential endpoint groups, admission paced at four requests/second beneath the default300/IP/minute limit. Pacing waits excluded from request latency; configured concurrency and actual maximum in flight reported separately. HTTP loopback, one SQLite owner with WAL/signed audit checkpoints. No production SLA/distributed-scale claim. CPU/RSS are main-process measurements; native OCR measured separately. Scenario dates are explicit hypothetical assumptions.",
    journal,
    results,
    elapsedMs: performance.now() - started,
    cpuMicroseconds: process.cpuUsage(cpu),
    peakSampledRSSBytes: Math.max(peakRSS, process.memoryUsage().rss),
    crossTenantObjectDenied: true,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(
    "docs/evaluation/phase-4e-load.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearInterval(memory);
  await h.close();
}
