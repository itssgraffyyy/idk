import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalPrivateStorage } from "../src/storage.js";
import { validateEnvelope } from "../src/contracts.js";
import { OCRPool } from "../src/ocr-pool.js";
test("private storage preserves committed bytes, rejects overwrite and quarantines interrupted writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-storage-"));
  try {
    const s = new LocalPrivateStorage(dir),
      id = randomUUID(),
      orphan = randomUUID();
    s.write(id, Buffer.from("original"));
    assert.throws(() => s.write(id, Buffer.from("replacement")));
    assert.equal(s.read(id).toString(), "original");
    assert.throws(() => s.path("../escape"));
    s.write(orphan, Buffer.from("uncommitted"));
    assert.equal(s.recover([id]), 1);
    assert.equal(readdirSync(s.recovery).length, 1);
    assert(existsSync(s.path(id)));
    assert.throws(
      () => s.read(orphan),
      (e) => e.status === 503,
    );
    assert.equal(new LocalPrivateStorage(dir).read(id).toString(), "original");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("request contracts reject malformed scalar bodies and untrusted policy activation", () => {
  for (const v of [null, [], { reason: 1 }, { revision: 1.5 }])
    assert.throws(
      () => validateEnvelope(v),
      (e) => e.status === 400,
    );
  for (const v of [{ policies: [] }, { issuerConfirmed: true }])
    assert.throws(
      () => validateEnvelope(v),
      (e) => e.status === 403,
    );
  assert.deepEqual(validateEnvelope({ reason: "Correction", revision: 1 }), {
    reason: "Correction",
    revision: 1,
  });
});
test("warm OCR process retains model and produces identical repeated recognition", async () => {
  const pool = new OCRPool({ max: 1 });
  try {
    const path = join(process.cwd(), "datasets/v3/documents/ocr-v3-01.png"),
      start = performance.now();
    const first = await pool.run(path),
      cold = performance.now() - start;
    const pid = pool.slots[0].child.pid;
    const warmStart = performance.now(),
      second = await pool.run(path);
    assert.equal(pool.slots[0].child.pid, pid);
    assert.equal(first.text, second.text);
    assert.deepEqual(first.fieldAttempts, second.fieldAttempts);
    console.log(
      JSON.stringify({
        ocrPool: {
          coldMs: cold,
          warmMs: performance.now() - warmStart,
          pid,
          modelReused: true,
        },
      }),
    );
  } finally {
    pool.close();
  }
});
