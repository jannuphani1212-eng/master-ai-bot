import test from "node:test";
import assert from "node:assert/strict";
import { createOwnerAuthMiddleware } from "../lib/owner-auth.js";

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-key",
  SUPABASE_OWNER_USER_ID: "owner-123"
};

test("blocks AI task access when Supabase owner auth is not configured", async () => {
  const middleware = createOwnerAuthMiddleware({ env: {} });
  const res = responseRecorder();
  let continued = false;
  await middleware({ headers: {} }, res, () => { continued = true; });
  assert.equal(res.statusCode, 503);
  assert.equal(continued, false);
});

test("requires a bearer session before AI task access", async () => {
  const middleware = createOwnerAuthMiddleware({ env, fetchImpl: async () => { throw new Error("must not fetch"); } });
  const res = responseRecorder();
  let continued = false;
  await middleware({ headers: {} }, res, () => { continued = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(continued, false);
});

test("rejects a signed-in user who is not the configured owner", async () => {
  const middleware = createOwnerAuthMiddleware({
    env,
    fetchImpl: async () => ({ ok: true, json: async () => ({ id: "other-user" }) })
  });
  const res = responseRecorder();
  let continued = false;
  await middleware({ headers: { authorization: "Bearer valid-token" } }, res, () => { continued = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(continued, false);
});

test("allows only the configured owner after Supabase verifies the session", async () => {
  let requestOptions;
  const middleware = createOwnerAuthMiddleware({
    env,
    fetchImpl: async (url, options) => {
      requestOptions = { url, options };
      return { ok: true, json: async () => ({ id: "owner-123" }) };
    }
  });
  const req = { headers: { authorization: "Bearer owner-token" } };
  const res = responseRecorder();
  let continued = false;
  await middleware(req, res, () => { continued = true; });
  assert.equal(continued, true);
  assert.deepEqual(req.ownerUser, { id: "owner-123" });
  assert.equal(requestOptions.url, "https://example.supabase.co/auth/v1/user");
  assert.equal(requestOptions.options.headers.Authorization, "Bearer owner-token");
});
