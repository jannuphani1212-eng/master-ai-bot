import test from "node:test";
import assert from "node:assert/strict";
import { createPersistentQueue } from "./persistent-queue.js";

test("queue requires service-side Supabase configuration", () => {
  assert.throws(() => createPersistentQueue({ env: {} }), /SUPABASE_URL/);
});

test("queue enqueue validates allowed specialist IDs before writing", async () => {
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async () => { throw new Error("fetch must not run for invalid jobs"); }
  });
  await assert.rejects(queue.enqueue("owner", [{ agentId: "master", task: "x", idempotencyKey: "x" }]), /invalid agent/);
});

test("queue enqueue sends owner-scoped idempotent rows", async () => {
  let call;
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, text: async () => '[{"id":"job-1"}]' };
    }
  });
  const result = await queue.enqueue("owner-1", [{ agentId: "seo", task: "Daily SEO audit", idempotencyKey: "daily:2026-11-23:seo" }]);
  assert.deepEqual(result, { inserted: 1, requested: 1 });
  assert.match(call.url, /master_ai_job_queue\?on_conflict=owner_user_id,idempotency_key$/);
  assert.equal(JSON.parse(call.options.body)[0].owner_user_id, "owner-1");
});

test("queue claims work through the atomic database RPC", async () => {
  let call;
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, text: async () => '[{"id":"job-1","attempts":1}]' };
    }
  });
  const job = await queue.claim("worker-123");
  assert.equal(job.id, "job-1");
  assert.match(call.url, /rpc\/claim_master_ai_job$/);
  assert.deepEqual(JSON.parse(call.options.body), { p_worker_id: "worker-123" });
});

test("queue completion is guarded by the active worker lease", async () => {
  let call;
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, text: async () => '[{"id":"job-1","status":"completed"}]' };
    }
  });
  assert.equal(await queue.complete("job-1", "worker-123", { success: true }), true);
  assert.match(call.url, /id=eq\.job-1.*locked_by=eq\.worker-123.*status=eq\.running/);
  assert.equal(JSON.parse(call.options.body).status, "completed");
});

test("queue failures retry with bounded exponential backoff", async () => {
  let call;
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, text: async () => '[{"id":"job-1","status":"pending"}]' };
    }
  });
  const result = await queue.fail({ id: "job-1", attempts: 2, max_attempts: 4 }, "worker-123", new Error("temporary provider error"));
  assert.deepEqual(result, { terminal: false, retryInSeconds: 60 });
  const body = JSON.parse(call.options.body);
  assert.equal(body.status, "pending");
  assert.equal(body.last_error, "temporary provider error");
  assert.ok(Date.parse(body.next_run_at) > Date.now());
});

test("queue failures stop after the configured maximum attempts", async () => {
  let call;
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, text: async () => '[{"id":"job-1","status":"failed"}]' };
    }
  });
  const result = await queue.fail({ id: "job-1", attempts: 4, max_attempts: 4 }, "worker-123", "repeated failure");
  assert.deepEqual(result, { terminal: true, retryInSeconds: 0 });
  assert.equal(JSON.parse(call.options.body).status, "failed");
});
