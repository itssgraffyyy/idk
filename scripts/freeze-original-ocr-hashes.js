import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const path = "datasets/v4/original-corpus-hashes.json";
if (existsSync(path)) throw Error("Original corpus hashes already frozen");
const files = ["v1", "v2", "v3"].flatMap((version) =>
  readdirSync("datasets/" + version + "/documents")
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => {
      const path = "datasets/" + version + "/documents/" + f;
      return {
        path,
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      };
    }),
);
if (files.length !== 48) throw Error("Expected original 48 OCR images");
writeFileSync(
  path,
  JSON.stringify(
    {
      purpose: "Original V1/V2/V3 regression corpus, unchanged before V4 work",
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log("Frozen original image hashes: " + files.length);
