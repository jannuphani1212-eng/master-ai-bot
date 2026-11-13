import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseApprovalHandlers } from "../lib/supabase-approvals.js";

function makeResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; }
  };
}

function makeReq({ authorization = "Bearer owner-token", body = {}, params = {}, headers = {} } = {}) {
  return {
    headers: { authorization, ...headers },
    body,
    params,
    get(name) { return this.headers[name.toLowerCase()]; }
  };
}

function makeRes() {
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
  SUPABASE_OWNER_USER_ID: "owner-uuid"
};

test("approval API refuses to run when server configuration is missing", async () => {
  const handlers = createSupabaseApprovalHandlers({ env: {}, fetchImpl: async () => { throw new Error("must not call"); } });
  const res = makeRes();
  await handlers.list(makeReq(), res);
  assert.equal(res.statusCode, 503);
});

test("approval API requires a bearer access token", async () => {
  const handlers = createSupabaseApprovalHandlers({ env, fetchImpl: async () => { throw new Error("must not call"); } });
  const res = makeRes();
  await handlers.list(makeReq({ authorization: "" }), res);
  assert.equal(res.statusCode, 401);
});

test("approval API rejects a signed-in user who is not the configured owner", async () => {
  const handlers = createSupabaseApprovalHandlers({
    env,
    fetchImpl: async () => makeResponse(200, { id: "another-user" })
  });
  const res = makeRes();
  await handlers.list(makeReq(), res);
  assert.equal(res.statusCode, 403);
});

test("owner can create a proposal using verified identity and user-scoped token", async () => {
  const calls = [];
  const handlers = createSupabaseApprovalHandlers({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/auth/v1/user")) return makeResponse(200, { id: "owner-uuid" });
      return makeResponse(201, [{ id: "approval-1", status: "pending" }]);
    }
  });
  const res = makeRes();
  await handlers.create(makeReq({
    body: { title: "Review new video", actionType: "publish", payload: { platform: "YouTube" } }
  }), res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.approval.status, "pending");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Authorization, "Bearer owner-token");
  assert.equal(calls[1].options.headers.apikey, "public-anon-key");
  assert.equal(JSON.parse(calls[1].options.body).owner_id, "owner-uuid");
});

test("approval API validates proposal data before writing", async () => {
  let writes = 0;
  const handlers = createSupabaseApprovalHandlers({
    env,
    fetchImpl: async (url) => {
      if (url.endsWith("/auth/v1/user")) return makeResponse(200, { id: "owner-uuid" });
      writes += 1;
      return makeResponse(201, []);
    }
  });
  const res = makeRes();
  await handlers.create(makeReq({ body: { title: "", actionType: "unknown", payload: [] } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(writes, 0);
});

test("owner can decide a pending request exactly through a conditional update", async () => {
  let update;
  const handlers = createSupabaseApprovalHandlers({
    env,
    fetchImpl: async (url, options) => {
      if (url.endsWith("/auth/v1/user")) return makeResponse(200, { id: "owner-uuid" });
      update = { url, options };
      return makeResponse(200, [{ id: "approval-uuid", status: "approved" }]);
    }
  });
  const res = makeRes();
  await handlers.decide(makeReq({
    params: { id: "123e4567-e89b-42d3-a456-426614174000" },
    body: { status: "approved", decisionNote: "Reviewed" }
  }), res);

  assert.equal(res.statusCode, 200);
  assert.match(update.url, /status=eq\.pending/);
  assert.equal(JSON.parse(update.options.body).status, "approved");
  assert.equal(JSON.parse(update.options.body).decision_note, "Reviewed");
});

test("decision API refuses invalid IDs and unsupported statuses", async () => {
  const handlers = createSupabaseApprovalHandlers({
    env,
    fetchImpl: async () => makeResponse(200, { id: "owner-uuid" })
  });
  const res = makeRes();
  await handlers.decide(makeReq({ params: { id: "not-an-id" }, body: { status: "approved" } }), res);
  assert.equal(res.statusCode, 400);
});
