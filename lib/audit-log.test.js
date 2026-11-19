import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createAuditMiddleware } from "./audit-log.js";

test("writes a minimal owner audit event after a protected request finishes", async () => {
  let captured;
  let finished;
  const middleware = createAuditMiddleware({
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "server-secret",
      AUDIT_LOG_HASH_SECRET: "hash-secret"
    },
    now: () => 1000,
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return { ok: true };
    }
  });
  const req = {
    ownerUser: { id: "owner-123" },
    method: "POST",
    baseUrl: "",
    path: "/api/task",
    ip: "203.0.113.8",
    headers: { authorization: "Bearer must-not-be-logged", "user-agent": "test-agent" }
  };
  const res = new EventEmitter();
  res.statusCode = 200;
  let continued = false;
  middleware(req, res, () => { continued = true; });
  assert.equal(continued, true);
  res.emit("finish");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captured.url, "https://example.supabase.co/rest/v1/audit_events");
  assert.equal(captured.body.actor_user_id, "owner-123");
  assert.equal(captured.body.event_type, "post /api/task");
  assert.equal(captured.body.status_code, 200);
  assert.equal(captured.body.ip_hash.length, 64);
  assert.equal(JSON.stringify(captured.body).includes("must-not-be-logged"), false);
  assert.equal(captured.body.user_agent, "test-agent");
});

test("does not attempt to write when request is not authenticated as owner", () => {
  let called = false;
  const middleware = createAuditMiddleware({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async () => { called = true; return { ok: true }; }
  });
  const req = { method: "GET", path: "/api/health" };
  const res = new EventEmitter();
  let continued = false;
  middleware(req, res, () => { continued = true; });
  res.emit("finish");
  assert.equal(continued, true);
  assert.equal(called, false);
});
