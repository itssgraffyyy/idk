import {
  readFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const files = [
  "public/index.html",
  "public/style.css",
  ...readdirSync("public")
    .filter((f) => f.endsWith(".js"))
    .map((f) => "public/" + f),
  ...readdirSync("src")
    .filter((f) => f.endsWith(".js"))
    .map((f) => "src/" + f),
];
for (const file of files.filter((f) => f.endsWith(".js"))) {
  const r = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
const html = readFileSync("public/index.html", "utf8");
for (const match of html.matchAll(/(?:src|href)="\/(.*?)"/g)) {
  if (match[1]) readFileSync("public/" + match[1]);
}
mkdirSync("build/public", { recursive: true });
for (const file of files.filter((f) => f.startsWith("public/")))
  copyFileSync(file, "build/" + file);
writeFileSync(
  "build/manifest.json",
  JSON.stringify(
    {
      architecture:
        "buildless Node/browser application; no Next.js build claimed",
      files: files.map((path) => ({
        path,
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      })),
    },
    null,
    2,
  ),
);
console.log(
  "Validated " +
    files.length +
    " files and packaged public assets in build/public",
);
