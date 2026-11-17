import test from "node:test";
import assert from "node:assert/strict";
import { buildRepairProposals } from "../lib/repair-proposals.js";

test("returns no repair proposals when all agents are healthy", () => {
  const result = buildRepairProposals({ agents: [{ agentId: "seo", status: "healthy" }] });
  assert.deepEqual(result, []);
});

test("creates a specific owner-gated proposal for a rate limit failure", () => {
  const [proposal] = buildRepairProposals({
    agents: [{
      agentId: "affiliate",
      status: "degraded",
      consecutiveFailures: 2,
      lastErrorCategory: "rate_limit",
      lastError: "HTTP 429 quota exhausted",
      lastFailureAt: "2026-11-17T08:00:00.000Z"
    }]
  });
  assert.equal(proposal.agentId, "affiliate");
  assert.equal(proposal.priority, "medium");
  assert.equal(proposal.failureCategory, "rate_limit");
  assert.match(proposal.diagnosis, /quota|rate-limit/i);
  assert.equal(proposal.approvalRequired, true);
  assert.equal(proposal.safeToAutoExecute, false);
  assert.equal(proposal.executionEnabled, false);
  assert.equal(proposal.ownerDecision, "pending");
  assert.ok(proposal.proposedActions.length >= 2);
});

test("uses cautious unknown guidance and high priority after repeated failures", () => {
  const [proposal] = buildRepairProposals({
    agents: [{
      agentId: "youtube",
      status: "degraded",
      consecutiveFailures: 4,
      lastErrorCategory: "unexpected",
      lastError: "Unclassified exception"
    }]
  });
  assert.equal(proposal.priority, "high");
  assert.equal(proposal.failureCategory, "unknown");
  assert.match(proposal.title, /unclassified/i);
  assert.match(proposal.proposedActions[0], /logs/i);
});

test("ignores healthy, unknown, and malformed agent entries", () => {
  const result = buildRepairProposals({
    agents: [null, {}, { agentId: "master", status: "unknown" }, { agentId: "seo", status: "healthy" }]
  });
  assert.deepEqual(result, []);
});
