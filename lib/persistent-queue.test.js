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


test("SEO daily context can retrieve failed workstream status and root error", async () => {
  let requestedUrl = "";
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async url => {
      requestedUrl = url;
      return { ok: true, text: async () => '[{"agent_id":"blogging","status":"failed","last_error":"provider unavailable","result":{}}]' };
    }
  });
  const results = await queue.dailyResults("owner-1", "2026-11-23");
  assert.equal(results[0].status, "failed");
  assert.equal(results[0].last_error, "provider unavailable");
  assert.match(requestedUrl, /last_error/);
  assert.doesNotMatch(requestedUrl, /status=eq.completed/);
});


test("blog draft persistence rejects an incomplete article before database writes", async () => {
  let calls = 0;
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async () => { calls += 1; throw new Error("unexpected database call"); }
  });
  await assert.rejects(queue.saveBlogDraft("owner-1", "job-1", {
    topic: "Short draft",
    content: { article: "too short", wordCount: 2 }
  }), /incomplete article body/);
  assert.equal(calls, 0);
});

test("retry replaces an incomplete draft and verifies the complete read-back", async () => {
  let row = {
    id: "draft-1",
    topic: "Old incomplete topic",
    status: "draft",
    content_json: { article: "short", wordCount: 2, editorialReview: { status: "needs_review", score: 20 } }
  };
  const calls = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("source_job_id=eq.")) return { ok: true, text: async () => JSON.stringify([row]) };
      if (options.method === "PATCH") {
        row = { ...row, ...JSON.parse(options.body) };
        return { ok: true, text: async () => JSON.stringify([{ id: row.id }]) };
      }
      return { ok: true, text: async () => JSON.stringify([row]) };
    }
  });
  const article = "A".repeat(2200);
  const result = await queue.saveBlogDraft("owner-1", "job-1", {
    topic: "A complete study guide",
    provider: "Groq",
    targetKeyword: "study guide",
    content: { title: "A complete study guide", article, wordCount: 400, editorialReview: { status: "passed", score: 95 } }
  });
  assert.deepEqual(result, { id: "draft-1", inserted: false, verified: true, updated: true });
  assert.equal(row.topic, "A complete study guide");
  assert.equal(row.content_json.article, article);
  assert.equal(calls.length, 3);
});

test("retry never overwrites an owner-reviewed blog draft", async () => {
  let patchCalled = false;
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      if (url.includes("source_job_id=eq.")) return { ok: true, text: async () => '[{"id":"draft-1","status":"approved","content_json":{"article":"reviewed"}}]' };
      if (options.method === "PATCH") patchCalled = true;
      return { ok: true, text: async () => "[]" };
    }
  });
  await assert.rejects(queue.saveBlogDraft("owner-1", "job-1", {
    topic: "New article",
    content: { article: "A".repeat(2200), wordCount: 400 }
  }), /refusing to overwrite owner-reviewed content/);
  assert.equal(patchCalled, false);
});


test("queue checkpoints generated output only while the worker still owns the running lease", async () => {
  let call;
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, text: async () => '[{"id":"job-1"}]' };
    }
  });
  assert.equal(await queue.checkpoint("job-1", "worker-1", { checkpoint: "ai_response_received", report: "draft output" }), true);
  assert.match(call.url, /id=eq.job-1&locked_by=eq.worker-1&status=eq.running/);
  assert.equal(call.options.method, "PATCH");
  assert.deepEqual(JSON.parse(call.options.body).result, { checkpoint: "ai_response_received", report: "draft output" });
});

test("queue refuses to save a checkpoint after the worker lease is lost", async () => {
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async () => ({ ok: true, text: async () => "[]" })
  });
  await assert.rejects(queue.checkpoint("job-1", "other-worker", { report: "draft" }), /lease was lost/);
});


test("queue marks an exhausted pending job failed so a new recovery can be queued", async () => {
  const calls = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (!options.method) return { ok: true, text: async () => '[{"status":"pending","attempts":4,"max_attempts":4,"locked_at":null}]' };
      return { ok: true, text: async () => '[{"id":"job-1"}]' };
    }
  });
  assert.deepEqual(await queue.recoverExpired("job-1", 2), { recovered: true, status: "failed" });
  assert.match(calls[1].url, /status=eq.pending&attempts=eq.4/);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.status, "failed");
  assert.ok(body.finished_at);
  assert.match(body.last_error, /exhausted all attempts/);
});

test("queue recovers a stale running job with retries remaining back to pending", async () => {
  const calls = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (!options.method) return { ok: true, text: async () => '[{"status":"running","attempts":2,"max_attempts":4,"locked_at":"2020-01-01T00:00:00.000Z"}]' };
      return { ok: true, text: async () => '[{"id":"job-1"}]' };
    }
  });
  assert.deepEqual(await queue.recoverExpired("job-1", 2), { recovered: true, status: "pending" });
  assert.match(calls[0].url, /id=eq.job-1&select=status,attempts,max_attempts,locked_at/);
  assert.match(calls[1].url, /attempts=eq.2/);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.status, "pending");
  assert.equal(body.finished_at, null);
  assert.equal(body.locked_at, null);
  assert.equal(body.locked_by, null);
  assert.match(body.last_error, /lease expired/);
});

test("queue marks an expired final attempt failed instead of leaving an unclaimable pending job", async () => {
  const calls = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (!options.method) return { ok: true, text: async () => '[{"status":"running","attempts":4,"max_attempts":4,"locked_at":"2020-01-01T00:00:00.000Z"}]' };
      return { ok: true, text: async () => '[{"id":"job-1"}]' };
    }
  });
  assert.deepEqual(await queue.recoverExpired("job-1", 2), { recovered: true, status: "failed" });
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.status, "failed");
  assert.ok(body.finished_at);
  assert.match(body.last_error, /exhausted all attempts/);
});

test("queue does not recover a job unless the running lease filter matches", async () => {
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async () => ({ ok: true, text: async () => "[]" })
  });
  assert.deepEqual(await queue.recoverExpired("job-1", 2), { recovered: false, status: null });
});
