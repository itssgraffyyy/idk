import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ClamAVScanner,
  scanUpload,
  documentScan,
} from "../src/upload-scanning.js";
import { harness, instrument } from "./support/harness.js";
import { clearanceService } from "../src/clearance-service.js";
import {
  syntheticPolicy,
  syntheticProcedure,
} from "./support/clearance-fixtures.js";
const bytes = Buffer.from(
  "Synthetic upload scanner contract fixture; not a malware sample",
);
test("scan policy blocks internal readiness for previously unscanned current sources and new clean version removes only that blocker", async () => {
  let clean = false;
  const scanner = {
    scan: async () => ({
      verdict: clean ? "SCANNER_ASSERTED_CLEAN" : "UNSCANNED",
      provider: "SYNTHETIC_CONTRACT_SCANNER",
      mode: "CONTRACT_TEST",
    }),
  };
  const h = await harness({ uploadScanner: scanner });
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      upload = { mime: "text/plain", base64: bytes.toString("base64") };
    assert.equal(
      (await h.call("/cases/" + id + "/documents", upload, a)).status,
      201,
    );
    const service = clearanceService({
      db: h.app.db,
      audit: () => {},
      procedures: [syntheticProcedure],
      policyConfig: { policies: [syntheticPolicy], scope: "synthetic-test" },
      uploadScanRequired: true,
    });
    const s = { id: "s", role: "supervisor", tenant: "authority" },
      o = { id: "o", role: "officer", tenant: "authority" };
    service.activate(s, {
      scope: syntheticProcedure.scope,
      version: syntheticProcedure.version,
      revision: 0,
      reason: "Synthetic required scan policy test",
    });
    service.bind(o, id, {
      scope: syntheticProcedure.scope,
      revision: 0,
      reason: "Synthetic scan policy binding",
    });
    const before = service.readiness(o, id);
    assert.ok(
      before.blockers.some((b) => b.code === "UPLOAD_MALWARE_SCAN_UNCONFIRMED"),
    );
    clean = true;
    assert.equal(
      (await h.call("/cases/" + id + "/documents", upload, a)).status,
      201,
    );
    const after = service.readiness(o, id);
    assert.ok(
      !after.blockers.some((b) => b.code === "UPLOAD_MALWARE_SCAN_UNCONFIRMED"),
    );
    assert.equal(after.administrativeApproval, false);
    assert.notEqual(after.snapshotHash, before.snapshotHash);
  } finally {
    await h.close();
  }
});
async function mockScanner(reply) {
  const sockets = new Set(),
    received = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0),
      command = false,
      parts = [];
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!command) {
        const nul = buffer.indexOf(0);
        if (nul < 0) return;
        assert.equal(buffer.subarray(0, nul).toString(), "zINSTREAM");
        buffer = buffer.subarray(nul + 1);
        command = true;
      }
      while (buffer.length >= 4) {
        const size = buffer.readUInt32BE();
        if (buffer.length < 4 + size) return;
        const part = buffer.subarray(4, 4 + size);
        buffer = buffer.subarray(4 + size);
        if (!size) {
          const content = Buffer.concat(parts);
          received.push(content);
          reply(socket, content);
          return;
        }
        parts.push(part);
      }
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    received,
    scanner: new ClamAVScanner({
      host: "127.0.0.1",
      port: server.address().port,
      mode: "CONTRACT_TEST",
      timeout: 300,
    }),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((ok) => server.close(ok));
    },
  };
}
test("real INSTREAM client sends exact bounded bytes and distinguishes clean, infected, malformed, truncated and recovery responses", async () => {
  let mode = "clean";
  const mock = await mockScanner((socket) =>
    socket.end(
      mode === "clean"
        ? "stream: OK\0"
        : mode === "infected"
          ? "stream: Synthetic.Marker FOUND\0"
          : mode === "truncated"
            ? "stream: OK"
            : mode === "embedded"
              ? "stream:\0 OK\0"
              : "not a scanner verdict\0",
    ),
  );
  try {
    const clean = await scanUpload(bytes, {
      scanner: mock.scanner,
      required: true,
    });
    assert.equal(clean.verdict, "SCANNER_ASSERTED_CLEAN");
    assert.equal(clean.mode, "CONTRACT_TEST");
    assert.deepEqual(mock.received[0], bytes);
    mode = "infected";
    await assert.rejects(scanUpload(bytes, { scanner: mock.scanner }), {
      status: 422,
    });
    for (mode of ["truncated", "embedded", "malformed"]) {
      const result = await scanUpload(bytes, { scanner: mock.scanner });
      assert.equal(result.verdict, "UNAVAILABLE");
      await assert.rejects(
        scanUpload(bytes, { scanner: mock.scanner, required: true }),
        { status: 503 },
      );
    }
    mode = "clean";
    assert.equal(
      (await scanUpload(bytes, { scanner: mock.scanner })).verdict,
      "SCANNER_ASSERTED_CLEAN",
    );
    await assert.rejects(mock.scanner.scan(Buffer.alloc(4194305)), {
      status: 413,
    });
    assert.equal(mock.scanner.active, 0);
  } finally {
    await mock.close();
  }
});
test("scanner has an absolute deadline even when a peer drips data, and absent configuration never claims a scan", async () => {
  const mock = await mockScanner((socket) => {
    const timer = setInterval(() => socket.write("x"), 20);
    socket.once("close", () => clearInterval(timer));
  });
  try {
    const started = performance.now(),
      result = await scanUpload(bytes, { scanner: mock.scanner });
    assert.equal(result.verdict, "UNAVAILABLE");
    assert.equal(result.reason, "TIMEOUT");
    assert.ok(performance.now() - started < 2000);
  } finally {
    await mock.close();
  }
  const absent = await scanUpload(bytes);
  assert.equal(absent.verdict, "UNSCANNED");
  assert.equal(absent.provider, "NONE");
  await assert.rejects(scanUpload(bytes, { required: true }), { status: 503 });
});
test("case and draft upload pipelines persist version-bound scan provenance and reject infected objects without publishing them", async () => {
  const mock = await mockScanner((socket, content) =>
    socket.end(
      content.includes("REJECT_THIS_SYNTHETIC_MARKER")
        ? "stream: Synthetic.Marker FOUND\0"
        : "stream: OK\0",
    ),
  );
  const h = await harness({
    uploadScanner: mock.scanner,
    uploadScanRequired: true,
  });
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      id = await h.create(a),
      path = "/cases/" + id;
    const upload = { mime: "text/plain", base64: bytes.toString("base64") };
    assert.equal((await h.call(path + "/documents", upload, b)).status, 404);
    assert.equal(mock.received.length, 0);
    const accepted = await h.call(path + "/documents", upload, a);
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.scan.verdict, "SCANNER_ASSERTED_CLEAN");
    const viewer = await h.call(
      path + "/viewer/" + accepted.body.id,
      undefined,
      a,
    );
    assert.equal(viewer.body.malwareScan.contentSHA256, accepted.body.sha256);
    const rejected = {
      mime: "text/plain",
      base64: Buffer.from("REJECT_THIS_SYNTHETIC_MARKER").toString("base64"),
    };
    const count = h.app.db
      .prepare("SELECT count(*) n FROM document_versions")
      .get().n;
    assert.equal((await h.call(path + "/documents", rejected, a)).status, 422);
    assert.equal(
      h.app.db.prepare("SELECT count(*) n FROM document_versions").get().n,
      count,
    );
    const draft = (
      await h.call(
        "/drafts",
        {
          payload: {
            name: "Scanner draft",
            instrument,
            obligation: { amountPaise: 12500000 },
          },
          step: 2,
        },
        a,
      )
    ).body;
    assert.equal(
      (
        await h.call(
          "/drafts/" + draft.id + "/documents",
          { ...rejected, revision: 1 },
          a,
        )
      ).status,
      422,
    );
    assert.equal(
      h.app.db.prepare("SELECT count(*) n FROM draft_documents").get().n,
      0,
    );
    const source = await h.call(
      "/drafts/" + draft.id + "/documents",
      { ...upload, revision: 1 },
      a,
    );
    assert.equal(source.status, 201);
    assert.equal(
      documentScan(h.app.db, source.body.id, source.body.sha256).verdict,
      "SCANNER_ASSERTED_CLEAN",
    );
    assert.equal(readdirSync(join(h.dir, "private")).length, 2);
    assert.throws(
      () =>
        h.app.db.prepare("UPDATE upload_scans SET verdict='UNSCANNED'").run(),
      /immutable/,
    );
  } finally {
    await h.close();
    await mock.close();
  }
});
test("required but unavailable scanning leaves case and draft data intact; legacy scan status stays unknown", async () => {
  const h = await harness({ uploadScanRequired: true });
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      upload = { mime: "text/plain", base64: bytes.toString("base64") };
    assert.equal(
      (await h.call("/cases/" + id + "/documents", upload, a)).status,
      503,
    );
    const draft = (
      await h.call(
        "/drafts",
        {
          payload: {
            name: "Required scanning",
            instrument,
            obligation: { amountPaise: 12500000 },
          },
          step: 2,
        },
        a,
      )
    ).body;
    assert.equal(
      (
        await h.call(
          "/drafts/" + draft.id + "/documents",
          { ...upload, revision: 1 },
          a,
        )
      ).status,
      503,
    );
    assert.equal(
      h.app.db.prepare("SELECT count(*) n FROM document_versions").get().n,
      0,
    );
    assert.equal(
      h.app.db.prepare("SELECT count(*) n FROM draft_documents").get().n,
      0,
    );
    assert.equal(readdirSync(join(h.dir, "private")).length, 0);
    assert.equal(
      documentScan(h.app.db, "missing", "unknown").verdict,
      "NOT_RECORDED",
    );
  } finally {
    await h.close();
  }
});
test("authorization is rechecked after asynchronous scanning before any private file is written", async () => {
  let release, started;
  const ready = new Promise((ok) => (started = ok)),
    gate = new Promise((ok) => (release = ok));
  const h = await harness({
    uploadScanner: {
      scan: async () => {
        started();
        await gate;
        return {
          verdict: "SCANNER_ASSERTED_CLEAN",
          provider: "DEFERRED_CONTRACT_TEST",
          mode: "CONTRACT_TEST",
        };
      },
    },
  });
  try {
    const a = await h.login("a"),
      id = await h.create(a),
      pending = h.call(
        "/cases/" + id + "/documents",
        { mime: "text/plain", base64: bytes.toString("base64") },
        a,
      );
    await ready;
    h.app.db.prepare("UPDATE users SET status='disabled' WHERE id='a'").run();
    release();
    assert.equal((await pending).status, 403);
    assert.equal(
      h.app.db.prepare("SELECT count(*) n FROM document_versions").get().n,
      0,
    );
    assert.equal(readdirSync(join(h.dir, "private")).length, 0);
  } finally {
    release();
    await h.close();
  }
});
