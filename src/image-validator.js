import { readFileSync } from "node:fs";
import { validateImage } from "./images.js";
try {
  validateImage(readFileSync(process.argv[2]), process.argv[3]);
  process.stdout.write("valid");
} catch {
  process.exitCode = 1;
}
