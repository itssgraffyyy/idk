import { spawnSync } from "node:child_process";
import { writeFileSync, readdirSync } from "node:fs";
const files = readdirSync("tests")
    .filter((p) => p.endsWith(".test.js"))
    .map((p) => "tests/" + p),
  r = spawnSync(process.execPath, ["--test", ...files], {
    encoding: "utf8",
    windowsHide: true,
  });
const output = r.stdout + (r.stderr || "");
writeFileSync("docs/evaluation/phase-1-2-tests.txt", output);
process.stdout.write(output);
if (r.status !== 0) process.exit(r.status || 1);
const build = spawnSync(process.execPath, ["scripts/build-check.js"], {
  stdio: "inherit",
  windowsHide: true,
});
process.exitCode = build.status || 0;
