import { readBoundedJSON } from "./http-client.js";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const root = new URL("../resources/ifsc/", import.meta.url),
  manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
let records;
const sha = (b) => createHash("sha256").update(b).digest("hex");
function load() {
  if (records) return records;
  const bytes = readFileSync(new URL("branches-v2.0.62.json.gz", root));
  if (sha(bytes) !== manifest.sha256)
    throw Error("IFSC dataset integrity failure");
  records = JSON.parse(gunzipSync(bytes, { maxOutputLength: 100000000 }));
  return records;
}
export function lookupIFSC(value) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  const base = {
    code,
    source: manifest.upstream,
    version: manifest.version,
    releaseDate: manifest.releaseDate,
    datasetSHA256: manifest.sha256,
    realBankValidation: false,
    independentDepositConfirmation: false,
  };
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code))
    return { ...base, status: "invalid" };
  try {
    const r = load()[code];
    return r
      ? {
          ...base,
          status: "reference_match",
          bank: r.BANK,
          branch: r.BRANCH,
          record: r,
          mode: "offline_dataset",
        }
      : { ...base, status: "not_found", bank: null, mode: "offline_dataset" };
  } catch {
    return {
      ...base,
      status: "unavailable",
      bank: null,
      reason: "Reference dataset integrity or availability failure",
    };
  }
}
export class IFSCProvider {
  constructor({ fetcher = fetch, timeoutMs = 3000 } = {}) {
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
  }
  async lookup(code) {
    const offline = lookupIFSC(code);
    if (offline.status === "invalid") return offline;
    try {
      const r = await this.fetcher(
        "https://ifsc.razorpay.com/" + offline.code,
        { signal: AbortSignal.timeout(this.timeoutMs), redirect: "error" },
      );
      if (!r.ok) throw Error("HTTP " + r.status);
      const record = await readBoundedJSON(r, 20000),
        text = JSON.stringify(record);
      if (text.length > 20000) throw Error("Oversized response");

      if (
        record.IFSC !== offline.code ||
        typeof record.BANK !== "string" ||
        !record.BANK ||
        typeof record.BRANCH !== "string"
      )
        throw Error("Invalid reference response");
      return {
        ...offline,
        status: "reference_match",
        mode: "public_service",
        source: "https://ifsc.razorpay.com/" + offline.code,
        version: "live-response-sha256:" + sha(text),
        retrievedAt: new Date().toISOString(),
        bank: record.BANK,
        branch: record.BRANCH,
        record,
      };
    } catch (e) {
      return {
        ...offline,
        mode: "offline_fallback",
        fallbackReason:
          e.name === "TimeoutError"
            ? "timeout"
            : "service_unavailable_or_invalid",
        retrievedAt: new Date().toISOString(),
      };
    }
  }
}
export { manifest as ifscManifest };
