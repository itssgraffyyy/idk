import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { harness } from "./support/harness.js";
import { isolatedAppOptions } from "./support/app-options.js";
import { createApp } from "../src/server.js";
import { totp } from "../src/mfa.js";
test("twenty-five missing-key failures and restored restarts preserve enrollment, return precise failures and release ownership", async () => {
  const h = await harness();
  let app;
  try {
    const r = await h.login("r"),
      enroll = await h.call(
        "/security/mfa/enroll",
        { password: "phase12-password", revision: 0 },
        r,
      );
    assert.equal(enroll.status, 200);
    assert.equal(
      (
        await h.call(
          "/security/mfa/confirm",
          {
            password: "phase12-password",
            revision: enroll.body.revision,
            mfaCode: totp(enroll.body.secret, Date.now()),
          },
          r,
        )
      ).status,
      200,
    );
    const keyPath = join(h.dir, "security", "mfa.key"),
      key = readFileSync(keyPath);
    await h.app.close();
    for (let iteration = 0; iteration < 25; iteration++) {
      assert.equal(
        existsSync(join(h.dir, ".server.lock")),
        false,
        "Ownership persisted before iteration " + iteration,
      );
      unlinkSync(keyPath);
      let observed;
      try {
        app = createApp(isolatedAppOptions(h.dir));
      } catch (error) {
        observed = {
          status: error.status,
          message: error.message,
          stack: error.stack,
        };
      }
      if (app) {
        await app.close();
        app = null;
      }
      assert.equal(
        observed?.status,
        503,
        JSON.stringify({ iteration, observed }),
      );
      assert.match(observed.message, /MFA encryption key unavailable/);
      assert.equal(existsSync(keyPath), false);
      assert.equal(existsSync(join(h.dir, ".server.lock")), false);
      writeFileSync(keyPath, key, { flag: "wx" });
      app = createApp(isolatedAppOptions(h.dir));
      assert.equal(
        app.db.prepare("SELECT enabled FROM user_mfa WHERE user_id='r'").get()
          .enabled,
        1,
      );
      await app.close();
      app = null;
    }
  } finally {
    await app?.close();
    await h.close();
  }
});
