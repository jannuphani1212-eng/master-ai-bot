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
