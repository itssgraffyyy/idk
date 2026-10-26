import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
  {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let output = "";
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    output += chunk.toString();
    process.stdout.write(chunk);
  });
const code = await new Promise((ok, no) => {
  child.once("error", no);
  child.once("exit", ok);
});
writeFileSync(
  process.env.BROWSER_REPORT_PATH || "docs/evaluation/current-browser.txt",
  output,
);
process.exitCode = code ?? 1;
