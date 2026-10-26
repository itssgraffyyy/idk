import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  path = "resources/ifsc/by-bank-v2.0.62.tar.gz",
  bytes = readFileSync(path),
  source = JSON.parse(readFileSync("resources/source-manifest.json")).find(
    (x) => x.path === path,
  );
if (sha(bytes) !== source.sha256) throw Error("Source archive hash mismatch");
const tar = gunzipSync(bytes, { maxOutputLength: 300000000 }),
  rows = {};
for (let offset = 0; offset + 512 <= tar.length;) {
  const header = tar.subarray(offset, offset + 512),
    name = header.subarray(0, 100).toString().replace(/\0.*$/s, ""),
    size = parseInt(
      header.subarray(124, 136).toString().replace(/\0.*$/s, "").trim() || "0",
      8,
    );
  if (!name) break;
  if (
    !Number.isSafeInteger(size) ||
    size < 0 ||
    offset + 512 + size > tar.length
  )
    throw Error("Invalid archive");
  if (/^by-bank\/[A-Z0-9]+\.json$/.test(name)) {
    const data = JSON.parse(
      tar.subarray(offset + 512, offset + 512 + size).toString(),
    );
    for (const [code, r] of Object.entries(data)) {
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code) || r.IFSC !== code) continue;
      rows[code] = {
        IFSC: code,
        BANK: r.BANK,
        BRANCH: r.BRANCH,
        STATE: r.STATE,
        CITY: r.CITY,
        ADDRESS: r.ADDRESS,
        NEFT: r.NEFT,
        RTGS: r.RTGS,
      };
    }
  }
  offset += 512 + Math.ceil(size / 512) * 512;
}
if (Object.keys(rows).length < 150000)
  throw Error("Incomplete dataset: " + Object.keys(rows).length);
const compressed = gzipSync(Buffer.from(JSON.stringify(rows)), { level: 9 });
writeFileSync("resources/ifsc/branches-v2.0.62.json.gz", compressed);
writeFileSync(
  "resources/ifsc/manifest.json",
  JSON.stringify(
    {
      version: "razorpay-ifsc-v2.0.62",
      releaseDate: "2026-09-01",
      upstream: "https://github.com/razorpay/ifsc/releases/tag/v2.0.62",
      license: "Public domain dataset; upstream code MIT",
      upstreamArchiveSHA256: source.sha256,
      sha256: sha(compressed),
      records: Object.keys(rows).length,
      fields: [
        "IFSC",
        "BANK",
        "BRANCH",
        "STATE",
        "CITY",
        "ADDRESS",
        "NEFT",
        "RTGS",
      ],
      retrievedAt: source.retrievedAt,
    },
    null,
    2,
  ),
);
console.log({
  records: Object.keys(rows).length,
  compressedBytes: compressed.length,
});
