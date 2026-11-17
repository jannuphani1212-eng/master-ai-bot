import test from "node:test";
import assert from "node:assert/strict";
import { createSelfHealingPersistence } from "../lib/self-healing-store.js";
import { createSelfHealingMonitor } from "../lib/self-healing.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const env = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key",
  SUPABASE_OWNER_USER_ID: ownerId
};

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body === null ? "" : JSON.stringify(body); }
  };
}

test("persistence restores the latest state per specialist and recent history", async () => {
  const calls = [];
  const store = createSelfHealingPersistence({
    env,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return response([
        {
          agent_id: "affiliate",
          status: "degraded",
          consecutive_failures: 2,
          checked_at: "2026-11-17T10:00:00.000Z",
          last_success_at: null,
          last_failure_at: "2026-11-17T10:00:00.000Z",
          error_category: "rate_limit",
          error_message: "HTTP 429 quota",
          recovery_action: "Use the next provider."
        },
        {
          agent_id: "affiliate",
          status: "healthy",
          consecutive_failures: 0,
          checked_at: "2026-11-17T09:00:00.000Z",
          last_success_at: "2026-11-17T09:00:00.000Z",
          last_failure_at: null,
          error_category: null,
          error_message: null,
          recovery_action: "No repair needed."
        }
      ]);
    }
  });

  const restored = await store.restore();
  assert.equal(restored.agents.length, 1);
  assert.equal(restored.agents[0].agentId, "affiliate");
  assert.equal(restored.agents[0].status, "degraded");
  assert.equal(restored.agents[0].consecutiveFailures, 2);
  assert.equal(restored.recentHistory.length, 2);
  assert.match(calls[0].url, /owner_user_id=eq\\./);
  assert.equal(calls[0].options.headers.Authorization, "Bearer server-only-test-key");
  assert.equal(store.status().connected, true);
});

test("persistence saves an event using server-only credentials", async () => {
  let saved;
  let headers;
  const store = createSelfHealingPersistence({
    env,
    fetchImpl: async (_url, options = {}) => {
      headers = options.headers;
      saved = JSON.parse(options.body);
      return response(null, 201);
    }
  });

  await store.save({
    agentId: "youtube",
    status: "healthy",
    consecutiveFailures: 0,
    lastCheckedAt: "2026-11-17T10:00:00.000Z",
    lastSuccessAt: "2026-11-17T10:00:00.000Z",
    lastFailureAt: null,
    lastErrorCategory: null,
    lastError: null,
    recoveryAction: "No repair needed."
  });

  assert.equal(saved.owner_user_id, ownerId);
  assert.equal(saved.agent_id, "youtube");
  assert.equal(saved.status, "healthy");
  assert.equal(headers.apikey, "server-only-test-key");
});

test("monitor hydrates saved state and continues working if persistence is unavailable", async () => {
  const savedEvents = [];
  const persistence = {
    configured: true,
    async restore() {
      return {
        agents: [{
          agentId: "seo",
          status: "degraded",
          consecutiveFailures: 3,
          lastCheckedAt: "2026-11-17T10:00:00.000Z",
          lastSuccessAt: null,
          lastFailureAt: "2026-11-17T10:00:00.000Z",
          lastErrorCategory: "timeout",
          lastError: "timeout",
          recoveryAction: "Retry once."
        }],
        recentHistory: []
      };
    },
    async save(state) {
      savedEvents.push(state);
      throw new Error("database offline");
    },
    status() { return { enabled: true, connected: false, lastLoadedAt: null, lastError: null }; }
  };

  const monitor = createSelfHealingMonitor({
    agentIds: ["seo"],
    persistence,
    now: () => Date.parse("2026-11-17T11:00:00.000Z")
  });
  await monitor.ready;
  assert.equal(monitor.getAgent("seo").consecutiveFailures, 3);

  const updated = monitor.record("seo", { success: true });
  assert.equal(updated.status, "healthy");
  assert.equal(updated.consecutiveFailures, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(savedEvents.length, 1);
  assert.equal(monitor.getAgent("seo").status, "healthy");
});
