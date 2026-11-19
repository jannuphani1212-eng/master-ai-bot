import test from "node:test";
import assert from "node:assert/strict";
import { createAgentHistoryHandlers } from "./supabase-task-history.js";

function response({ ok = true, status = 200, body = [] } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => typeof body === "string" ? body : JSON.stringify(body)
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("history writes are owner-scoped and send only bounded report fields", async () => {
  let request;
  const handlers = createAgentHistoryHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "server-secret" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ status: 201 });
    }
  });
  const saved = await handlers.record("owner-123", {
    agentId: "youtube",
    task: "Create a channel plan",
    status: "completed",
    provider: "Groq",
    qualityScore: 92,
    report: "Draft report",
    metadata: { source: "test" }
  });
  assert.equal(saved, true);
  assert.match(request.url, /agent_task_history$/);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer server-secret");
  const body = JSON.parse(request.options.body);
  assert.equal(body.owner_user_id, "owner-123");
  assert.equal(body.agent_id, "youtube");
  assert.equal(body.quality_score, 92);
  assert.equal(body.report, "Draft report");
});

test("history does not write for missing owner or unknown agent", async () => {
  let calls = 0;
  const handlers = createAgentHistoryHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async () => { calls += 1; return response(); }
  });
  assert.equal(await handlers.record("", { agentId: "youtube" }), false);
  assert.equal(await handlers.record("owner-123", { agentId: "unknown" }), false);
  assert.equal(calls, 0);
});

test("history list filters by authenticated owner and requested agent", async () => {
  let requestedUrl = "";
  const handlers = createAgentHistoryHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async url => {
      requestedUrl = url;
      return response({ body: [{
        id: "row-1",
        agent_id: "seo",
        task: "Audit my site",
        status: "needs_attention",
        provider: "OpenRouter",
        quality_score: 70,
        report: "Needs evidence",
        created_at: "2026-11-19T00:00:00Z"
      }] });
    }
  });
  const res = responseRecorder();
  await handlers.list({ query: { agentId: "seo" }, ownerUser: { id: "owner-123" } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(requestedUrl, /owner_user_id=eq\.owner-123/);
  assert.match(requestedUrl, /agent_id=eq\.seo/);
  assert.equal(res.body.history[0].status, "Needs attention");
  assert.equal(res.body.history[0].quality, 70);
});

test("history list rejects unknown agent IDs", async () => {
  const handlers = createAgentHistoryHandlers({ fetchImpl: async () => { throw new Error("should not call"); } });
  const res = responseRecorder();
  await handlers.list({ query: { agentId: "admin" }, ownerUser: { id: "owner-123" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
});

test("history list reports missing server configuration without exposing secrets", async () => {
  const handlers = createAgentHistoryHandlers({ env: {} });
  const res = responseRecorder();
  await handlers.list({ query: {}, ownerUser: { id: "owner-123" } }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /SUPABASE_SERVICE_ROLE_KEY/);
});
