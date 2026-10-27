import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("new synthetic OCR partitions are hash-frozen with disjoint layouts before recognition tuning", () => {
  const bytes = readFileSync("datasets/v4/manifest.json"),
    manifest = JSON.parse(bytes);
  assert.equal(
    hash(bytes),
    readFileSync("datasets/v4/manifest.sha256", "utf8").trim(),
  );
  assert.equal(manifest.classification, "SYNTHETIC_TEST_ONLY");
  assert.equal(manifest.frozenBeforeRecognitionChanges, true);
  assert.equal(manifest.cases.length, 42);
  const original = JSON.parse(
    readFileSync("datasets/v4/original-corpus-hashes.json"),
  );
  assert.equal(original.files.length, 48);
  for (const file of original.files)
    assert.equal(hash(readFileSync(file.path)), file.sha256);
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(manifest.partitions).map((split) => [
        split,
        manifest.cases.filter((c) => c.split === split).length,
      ]),
    ),
    manifest.partitions,
  );
  const layoutSplits = new Map(),
    identities = new Set();
  for (const c of manifest.cases) {
    assert(!identities.has(c.id));
    identities.add(c.id);
    assert(
      !layoutSplits.has(c.layout) || layoutSplits.get(c.layout) === c.split,
    );
    layoutSplits.set(c.layout, c.split);
    const image = readFileSync("datasets/v4/documents/" + c.id + ".png");
    assert.equal(hash(image), c.sha256);
    assert.equal(image.readUInt32BE(16), c.dimensions.width);
    assert.equal(image.readUInt32BE(20), c.dimensions.height);
    assert.equal(c.referenceSource.version, "razorpay-ifsc-v2.0.62");
    assert.equal(c.referenceSource.datasetSHA256.length, 64);
    assert(c.groundTruth.extracted.type);
    assert(c.groundTruth.originalUnrotatedLineBoxes.reference);
  }
});
