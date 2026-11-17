import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentReadinessChecks, HEALTH_CHECK_INTERVAL_MS } from "../lib/agent-health-checks.js";

const agents = ["master", "affiliate", "youtube", "blogging", "app-development", "seo"].map(id => ({ id }));
const specialists = agents.filter(agent => agent.id !== "master");
const instructions = Object.fromEntries(agents.map(agent => [agent.id, "Valid role instructions"]));

test("checks all six agents without making provider calls", () => {
  const results = buildAgentReadinessChecks({
    agents, specialistAgents: specialists, agentInstructions: instructions,
    providers: [{ configured: true, coolingDown: false }],
    now: () => Date.parse("2026-11-17T12:00:00.000Z")
  });
  assert.equal(results.length, 6);
  assert.ok(results.every(result => result.success));
  assert.ok(results.every(result => result.checkType === "local_readiness"));
  assert.equal(results[0].checkedAt, "2026-11-17T12:00:00.000Z");
});

test("marks agents degraded when no provider is configured", () => {
  const results = buildAgentReadinessChecks({ agents, specialistAgents: specialists, agentInstructions: instructions, providers: [] });
  assert.ok(results.every(result => !result.success));
  assert.match(results[0].error, /No AI provider API key/);
});

test("marks agents degraded when all configured providers are cooling down", () => {
  const results = buildAgentReadinessChecks({
    agents, specialistAgents: specialists, agentInstructions: instructions,
    providers: [{ configured: true, coolingDown: true }, { configured: true, coolingDown: true }]
  });
  assert.ok(results.every(result => !result.success));
  assert.match(results[0].error, /cooling down/);
});

test("detects incomplete specialist instructions", () => {
  const broken = { ...instructions, seo: " " };
  const results = buildAgentReadinessChecks({
    agents, specialistAgents: specialists, agentInstructions: broken,
    providers: [{ configured: true, coolingDown: false }]
  });
  const seo = results.find(result => result.agentId === "seo");
  assert.equal(seo.success, false);
  assert.match(seo.error, /instructions/);
});

test("runs on a five-minute interval", () => {
  assert.equal(HEALTH_CHECK_INTERVAL_MS, 300000);
});
