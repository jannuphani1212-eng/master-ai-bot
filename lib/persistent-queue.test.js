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


test("affiliate research draft is persisted with verification safeguards and idempotency", async () => {
  const calls = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "POST") {
        return { ok: true, text: async () => '[{"id":"campaign-1"}]' };
      }
      return { ok: true, text: async () => "[]" };
    }
  });
  const result = await queue.saveAffiliateCampaign("owner-1", "job-1", {
    productName: "Daily fashion research",
    provider: "groq",
    report: "Unverified product shortlist",
    content: { report: "Unverified product shortlist", productClaimsVerified: false }
  });
  assert.deepEqual(result, { id: "campaign-1", inserted: true });
  assert.equal(calls.length, 2);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.owner_user_id, "owner-1");
  assert.equal(body.source_job_id, "job-1");
  assert.equal(body.commission_status, "not_provided");
  assert.equal(body.research_status, "needs_live_verification");
  assert.equal(body.status, "draft");
  assert.equal(body.content_json.productClaimsVerified, false);
});

test("affiliate research draft returns the existing campaign for a retried queue job", async () => {
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async () => ({ ok: true, text: async () => '[{"id":"campaign-existing"}]' })
  });
  const result = await queue.saveAffiliateCampaign("owner-1", "job-1", { report: "duplicate retry" });
  assert.deepEqual(result, { id: "campaign-existing", inserted: false });
});


test("queue renews an active worker lease only when the worker still owns it", async () => {
  let call;
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, text: async () => '[{"id":"job-1"}]' };
    }
  });
  assert.equal(await queue.renew("job-1", "worker-1"), true);
  assert.match(call.url, /id=eq.job-1&locked_by=eq.worker-1&status=eq.running/);
  assert.equal(call.options.method, "PATCH");
  assert.ok(JSON.parse(call.options.body).locked_at);
});
