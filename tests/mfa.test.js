import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support/harness.js";
import { totp, base32, fromBase32 } from "../src/mfa.js";
import { createApp } from "../src/server.js";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scrub } from "../src/observability.js";
// Public interoperability data, not credentials: RFC6238 AppendixB.
test("TOTP matches all SHA1 RFC6238 time vectors including beyond32bit counters and rejects invalid parameters", () => {
  const secret = Buffer.from("12345678901234567890");
  for (const [seconds, code] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])
    assert.equal(totp(secret, seconds * 1000, { digits: 8 }), code);
  assert.equal(base32(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(fromBase32("MZXW6YTBOI").toString(), "foobar");
  assert.throws(() => totp(secret, -1));
  assert.throws(() => fromBase32("not-a-secret"));
  assert.deepEqual(
    scrub({ mfaCode: "123456", recoveryCode: "private", otpauth: "private" }),
    {
      mfaCode: "[REDACTED]",
      recoveryCode: "[REDACTED]",
      otpauth: "[REDACTED]",
    },
  );
});
test("concurrent authenticator and recovery logins consume each factor once and failed attempts remain throttled across requests", async () => {
  let now = Date.parse("2026-10-27T15:00:00Z");
  const h = await harness({ mfaNow: () => now });
  try {
    const o = await h.login("o");
    const enrollment = await h.call(
      "/security/mfa/enroll",
      { password: "phase12-password", revision: 0 },
      o,
    );
    const secret = enrollment.body.secret;
    const confirm = await h.call(
      "/security/mfa/confirm",
      {
        password: "phase12-password",
        revision: enrollment.body.revision,
        mfaCode: totp(secret, now),
      },
      o,
    );
    assert.equal(confirm.status, 200);
    now += 60000;
    const credentials = {
      email: "o@test.local",
      password: "phase12-password",
      mfaCode: totp(secret, now),
    };
    const concurrent = await Promise.all([
      h.call("/login", credentials),
      h.call("/login", credentials),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 401]);
    const recovered = await Promise.all([
      h.call("/login", {
        email: "o@test.local",
        password: "phase12-password",
        recoveryCode: confirm.body.recoveryCodes[0],
      }),
      h.call("/login", {
        email: "o@test.local",
        password: "phase12-password",
        recoveryCode: confirm.body.recoveryCodes[0],
      }),
    ]);
    assert.deepEqual(recovered.map((r) => r.status).sort(), [200, 401]);
    now += 60000;
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await h.call("/login", {
            email: "o@test.local",
            password: "phase12-password",
            mfaCode: "invalid",
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await h.call("/login", {
          email: "o@test.local",
          password: "phase12-password",
          mfaCode: totp(secret, now),
        })
      ).status,
      429,
    );
    now += 60000;
    assert.equal(
      (
        await h.call("/login", {
          email: "o@test.local",
          password: "phase12-password",
          mfaCode: totp(secret, now),
        })
      ).status,
      200,
    );
  } finally {
    await h.close();
  }
});
test("required-role enrollment is session bound, encrypted, throttled, replay protected and enforces recent step-up and session revocation", async () => {
  let now = Date.parse("2026-10-27T12:00:00Z");
  const events = [];
  const h = await harness({
    mfaRequiredRoles: ["institution_admin"],
    mfaNow: () => now,
    logSink: (e) => events.push(e),
  });
  try {
    const admin = await h.login("admin"),
      otherSession = await h.login("admin");
    assert.equal((await h.call("/institution", undefined, admin)).status, 403);
    const path = "/security/mfa";
    assert.equal(
      (await h.call(path, undefined, admin)).body.enrollmentRequired,
      true,
    );
    assert.equal(
      (
        await h.call(
          path + "/enroll",
          { password: "incorrect", revision: 0 },
          admin,
        )
      ).status,
      401,
    );
    const enrollment = await h.call(
      path + "/enroll",
      { password: "phase12-password", revision: 0 },
      admin,
    );
    assert.equal(enrollment.status, 200);
    const secret = enrollment.body.secret;
    assert.equal(
      (
        await h.call(
          path + "/confirm",
          {
            password: "phase12-password",
            revision: enrollment.body.revision,
            mfaCode: totp(secret, now),
          },
          otherSession,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await h.call(
          path + "/confirm",
          {
            password: "phase12-password",
            revision: enrollment.body.revision,
            mfaCode: "invalid",
          },
          admin,
        )
      ).status,
      401,
    );
    now += 60000;
    const confirm = await h.call(
      path + "/confirm",
      {
        password: "phase12-password",
        revision: enrollment.body.revision,
        mfaCode: totp(secret, now),
      },
      admin,
    );
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    assert.equal(confirm.body.recoveryCodes.length, 8);
    assert.equal((await h.call("/me", undefined, otherSession)).status, 401);
    assert.equal((await h.call("/institution", undefined, admin)).status, 200);
    const record = JSON.stringify(
      h.app.db.prepare("SELECT * FROM user_mfa").all(),
    );
    assert.ok(!record.includes(secret));
    const recovery = confirm.body.recoveryCodes[0];
    assert.ok(
      !JSON.stringify(
        h.app.db.prepare("SELECT * FROM mfa_recovery").all(),
      ).includes(recovery.replace(/-/g, "")),
    );
    assert.equal(
      (
        await h.call("/login", {
          email: "admin@test.local",
          password: "phase12-password",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call("/login", {
          email: "admin@test.local",
          password: "phase12-password",
          mfaCode: totp(secret, now),
        })
      ).status,
      401,
    );
    now += 60000;
    const login = await h.call("/login", {
      email: "admin@test.local",
      password: "phase12-password",
      recoveryCode: recovery,
    });
    assert.equal(login.status, 200);
    assert.equal(
      (
        await h.call("/login", {
          email: "admin@test.local",
          password: "phase12-password",
          recoveryCode: recovery,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call(
          path + "/disable",
          { password: "phase12-password", mfaCode: totp(secret, now) },
          admin,
        )
      ).status,
      403,
    );
    now += 360000;
    assert.equal((await h.call("/accounts", {}, admin)).status, 403);
    const step = await h.call(
      "/security/step-up",
      { password: "phase12-password", mfaCode: totp(secret, now) },
      admin,
    );
    assert.equal(step.status, 200);
    assert.equal(
      (
        await h.call(
          "/security/step-up",
          { password: "phase12-password", mfaCode: totp(secret, now) },
          admin,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await h.call(
          path + "/enroll",
          { password: "phase12-password", revision: 2, userId: "b" },
          admin,
        )
      ).status,
      400,
    );
    now += 60000;
    const change = await h.call(
      "/security/password",
      {
        password: "phase12-password",
        newPassword: "changed-password-private",
        mfaCode: totp(secret, now),
      },
      admin,
    );
    assert.equal(change.status, 200);
    assert.equal((await h.call("/me", undefined, admin)).status, 401);
    now += 60000;
    assert.equal(
      (
        await h.call("/login", {
          email: "admin@test.local",
          password: "changed-password-private",
          mfaCode: totp(secret, now),
        })
      ).status,
      200,
    );
    const logs =
      JSON.stringify(events) +
      JSON.stringify(h.app.db.prepare("SELECT payload FROM audit").all());
    assert.ok(!logs.includes(secret));
    assert.ok(!logs.includes(recovery));
    assert.ok(!logs.includes("changed-password-private"));
  } finally {
    await h.close();
  }
});
test("audit reviewers can secure their own account while domain writes remain forbidden; missing MFA key never resets enrollment", async () => {
  let now = Date.parse("2026-10-27T13:00:00Z");
  const h = await harness({ mfaNow: () => now });
  let restarted;
  try {
    const r = await h.login("r");
    const enrollment = await h.call(
      "/security/mfa/enroll",
      { password: "phase12-password", revision: 0 },
      r,
    );
    assert.equal(enrollment.status, 200);
    assert.equal(
      (
        await h.call(
          "/security/mfa/confirm",
          {
            password: "phase12-password",
            revision: enrollment.body.revision,
            mfaCode: totp(enrollment.body.secret, now),
          },
          r,
        )
      ).status,
      200,
    );
    assert.equal((await h.call("/cases", {}, r)).status, 403);
    await h.app.close();
    const keyPath = join(h.dir, "security", "mfa.key"),
      key = readFileSync(keyPath);
    unlinkSync(keyPath);
    assert.throws(
      () => createApp({ dir: h.dir }),
      /MFA encryption key unavailable/,
    );
    assert.equal(existsSync(keyPath), false);
    assert.equal(existsSync(join(h.dir, ".server.lock")), false);
    writeFileSync(keyPath, key);
    restarted = createApp({ dir: h.dir });
    assert.equal(
      restarted.db
        .prepare("SELECT enabled FROM user_mfa WHERE user_id='r'")
        .get().enabled,
      1,
    );
  } finally {
    await restarted?.close();
    await h.close();
  }
});
