import test from "node:test";
import assert from "node:assert/strict";
import { createSelfHealingMonitor } from "../lib/self-healing.js";
import { buildRepairProposals } from "../lib/repair-proposals.js";

const noPersistence = { configured: false, restore: async () => ({}), save: async () => true };

test("separates provider, specialist execution and report-quality failures", () => {
  const monitor = createSelfHealingMonitor({ persistence: noPersistence });
  const provider = monitor.record("affiliate", { failureType: "ai_provider", error: "Groq HTTP 429: rate limit" });
  const execution = monitor.record("youtube", { failureType: "specialist_execution", error: "Planner returned invalid JSON" });
  const quality = monitor.record("blogging", { failureType: "report_quality", error: "Missing section: Research and evidence" });
  assert.equal(provider.lastFailureType, "ai_provider");
  assert.equal(provider.lastErrorCategory, "rate_limit");
  assert.equal(execution.lastFailureType, "specialist_execution");
  assert.equal(execution.lastErrorCategory, "invalid_execution_output");
  assert.equal(quality.lastFailureType, "report_quality");
  assert.equal(quality.lastErrorCategory, "missing_sections");
});

test("explains root cause and produces targeted repair actions", () => {
  const monitor = createSelfHealingMonitor({ persistence: noPersistence });
  monitor.record("blogging", { failureType: "report_quality", error: "Missing section: Research and evidence" });
  const proposal = buildRepairProposals(monitor.snapshot())[0];
  assert.match(proposal.diagnosis, /omitted/i);
  assert.ok(proposal.proposedActions.some(action => /missing-section repair/i.test(action)));
  assert.equal(proposal.approvalRequired, true);
  assert.equal(proposal.safeToAutoExecute, false);
  assert.equal(proposal.executionEnabled, false);
});

test("raises repair priority for repeated matching failures", () => {
  const monitor = createSelfHealingMonitor({ persistence: noPersistence });
  for (let i = 0; i < 3; i += 1) {
    monitor.record("seo", { failureType: "ai_provider", error: "Groq HTTP 429 rate limit" });
  }
  const proposal = buildRepairProposals(monitor.snapshot())[0];
  assert.equal(proposal.repeatedFailureCount, 3);
  assert.equal(proposal.priority, "high");
});

test("successful execution clears active failure state but preserves recent event history", () => {
  const monitor = createSelfHealingMonitor({ persistence: noPersistence });
  monitor.record("app-development", { failureType: "specialist_execution", error: "task crashed" });
  monitor.record("app-development", { success: true });
  const state = monitor.getAgent("app-development");
  assert.equal(state.status, "healthy");
  assert.equal(state.lastFailureType, null);
  assert.equal(monitor.snapshot().recentHistory.length, 2);
});
