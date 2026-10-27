import { fork, execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { cpus, totalmem, release } from "node:os";
const args = Object.fromEntries(
  process.argv.slice(2).map((v) => {
    const [k, ...rest] = v.replace(/^--/, "").split("=");
    return [k, rest.join("=")];
  }),
);
const splits = (args.splits || "development,validation").split(","),
  run = args.run || "baseline";
const corpus = args.corpus || "v4";
if (!["v4", "regression"].includes(corpus)) throw Error("Unknown corpus");
if (
  !/^[a-z0-9-]{1,60}$/.test(run) ||
  splits.some((s) => !["development", "validation", "held-out"].includes(s))
)
  throw Error("Invalid benchmark run/partitions");
if (splits.includes("held-out") && !run.startsWith("final-"))
  throw Error("Held-out recognition requires a final frozen-code run");
const workerRoot = resolve(args["worker-root"] || "."),
  hash = (b) => createHash("sha256").update(b).digest("hex");
const bytes = readFileSync("datasets/v4/manifest.json"),
  manifest = JSON.parse(bytes);
if (hash(bytes) !== readFileSync("datasets/v4/manifest.sha256", "utf8").trim())
  throw Error("Manifest integrity failure");
const sourceHashes = Object.fromEntries(
  readdirSync(join(workerRoot, "src"))
    .filter((file) => file.endsWith(".js"))
    .sort()
    .map((file) => [file, hash(readFileSync(join(workerRoot, "src", file)))]),
);
const codeCommit = execFileSync(
  "git",
  ["-C", workerRoot, "rev-parse", "HEAD"],
  { encoding: "utf8", windowsHide: true },
).trim();
const dirtyRecognitionFiles = execFileSync(
  "git",
  ["-C", workerRoot, "status", "--porcelain", "--", "src"],
  { encoding: "utf8", windowsHide: true },
);
if (splits.includes("held-out") && dirtyRecognitionFiles.trim())
  throw Error("Commit recognition changes before held-out evaluation");
const { extract } = await import(
  pathToFileURL(join(workerRoot, "src/extraction.js")).href
);
let selected = manifest.cases.filter((c) => splits.includes(c.split));
if (corpus === "regression") {
  const fingerprints = JSON.parse(
    readFileSync("datasets/v4/original-corpus-hashes.json"),
  );
  selected = ["v1", "v2", "v3"].flatMap((version) =>
    JSON.parse(readFileSync("datasets/" + version + "/cases.json")).cases.map(
      (c) => {
        const imagePath = "datasets/" + version + "/documents/" + c.id + ".png",
          frozen = fingerprints.files.find((f) => f.path === imagePath);
        if (!frozen) throw Error("Unfrozen original image");
        return {
          id: version + ":" + c.id,
          split: "regression",
          originalPartition: c.split,
          layout: version + "-" + (c.layout || "unspecified"),
          scenario: c.scenario,
          imagePath,
          sha256: frozen.sha256,
          groundTruth: c.groundTruth,
          expectedReview: [],
        };
      },
    ),
  );
  if (selected.length !== 48)
    throw Error("Original regression corpus must contain 48 images");
}
if (args.limit) {
  if (splits.includes("held-out"))
    throw Error("No selective held-out sampling");
  const limit = Number(args.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > selected.length)
    throw Error("Invalid sample limit");
  selected = selected.slice(0, limit);
}
const outputDir = "docs/evaluation/phase-4a";
mkdirSync(outputDir, { recursive: true });
const output = outputDir + "/" + run + ".json",
  journal = outputDir + "/" + run + ".jsonl";
if (existsSync(output) || existsSync(journal))
  throw Error(
    "Run artifacts already exist; choose a new run name and preserve evidence",
  );
const metadata = {
  run,
  corpus,
  classification: "SYNTHETIC_TEST_ONLY",
  manifestSHA256: hash(bytes),
  codeCommit,
  sourceHashes,
  dirtyRecognitionFiles: Boolean(dirtyRecognitionFiles.trim()),
  workerRoot,
  node: process.version,
  hardware: {
    cpuModel: cpus()[0]?.model || null,
    logicalCPUs: cpus().length,
    totalMemoryBytes: totalmem(),
    osRelease: release(),
    platform: process.platform,
    architecture: process.arch,
  },
  packageLockSHA256: hash(readFileSync(join(workerRoot, "package-lock.json"))),
  partitions: corpus === "regression" ? ["regression"] : splits,
  created: new Date().toISOString(),
  v8OldSpaceBudgetMiB: 384,
  memoryBudgetNote:
    "V8 old space only; native/WASM memory and total RSS are not capped by this flag",
  jobTimeoutMs: 60000,
  policy:
    "Baseline/development/validation may guide tuning. Final held-out runs require committed recognition code. No expected value enters recognition. Worker-process cold startup includes uncontrolled OS filesystem cache; RSS is a process-lifetime peak, not incremental per-job memory. Benchmark acceptance means a proposed value without explicit review/low-engine-confidence flags, never institution acceptance or bank confirmation.",
};
appendFileSync(journal, JSON.stringify({ metadata }) + "\n");
for (const c of selected)
  if (
    hash(
      readFileSync(c.imagePath || "datasets/v4/documents/" + c.id + ".png"),
    ) !== c.sha256
  )
    throw Error("Image integrity failure: " + c.id);
const env = {};
for (const key of [
  "SystemRoot",
  "WINDIR",
  "PATH",
  "TEMP",
  "TMP",
  "HOME",
  "LOCALAPPDATA",
])
  if (process.env[key]) env[key] = process.env[key];
let slot = null;
async function start() {
  const started = performance.now(),
    child = fork(
      fileURLToPath(new URL("./ocr-benchmark-worker.js", import.meta.url)),
      ["--service", join(workerRoot, "src/ocr-worker.js")],
      {
        execArgv: ["--max-old-space-size=384"],
        env,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        windowsHide: true,
      },
    );
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr = (stderr + data).slice(-3000);
  });
  const ready = await new Promise((ok, no) => {
    const timeout = setTimeout(() => {
      child.kill();
      no(Error("Benchmark worker startup timed out"));
    }, 30000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener("message", receive);
      child.removeListener("exit", exit);
      child.removeListener("error", error);
    };
    const receive = (m) => {
        if (m.benchmarkReady) {
          cleanup();
          ok(m);
        }
      },
      exit = () => {
        cleanup();
        no(Error("Benchmark worker failed startup: " + stderr));
      },
      error = () => {
        cleanup();
        no(Error("Benchmark worker unavailable"));
      };
    child.on("message", receive);
    child.once("exit", exit);
    child.once("error", error);
  });
  return { child, startupMs: performance.now() - started, ready, jobs: 0 };
}
async function recognize(c) {
  if (!slot || slot.jobs >= 25) {
    if (slot) slot.child.disconnect();
    slot = await start();
  }
  const active = slot,
    cold = active.jobs === 0;
  const result = await new Promise((ok, no) => {
    const timeout = setTimeout(() => {
      active.child.kill();
      cleanup();
      no(Error("Recognition timed out"));
    }, 60000);
    const cleanup = () => {
      clearTimeout(timeout);
      active.child.removeListener("message", receive);
      active.child.removeListener("exit", exit);
      active.child.removeListener("error", error);
    };
    const receive = (m) => {
        if (m.benchmark?.id === c.id) {
          cleanup();
          ok(m);
        }
      },
      exit = () => {
        cleanup();
        no(Error("Recognition worker exited"));
      },
      error = () => {
        cleanup();
        no(Error("Recognition worker unavailable"));
      };
    active.child.on("message", receive);
    active.child.once("exit", exit);
    active.child.once("error", error);
    active.child.send({
      path: resolve(c.imagePath || "datasets/v4/documents/" + c.id + ".png"),
      benchmarkId: c.id,
    });
  });
  active.jobs++;
  return {
    ...result,
    cold,
    startup: cold
      ? {
          elapsedMs: active.startupMs,
          resources: active.ready.resources,
          memory: active.ready.memory,
        }
      : null,
  };
}
const rows = [];
try {
  for (const c of selected) {
    const started = performance.now();
    let row;
    try {
      const r = await recognize(c);
      row = {
        id: c.id,
        split: c.split,
        originalPartition: c.originalPartition || null,
        layout: c.layout,
        scenario: c.scenario,
        sha256: c.sha256,
        status: r.error ? "failed" : "completed",
        expected: c.groundTruth.extracted,
        expectedReview: c.expectedReview,
        cold: r.cold,
        startup: r.startup,
        resources: r.benchmark,
        durationMs: performance.now() - started,
        ...(r.result
          ? {
              raw: r.result,
              fields: extract(r.result.text, {
                blocks: r.result.blocks,
                fieldAttempts: r.result.fieldAttempts,
                documentVersionId: c.id,
              }),
            }
          : {}),
      };
    } catch (error) {
      row = {
        id: c.id,
        split: c.split,
        layout: c.layout,
        scenario: c.scenario,
        status: "failed",
        error: error.message,
        durationMs: performance.now() - started,
        expected: c.groundTruth.extracted,
        expectedReview: c.expectedReview,
      };
      if (slot) slot.child.kill();
      slot = null;
    }
    rows.push(row);
    appendFileSync(journal, JSON.stringify(row) + "\n");
    console.log(
      c.id +
        " " +
        c.split +
        " " +
        row.status +
        " " +
        Math.round(row.durationMs) +
        "ms",
    );
  }
} finally {
  if (slot?.child.connected) slot.child.disconnect();
}
function metrics(rows) {
  return Object.fromEntries(
    manifest.fields.map((field) => {
      const present = rows.filter((r) => r.expected[field] !== undefined),
        absent = rows.filter((r) => r.expected[field] === undefined);
      const value = (r) => r.fields?.[field]?.value,
        review = (r) =>
          r.fields?.[field]?.status === "REQUIRES_REVIEW" ||
          (r.fields?.[field]?.engineConfidence !== null &&
            r.fields?.[field]?.engineConfidence !== undefined &&
            r.fields[field].engineConfidence < 70);
      return [
        field,
        {
          expectedPresent: present.length,
          exact: present.filter((r) => value(r) === r.expected[field]).length,
          exactMatchRate: present.length
            ? present.filter((r) => value(r) === r.expected[field]).length /
              present.length
            : null,
          coverage: present.length
            ? present.filter((r) => value(r) !== undefined).length /
              present.length
            : null,
          incorrectUnflaggedCandidates:
            present.filter(
              (r) =>
                value(r) !== undefined &&
                value(r) !== r.expected[field] &&
                !review(r),
            ).length +
            absent.filter((r) => value(r) !== undefined && !review(r)).length,
          flaggedReviewCandidates: rows.filter((r) => review(r)).length,
          withheldRecognitionConflicts: rows.filter(
            (r) =>
              review(r) &&
              value(r) === undefined &&
              new Set(
                (r.fields?.[field]?.observations || []).map((o) => o.value),
              ).size > 1,
          ).length,
          correctlyWithheldUncertain: rows.filter(
            (r) =>
              r.expectedReview.includes(field) &&
              value(r) === undefined &&
              review(r),
          ).length,
          intentionallyAbsent: absent.length,
          correctlyAbsent: absent.filter((r) => value(r) === undefined).length,
          falseExtractions: absent.filter((r) => value(r) !== undefined).length,
        },
      ];
    }),
  );
}
const completed = rows.filter((r) => r.status === "completed");
const result = {
  metadata,
  samples: rows.length,
  processingFailures: rows.length - completed.length,
  metrics: metrics(rows),
  byLayout: Object.fromEntries(
    [...new Set(rows.map((r) => r.layout))].map((layout) => [
      layout,
      metrics(rows.filter((r) => r.layout === layout)),
    ]),
  ),
  resources: {
    coldDocumentMs: completed.filter((r) => r.cold).map((r) => r.durationMs),
    warmDocumentMs: completed.filter((r) => !r.cold).map((r) => r.durationMs),
    peakRSSKiB:
      Math.max(0, ...completed.map((r) => r.resources.peakRSSKiB || 0)) || null,
  },
  rows,
};
writeFileSync(
  output,
  JSON.stringify({ ...result, rows: undefined, rowJournal: journal }, null, 2) +
    "\n",
);
console.log(
  JSON.stringify({
    output,
    samples: result.samples,
    failures: result.processingFailures,
    metrics: result.metrics,
  }),
);
