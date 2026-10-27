import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { hash } from "./store.js";
import { scanUpload } from "./upload-scanning.js";
import { workerEnvironment } from "./worker-environment.js";
const exec = promisify(execFile);
let active = 0;
export async function intakeDocument(storage, body, scanning = {}) {
  const bad = (status, message) => {
    throw Object.assign(Error(message), { status });
  };
  if (
    typeof body.base64 !== "string" ||
    body.base64.length > 5600000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      body.base64,
    )
  )
    bad(400, "Invalid bounded base64 document");
  const bytes = Buffer.from(body.base64, "base64");
  if (!bytes.length || bytes.length > 4194304)
    bad(413, "Document must be 1 byte to 4 MiB");
  const mime = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "image/jpeg"
      : bytes.subarray(0, 5).toString() === "%PDF-"
        ? "application/pdf"
        : body.mime === "text/plain" &&
            !bytes.includes(0) &&
            !bytes.toString("utf8").includes("\uFFFD")
          ? "text/plain"
          : null;
  if (!mime) bad(400, "Unsupported document content");
  if (active >= 2) bad(429, "Document intake capacity reached");
  const id = randomUUID();
  active++;
  let stored = false;
  try {
    const scan = await scanUpload(bytes, scanning);
    storage.write(id, bytes);
    stored = true;
    if (mime !== "text/plain")
      await exec(
        process.execPath,
        [
          "--max-old-space-size=256",
          fileURLToPath(
            new URL(
              mime === "application/pdf"
                ? "./pdf-worker.js"
                : "./image-validator.js",
              import.meta.url,
            ),
          ),
          storage.path(id),
          mime === "application/pdf" ? "validate" : mime,
        ],
        {
          timeout: 10000,
          maxBuffer: 1000,
          windowsHide: true,
          env: workerEnvironment({ DISABLE_SYSTEM_FONTS_LOAD: "1" }),
        },
      );
    return { id, sha256: hash(bytes), mime, bytes: bytes.length, scan };
  } catch (e) {
    if (stored) storage.remove(id);
    if (e.status) throw e;
    if (e.killed || e.code === "ETIMEDOUT")
      bad(503, "Document validation timed out; saved draft is preserved");
    bad(400, "Document validation failed");
  } finally {
    active--;
  }
}
