import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildPDF } from "./pdf-fixtures.js";
const dir = mkdtempSync(join(tmpdir(), "sentinel-preview-fonts-")),
  file = join(dir, "synthetic.pdf"),
  bytes = buildPDF();
const digest = (b) => createHash("sha256").update(b).digest("hex"),
  trials = [];
writeFileSync(file, bytes);
try {
  for (let repetition = 1; repetition <= 3; repetition++)
    for (const mode of ["host_font_discovery_control", "portable_preview"]) {
      const env = { ...process.env };
      delete env.DISABLE_SYSTEM_FONTS_LOAD;
      const started = performance.now(),
        result = spawnSync(
          process.execPath,
          [
            "--max-old-space-size=256",
            "--import",
            pathToFileURL(resolve("scripts/preview-resource-hook.js")).href,
            resolve(
              "src",
              mode === "portable_preview"
                ? "pdf-preview-worker.js"
                : "pdf-worker.js",
            ),
            file,
            "preview:1",
          ],
          {
            env,
            encoding: "utf8",
            windowsHide: true,
            timeout: 15000,
            maxBuffer: 16777216,
          },
        );
      const record = {
        repetition,
        mode,
        elapsedMs: performance.now() - started,
        exitCode: result.status,
        timedOut: result.error?.code === "ETIMEDOUT",
        pngSHA256: null,
        resources: null,
      };
      const resource = result.stderr?.match(
        /PREVIEW_RESOURCE_USAGE:([^\r\n]+)/,
      );
      if (resource) {
        const r = JSON.parse(resource[1]);
        record.resources = {
          userCPUTimeMicroseconds: r.userCPUTime,
          systemCPUTimeMicroseconds: r.systemCPUTime,
          peakRSSKiB: r.maxRSS > 0 ? r.maxRSS : null,
        };
      }
      if (result.status === 0) {
        const rendered = JSON.parse(result.stdout);
        record.pngSHA256 = digest(Buffer.from(rendered.png, "base64"));
        record.fontMode = rendered.rendering.fontMode;
      }
      trials.push(record);
    }
  const rendered = trials.filter((t) => t.pngSHA256),
    portable = trials.filter((t) => t.mode === "portable_preview");
  const report = {
    fixtureSHA256: digest(bytes),
    node: process.version,
    timeoutMs: 15000,
    memoryBudgetMiB: 256,
    method:
      "Alternating independent child processes; OS filesystem cache is uncontrolled. Both modes render the same embedded/bundled PDF font configuration; only host-font discovery differs. Small diagnostic sample, not a throughput or production SLA benchmark.",
    trials,
    successfulPNGsIdentical:
      rendered.length > 0 &&
      new Set(rendered.map((t) => t.pngSHA256)).size === 1,
  };
  writeFileSync(
    "docs/evaluation/pdf-preview-font-startup.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      trials: trials.map((t) => ({
        mode: t.mode,
        elapsedMs: t.elapsedMs,
        timedOut: t.timedOut,
      })),
      successfulPNGsIdentical: report.successfulPNGsIdentical,
    }),
  );
  if (portable.some((t) => !t.pngSHA256) || !report.successfulPNGsIdentical)
    process.exitCode = 1;
} finally {
  const target = resolve(dir),
    root = resolve(tmpdir()) + sep;
  if (
    !target.startsWith(root) ||
    !basename(target).startsWith("sentinel-preview-fonts-")
  ) {
    console.error("Unexpected benchmark cleanup path; directory retained");
    process.exitCode = 1;
  } else rmSync(target, { recursive: true, force: true });
}
