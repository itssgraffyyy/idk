import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, instrument } from "./support/harness.js";
const obligation = {
  amountPaise: 12500000,
  programme: "engineering",
  level: "ug",
  policyVersion: "UNVERIFIED_POLICY",
  starts: "2026-01-01",
  ends: "2036-01-01",
};
test("profile and programme/approval history updates are tenant scoped, revisioned and persisted", async () => {
  const h = await harness();
  try {
    const a = await h.login("admin"),
      b = await h.login("b"),
      o = await h.login("o");
    const profile = {
      name: "Synthetic College A",
      classification: "private",
      programmes: [{ programme: "engineering", level: "ug" }],
      approvals: [
        { reference: "TEST-APPROVAL", date: "2026-01-01", status: "claimed" },
      ],
      revision: 0,
    };
    assert.equal((await h.call("/institution", profile, a)).status, 200);
    assert.equal((await h.call("/institution", profile, a)).status, 409);
    assert.equal((await h.call("/institution", profile, o)).status, 403);
    const p = (await h.call("/institution", undefined, a)).body;
    assert.equal(p.revision, 1);
    assert.equal(p.approvals[0].reference, "TEST-APPROVAL");
    assert.notEqual(
      (await h.call("/institution", undefined, b)).body.name,
      p.name,
    );
    assert.equal(
      (
        await h.call(
          "/institution",
          {
            ...profile,
            revision: 1,
            approvals: [
              { reference: "bad", date: "2026-02-30", status: "claimed" },
            ],
          },
          a,
        )
      ).status,
      400,
    );
  } finally {
    await h.close();
  }
});
test("independent obligations support multiple linked instruments, guarded amendments and relationships", async () => {
  const h = await harness();
  try {
    const a = await h.login("a"),
      b = await h.login("b"),
      o = await h.login("o");
    const created = await h.call("/obligations", obligation, a);
    assert.equal(created.status, 201);
    const oid = created.body.id;
    assert.equal(
      (await h.call("/obligations/" + oid, undefined, b)).status,
      404,
    );
    const id = await h.create(a, { obligationId: oid }),
      path = "/cases/" + id;
    let c = (await h.call(path, undefined, a)).body;
    assert.equal(c.domain.obligation_id, oid);
    assert.equal(
      (
        await h.call(
          "/obligations/" + oid,
          { ...obligation, amountPaise: 15000000, revision: 1 },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (await h.call("/obligations/" + oid, { ...obligation, revision: 1 }, a))
        .status,
      409,
    );
    c = (await h.call(path, undefined, a)).body;
    assert.equal(c.obligation.amountPaise, 15000000);
    const next = await h.call(
      path + "/instruments",
      {
        instrument: {
          ...instrument,
          reference: "NEXT",
          type: "FDR",
          currency: "INR",
          branch: "Test branch",
        },
      },
      a,
    );
    assert.equal(next.status, 201);
    const first = c.domain.instruments[0];
    assert.equal(
      (
        await h.call(
          path + "/instrument-links",
          {
            predecessor: first.id,
            successor: next.body.id,
            revision: first.revision,
            reason: "Proposed replacement relationship only",
          },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await h.call(
          path + "/instrument-links",
          {
            predecessor: next.body.id,
            successor: first.id,
            revision: 1,
            reason: "Cycle",
          },
          a,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await h.call(
          path + "/instrument-primary",
          {
            instrumentId: next.body.id,
            revision: c.revision,
            reason: "Select new linked instrument",
          },
          a,
        )
      ).status,
      200,
    );
    assert.equal(
      (await h.call(path, undefined, a)).body.instrument.currency,
      "INR",
    );
    assert.equal(
      (await h.call(path + "/instruments", { instrument }, o)).status,
      403,
    );
    assert.equal(
      (
        await h.call(
          path + "/instruments",
          {
            instrument: {
              ...instrument,
              type: "FDR",
              currency: "USD",
              branch: "Test",
            },
          },
          a,
        )
      ).status,
      400,
    );
  } finally {
    await h.close();
  }
});
test("account administrators cannot cross tenant or elevate outside their role family; status revokes sessions", async () => {
  const h = await harness();
  try {
    const admin = await h.login("admin"),
      supervisor = await h.login("s"),
      a = await h.login("a"),
      r = await h.login("r");
    assert.equal(
      (
        await h.call(
          "/accounts",
          {
            email: "new@test.local",
            password: "twelve-letter-password",
            role: "supervisor",
          },
          admin,
        )
      ).status,
      400,
    );
    const created = await h.call(
      "/accounts",
      {
        email: "new@test.local",
        password: "twelve-letter-password",
        role: "institution",
      },
      admin,
    );
    assert.equal(created.status, 201);
    assert.equal(
      (
        await h.call(
          "/accounts",
          { id: "b", status: "disabled", reason: "Denied" },
          admin,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await h.call(
          "/accounts",
          {
            id: "a",
            status: "disabled",
            reason: "Institution administrator action",
          },
          admin,
        )
      ).status,
      200,
    );
    assert.equal((await h.call("/me", undefined, a)).status, 401);
    assert.equal((await h.call("/accounts", undefined, r)).status, 403);
    assert.equal(
      (
        await h.call(
          "/accounts",
          { id: "admin", status: "disabled", reason: "Denied" },
          supervisor,
        )
      ).status,
      404,
    );
    const list = (await h.call("/accounts", undefined, admin)).body;
    assert(list.every((x) => !("password" in x)));
    assert(
      !JSON.stringify(
        h.app.db.prepare("SELECT payload FROM audit").all(),
      ).includes("twelve-letter-password"),
    );
  } finally {
    await h.close();
  }
});
