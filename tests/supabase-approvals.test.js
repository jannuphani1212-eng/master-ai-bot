import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseApprovalHandlers } from "../lib/supabase-approvals.js";

const ownerId = "11111111-2222-4333-8444-555555555555";
const env = {
  SUPABASE_URL: "https://supabase.example.test",
  SUPABASE_ANON_KEY: "anon-test-key",
  SUPABASE_OWNER_USER_ID: ownerId
};

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("owner approval storage accepts an Instagram Reel publish proposal without executing it", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) return response(200, { id: ownerId });
    if (String(url).endsWith("/rest/v1/approval_requests")) {
      return response(201, [{
        id: "approval-1",
        owner_id: ownerId,
        action_type: "instagram_reel_publish",
        status: "pending"
      }]);
    }
    throw new Error("Unexpected request: " + url);
  };

  const handlers = createSupabaseApprovalHandlers({ env, fetchImpl });
  const res = mockRes();
  await handlers.create({
    headers: { authorization: "Bearer owner-session-token" },
    body: {
      title: "Review Instagram Reel",
      actionType: "instagram_reel_publish",
      payload: { videoUrl: "https://cdn.example.test/reel.mp4" }
    }
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.approval.status, "pending");
  assert.match(res.body.message, /No external action was executed/);
  assert.equal(calls.length, 2);
});

test("owner approval storage rejects an unapproved account", async () => {
  const handlers = createSupabaseApprovalHandlers({
    env,
    fetchImpl: async () => response(200, { id: "not-the-owner" })
  });
  const res = mockRes();
  await handlers.create({
    headers: { authorization: "Bearer other-session-token" },
    body: { title: "Test", actionType: "instagram_reel_publish", payload: {} }
  }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
});
