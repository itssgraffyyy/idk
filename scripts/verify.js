import { spawnSync } from "node:child_process";
import { writeFileSync, readdirSync } from "node:fs";
const files = readdirSync("tests")
    .filter((p) => p.endsWith(".test.js"))
    .map((p) => "tests/" + p),
  r = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", ...files],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
const output = r.stdout + (r.stderr || "");
writeFileSync(
  process.env.TEST_REPORT_PATH || "docs/evaluation/phase-1-2-tests.txt",
  output,
);
process.stdout.write(output);
if (r.status !== 0) process.exit(r.status || 1);
const build = spawnSync(process.execPath, ["scripts/build-check.js"], {
  stdio: "inherit",
  windowsHide: true,
});
if (build.status) process.exit(build.status);
process.exitCode =
  spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.contracts.json"],
    { stdio: "inherit", windowsHide: true },
  ).status || 0;
