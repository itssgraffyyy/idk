import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "tests/app.test.js",
    "tests/policy.test.js",
    "tests/normalization.test.js",
    "tests/resilience.test.js",
  ],
  { encoding: "utf8", windowsHide: true },
);
writeFileSync(
  "docs/evaluation/test-output.txt",
  result.stdout + (result.stderr || ""),
);
process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status || 1);
for (const f of ["src/server.js", "public/app.js"]) {
  const r = spawnSync(process.execPath, ["--check", f], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
console.log("Backend tests and application syntax checks passed");
