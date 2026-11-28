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
      return { ok: true, text: async () => '[{"agent_id":"blogging","status":"failed","last_error":"provider unavailable","result":{},"idempotency_key":"daily:2026-11-23:blogging"}]' };
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


test("queue recovers a stale running job with retries remaining back to pending", async () => {
  const calls = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (!options.method) return { ok: true, text: async () => '[{"attempts":2,"max_attempts":4}]' };
      return { ok: true, text: async () => '[{"id":"job-1"}]' };
    }
  });
  assert.deepEqual(await queue.recoverExpired("job-1", 2), { recovered: true, status: "pending" });
  assert.match(calls[0].url, /id=eq.job-1&status=eq.running&locked_at=lt\./);
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
      if (!options.method) return { ok: true, text: async () => '[{"attempts":4,"max_attempts":4}]' };
      return { ok: true, text: async () => '[{"id":"job-1"}]' };
    }
  });
  assert.deepEqual(await queue.recoverExpired("job-1", 2), { recovered: true, status: "failed" });
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.status, "failed");
  assert.ok(body.finished_at);
  assert.match(body.last_error, /final attempt/);
});

test("queue does not recover a job unless the running lease filter matches", async () => {
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async () => ({ ok: true, text: async () => "[]" })
  });
  assert.deepEqual(await queue.recoverExpired("job-1", 2), { recovered: false, status: null });
});

test("queue finalizes an exhausted pending job so recovery can enqueue a fresh attempt", async () => {
  const calls = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (!options.method) return { ok: true, text: async () => '[{"attempts":4,"max_attempts":4}]' };
      return { ok: true, text: async () => '[{"id":"job-1"}]' };
    }
  });
  assert.deepEqual(await queue.finalizeExhaustedPending("job-1"), { finalized: true, status: "failed" });
  assert.match(calls[0].url, /id=eq.job-1&status=eq.pending/);
  assert.match(calls[1].url, /attempts=eq.4/);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.status, "failed");
  assert.ok(body.finished_at);
  assert.match(body.last_error, /exhausted all attempts/);
});

test("queue leaves a pending job alone when retries remain", async () => {
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async () => ({ ok: true, text: async () => '[{"attempts":2,"max_attempts":4}]' })
  });
  assert.deepEqual(await queue.finalizeExhaustedPending("job-1"), { finalized: false, status: null });
});


test("daily blog retry reuses an existing passed draft for the same day and normalized topic", async () => {
  const article = "A".repeat(2200);
  const prior = {
    id: "draft-existing",
    topic: "India’s Sports Pulse – 27 Nov 2026",
    status: "draft",
    created_at: "2026-11-27T17:08:23Z",
    content_json: {
      dayKey: "2026-11-27",
      article,
      wordCount: 400,
      editorialReview: { status: "passed", score: 100 }
    }
  };
  const calls = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("source_job_id=eq.")) return { ok: true, text: async () => "[]" };
      if (url.includes("content_json->>dayKey=eq.")) return { ok: true, text: async () => JSON.stringify([prior]) };
      if (url.includes("id=eq.draft-existing")) return { ok: true, text: async () => JSON.stringify([prior]) };
      throw new Error("Unexpected request: " + url);
    }
  });
  const result = await queue.saveBlogDraft("owner-1", "job-retry-2", {
    topic: "INDIA'S SPORTS PULSE 27 NOV 2026!",
    provider: "Groq",
    content: {
      dayKey: "2026-11-27",
      article: "B".repeat(2300),
      wordCount: 410,
      editorialReview: { status: "passed", score: 99 }
    }
  });
  assert.deepEqual(result, {
    id: "draft-existing",
    inserted: false,
    verified: true,
    updated: false,
    deduplicated: true
  });
  assert.equal(calls.some(call => call.options.method === "POST" || call.options.method === "PATCH"), false);
  assert.ok(calls.some(call => call.url.includes("content_json->>dayKey=eq.2026-11-27")));
});


test("daily report results exclude recovery jobs and include only the five base daily assignments", async () => {
  const requested = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async url => {
      requested.push(url);
      return {
        ok: true,
        text: async () => JSON.stringify([
          { agent_id: "blogging", status: "completed", idempotency_key: "daily:2026-11-28:blogging" },
          { agent_id: "blogging", status: "failed", idempotency_key: "daily:2026-11-28:blogging:recovery:1" },
          { agent_id: "seo", status: "pending", idempotency_key: "daily:2026-11-28:seo" }
        ])
      };
    }
  });
  const rows = await queue.dailyResults("owner-1", "2026-11-28");
  assert.deepEqual(rows.map(row => row.idempotency_key), [
    "daily:2026-11-28:blogging",
    "daily:2026-11-28:seo"
  ]);
  assert.match(requested[0], /idempotency_key/);
});


test("daily report updates an earlier partial report for the same India day", async () => {
  const calls = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "PATCH") {
        return { ok: true, text: async () => '[{"id":"report-1"}]' };
      }
      return { ok: true, text: async () => '[{"id":"report-1"}]' };
    }
  });
  const result = await queue.upsertDailyReport("owner-1", {
    title: "Daily Master AI report · 2026-11-28",
    body: "Completed: 4/5",
    metadata: { dayKey: "2026-11-28", counts: { completed: 4, failed: 1 } }
  });
  assert.deepEqual(result, { id: "report-1", updated: true });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /notification_type=eq.daily_report/);
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(JSON.parse(calls[1].options.body).metadata.counts.completed, 4);
});

test("daily report creates a notification when no earlier report exists", async () => {
  const calls = [];
  const queue = createPersistentQueue({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "POST") return { ok: true, text: async () => "" };
      return { ok: true, text: async () => "[]" };
    }
  });
  const result = await queue.upsertDailyReport("owner-1", {
    title: "Daily Master AI report · 2026-11-28",
    body: "Completed: 4/5",
    metadata: { dayKey: "2026-11-28", counts: { completed: 4, failed: 1 } }
  });
  assert.deepEqual(result, { id: null, updated: false });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, "POST");
});
