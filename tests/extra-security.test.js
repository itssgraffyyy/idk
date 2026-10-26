import { test } from "node:test";
import assert from "node:assert/strict";
import { readBoundedJSON } from "../src/http-client.js";
import { SetuSandboxProvider } from "../src/setu.js";
import { permittedHost, requestLimiter } from "../src/security.js";
test("provider response streaming is size bounded and invalid JSON is rejected", async () => {
  await assert.rejects(() =>
    readBoundedJSON(new Response("x".repeat(21000)), 20000),
  );
  await assert.rejects(() => readBoundedJSON(new Response("not-json"), 20000));
  assert.deepEqual(await readBoundedJSON(new Response('{"ok":true}'), 100), {
    ok: true,
  });
});
test("sandbox token exchange follows pinned host/contract and never treats authentication as bank confirmation", async () => {
  const calls = [];
  const p = new SetuSandboxProvider({
    clientId: "fixture-id",
    clientSecret: "fixture-secret",
    productInstanceId: "fixture-product",
    accessToken: "",
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify(
          url.includes("/users/login")
            ? { access_token: "fixture-token" }
            : { id: "consent-1", status: "PENDING" },
        ),
      );
    },
  });
  await p.consent("consent-1");
  assert.equal(calls[0].url, "https://orgservice-prod.setu.co/v1/users/login");
  assert.equal(calls[0].init.headers.client, "bridge");
  assert.equal(JSON.parse(calls[0].init.body).grant_type, "client_credentials");
  assert.equal(calls[1].init.headers.Authorization, "Bearer fixture-token");
});
test("request and host guards reject rebinding targets and sustained excess", () => {
  assert(permittedHost("127.0.0.1:3000"));
  assert(!permittedHost("attacker.example"));
  assert(!permittedHost("127.0.0.1.attacker.example"));
  const allowed = requestLimiter({ limit: 3 });
  assert(allowed("client"));
  assert(allowed("client"));
  assert(allowed("client"));
  assert(!allowed("client"));
});
