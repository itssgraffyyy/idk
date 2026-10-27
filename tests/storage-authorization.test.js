import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support/harness.js";
import { LocalPrivateStorage } from "../src/storage.js";
test("case document, viewer metadata and draft download recheck the HTTP session after storage reads", async () => {
  const h = await harness();
  const original = LocalPrivateStorage.prototype.read;
  try {
    let a = await h.login("a");
    const id = await h.create(a),
      upload = {
        mime: "text/plain",
        base64: Buffer.from(
          "PRIVATE_SYNTHETIC_SOURCE_MUST_NOT_ESCAPE",
        ).toString("base64"),
      };
    const source = (await h.call("/cases/" + id + "/documents", upload, a))
      .body;
    const draft = (
      await h.call(
        "/drafts",
        { payload: { name: "Private source boundary" }, step: 1 },
        a,
      )
    ).body;
    const draftSource = (
      await h.call(
        "/drafts/" + draft.id + "/documents",
        { ...upload, revision: 1 },
        a,
      )
    ).body;
    for (const [path, version] of [
      ["/cases/" + id + "/documents/" + source.id, source.id],
      ["/cases/" + id + "/viewer/" + source.id, source.id],
      ["/drafts/" + draft.id + "/documents/" + draftSource.id, draftSource.id],
    ]) {
      a = await h.login("a");
      let invoked = false;
      LocalPrivateStorage.prototype.read = function (key) {
        const bytes = original.call(this, key);
        if (key === version && !invoked) {
          invoked = true;
          h.app.db.prepare("DELETE FROM sessions WHERE user_id='a'").run();
        }
        return bytes;
      };
      const response = await fetch(h.base + "/api" + path, { headers: a });
      assert.equal(response.status, 403, path);
      assert.ok(
        !(await response.text()).includes(
          "PRIVATE_SYNTHETIC_SOURCE_MUST_NOT_ESCAPE",
        ),
      );
      assert.equal(invoked, true);
      LocalPrivateStorage.prototype.read = original;
    }
  } finally {
    LocalPrivateStorage.prototype.read = original;
    await h.close();
  }
});
