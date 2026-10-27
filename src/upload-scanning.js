import { createConnection } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const scanMigration = {
  version: 21,
  sql: `CREATE TABLE upload_scans(document_version_id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,verdict TEXT NOT NULL CHECK(verdict IN ('SCANNER_ASSERTED_CLEAN','UNSCANNED','UNAVAILABLE')),payload TEXT NOT NULL CHECK(json_valid(payload)),created TEXT NOT NULL);
CREATE TRIGGER upload_scan_binding BEFORE INSERT ON upload_scans WHEN json_extract(NEW.payload,'$.contentSHA256') IS NOT NEW.sha256 OR NOT (EXISTS(SELECT 1 FROM document_versions WHERE id=NEW.document_version_id AND sha256=NEW.sha256) OR EXISTS(SELECT 1 FROM draft_documents WHERE id=NEW.document_version_id AND sha256=NEW.sha256)) BEGIN SELECT RAISE(ABORT,'invalid upload scan source binding');END;
CREATE TRIGGER upload_scan_immutable BEFORE UPDATE ON upload_scans BEGIN SELECT RAISE(ABORT,'immutable upload scan');END;
CREATE TRIGGER upload_scan_no_delete BEFORE DELETE ON upload_scans BEGIN SELECT RAISE(ABORT,'immutable upload scan');END;`,
};
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
export class ClamAVScanner {
  constructor({
    host,
    port = 3310,
    timeout = 5000,
    mode = "CONFIGURED_SERVICE",
  } = {}) {
    if (
      host !== undefined &&
      (typeof host !== "string" ||
        !host.length ||
        host.length > 253 ||
        !/^[a-zA-Z0-9.:-]+$/.test(host))
    )
      throw Error("Invalid scanner host");
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !Number.isInteger(timeout) ||
      timeout < 50 ||
      timeout > 10000 ||
      !["CONFIGURED_SERVICE", "CONTRACT_TEST"].includes(mode)
    )
      throw Error("Invalid scanner configuration");
    Object.assign(this, { host, port, timeout, mode, active: 0 });
  }
  async scan(bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 4194304)
      fail(413, "Scanner input must be1 byte to4MiB");
    if (!this.host)
      return {
        verdict: "UNSCANNED",
        provider: "NONE",
        mode: "NOT_CONFIGURED",
        reason: "NO_SCANNER_CONFIGURED",
      };
    if (this.active >= 2) fail(429, "Upload scanning capacity reached");
    this.active++;
    let socket, timer;
    try {
      socket = createConnection({ host: this.host, port: this.port });
      timer = setTimeout(
        () =>
          socket.destroy(
            Object.assign(Error("Scanner timeout"), { code: "SCAN_TIMEOUT" }),
          ),
        this.timeout,
      );
      socket.setTimeout(this.timeout, () =>
        socket.destroy(
          Object.assign(Error("Scanner timeout"), { code: "SCAN_TIMEOUT" }),
        ),
      );
      const response = new Promise((ok, no) => {
        let received = "";
        socket.on("data", (chunk) => {
          received += chunk.toString("utf8");
          if (received.length > 4096) {
            socket.destroy(Error("Malformed scanner response"));
            return;
          }
          if (received.includes("\0"))
            ok(
              received.indexOf("\0") === received.length - 1
                ? received.slice(0, -1)
                : "MALFORMED_SCANNER_RESPONSE",
            );
        });
        socket.once("error", no);
        socket.once("end", () => no(Error("Incomplete scanner response")));
      });
      // Install rejection handling before waiting on connect/backpressure.
      response.catch(() => {});
      await once(socket, "connect");
      // The entire accepted upload is bounded to4MiB; queued slices share that buffer.
      socket.write(Buffer.from("zINSTREAM\0"));
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        const part = bytes.subarray(offset, offset + 65536),
          length = Buffer.alloc(4);
        length.writeUInt32BE(part.length);
        socket.write(length);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4));
      const result = await response;
      if (result === "stream: OK")
        return {
          verdict: "SCANNER_ASSERTED_CLEAN",
          provider: "CLAMAV_INSTREAM",
          mode: this.mode,
          engineVersion: "NOT_REPORTED",
        };
      if (/^stream: .+ FOUND$/.test(result))
        return {
          verdict: "INFECTED",
          provider: "CLAMAV_INSTREAM",
          mode: this.mode,
        };
      return {
        verdict: "UNAVAILABLE",
        provider: "CLAMAV_INSTREAM",
        mode: this.mode,
        reason: "MALFORMED_SCANNER_RESPONSE",
      };
    } catch (error) {
      return {
        verdict: "UNAVAILABLE",
        provider: "CLAMAV_INSTREAM",
        mode: this.mode,
        reason:
          error.code === "SCAN_TIMEOUT"
            ? "TIMEOUT"
            : "SCANNER_CONNECTION_FAILURE",
      };
    } finally {
      clearTimeout(timer);
      socket?.destroy();
      this.active--;
    }
  }
}
export function configuredScanner() {
  return new ClamAVScanner({
    host: process.env.CLAMAV_HOST || undefined,
    port: Number(process.env.CLAMAV_PORT || 3310),
  });
}
export async function scanUpload(bytes, { scanner, required = false } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 4194304)
    fail(413, "Scanner input must be1 byte to4MiB");
  const scan = await (scanner || new ClamAVScanner()).scan(bytes);
  if (
    !scan ||
    ![
      "SCANNER_ASSERTED_CLEAN",
      "INFECTED",
      "UNSCANNED",
      "UNAVAILABLE",
    ].includes(scan.verdict)
  )
    fail(503, "Scanner returned an unsupported result");
  if (scan.verdict === "INFECTED")
    fail(422, "Upload rejected by configured malware scanner");
  if (required && scan.verdict !== "SCANNER_ASSERTED_CLEAN")
    fail(503, "A clean scanner result is required; upload was not accepted");
  return {
    ...scan,
    contentSHA256: hash(bytes),
    checkedAt: new Date().toISOString(),
    classification: "MALWARE_SCAN_STATUS_NOT_DOCUMENT_OR_BANK_AUTHENTICATION",
  };
}
export function recordScan(db, documentId, sha256, scan) {
  db.prepare("INSERT INTO upload_scans VALUES(?,?,?,?,?)").run(
    documentId,
    sha256,
    scan.verdict,
    JSON.stringify(scan),
    scan.checkedAt,
  );
}
export function documentScan(db, id, sha256) {
  const row = db
    .prepare(
      "SELECT * FROM upload_scans WHERE document_version_id=? AND sha256=?",
    )
    .get(id, sha256);
  return row
    ? JSON.parse(row.payload)
    : {
        verdict: "NOT_RECORDED",
        provider: "UNKNOWN",
        classification: "LEGACY_SCAN_NOT_RECORDED",
      };
}
