import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { OCRPool } from "../src/ocr-pool.js";
test("bounded OCR workers recover after timeout, malformed results and worker death", async () => {
  const pool = new OCRPool({
    max: 1,
    timeout: 5000,
    workerPath: fileURLToPath(
      new URL("./support/ocr-fault-worker.js", import.meta.url),
    ),
  });
  try {
    assert.equal((await pool.run("normal")).text, "recovered");
    pool.timeout = 100;
    const blocked = pool.run("hang");
    await assert.rejects(pool.run("overflow"), /full/);
    await assert.rejects(blocked, /timed out/);
    pool.timeout = 5000;
    await assert.rejects(pool.run("bad"), /recognition failed/);
    await assert.rejects(pool.run("exit"), /exited/);
    assert.equal((await pool.run("normal")).text, "recovered");
  } finally {
    pool.close();
  }
});
