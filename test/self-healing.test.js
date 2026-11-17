import test from "node:test";
import assert from "node:assert/strict";
import { createSelfHealingMonitor, classifyFailure } from "../lib/self-healing.js";

test("starts agents as unknown rather than falsely healthy", () => {
  const monitor = createSelfHealingMonitor();
  const report = monitor.snapshot();
  assert.equal(report.monitoredAgents, 6);
  assert.equal(report.unknown, 6);
  assert.equal(report.overallStatus, "unknown");
});

test("records successful recovery and resets consecutive failures", () => {
  let time = Date.parse("2026-11-17T10:00:00.000Z");
  const monitor = createSelfHealingMonitor({ agentIds: ["affiliate"], now: () => time });
  monitor.record("affiliate", { success: false, error: "provider returned 503 unavailable" });
  time += 1000;
  const recovered = monitor.record("affiliate", { success: true });
  assert.equal(recovered.status, "healthy");
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.lastError, null);
  assert.equal(monitor.snapshot().overallStatus, "healthy");
});

test("classifies common failure types and recommends safe recovery", () => {
  assert.equal(classifyFailure("HTTP 429 quota exhausted"), "rate_limit");
  assert.equal(classifyFailure("Request timed out"), "timeout");
  assert.equal(classifyFailure("401 invalid API key"), "authentication");
  const monitor = createSelfHealingMonitor({ agentIds: ["seo"] });
  const failed = monitor.record("seo", { success: false, error: "HTTP 429 rate limit" });
  assert.equal(failed.status, "degraded");
  assert.equal(failed.lastErrorCategory, "rate_limit");
  assert.match(failed.recoveryAction, /cooldown/i);
});

test("tracks repeated failures and keeps bounded history", () => {
  const monitor = createSelfHealingMonitor({ agentIds: ["youtube"], maxHistory: 2 });
  monitor.record("youtube", { success: false, error: "timeout" });
  const second = monitor.record("youtube", { success: false, error: "fetch failed" });
  monitor.record("youtube", { success: false, error: "unknown" });
  assert.equal(second.consecutiveFailures, 2);
  const report = monitor.snapshot();
  assert.equal(report.degraded, 1);
  assert.equal(report.recentHistory.length, 2);
});


test("classifies the historical OpenRouter no-usable-text truncation as invalid output", () => {
  const error = "OpenRouter returned no usable text (finish_reason=length, message_fields=role, content, refusal, reasoning_chars=0, completion_tokens=2000).";
  assert.equal(classifyFailure(error), "invalid_output");
});

test("classifies explicit output-token truncation as invalid output", () => {
  assert.equal(
    classifyFailure("Response was truncated by its output-token limit (finish_reason=length, partial_chars=1200)"),
    "invalid_output"
  );
});

test("recommends constrained regeneration for truncated provider output", () => {
  const monitor = createSelfHealingMonitor({
    agentIds: ["blogging"],
    now: () => Date.parse("2026-11-17T18:00:00.000Z"),
    persistence: { configured: false }
  });
  const result = monitor.record("blogging", {
    success: false,
    error: "OpenRouter returned no usable text (finish_reason=length)"
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.lastErrorCategory, "invalid_output");
  assert.match(result.recoveryAction, /constrained regeneration/i);
});
