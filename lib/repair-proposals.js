const GUIDANCE = {
  ai_provider: {
    authentication: ["Stop retrying the rejected provider.", "Ask the owner to verify the provider key and permissions in Render.", "After owner confirmation, run one small provider test."],
    rate_limit: ["Keep the provider in cooldown.", "Continue through the configured Gemini → Groq → OpenRouter fallback order.", "Retry one small request after the provider's retry window."],
    timeout: ["Inspect provider and Render logs for the request timestamp.", "Use the next available configured provider.", "Retry the affected provider only after a bounded cooldown."],
    network: ["Inspect DNS, TLS, socket and Render network logs.", "Use the next available provider.", "Retry after connectivity is confirmed."],
    provider_outage: ["Check the provider's service status.", "Keep fallback enabled while it recovers.", "Run one small test after recovery."],
    invalid_output: ["Preserve the failed response metadata.", "Retry once with a constrained output format.", "If it fails again, request owner review."]
  },
  specialist_execution: {
    execution_timeout: ["Reduce the task size and output budget.", "Retry the affected specialist once.", "If it times out again, inspect runtime logs before changing code."],
    invalid_execution_output: ["Validate the planner or specialist response against the required schema.", "Use deterministic specialist routing when planning output is invalid.", "Retain the invalid output for diagnosis; do not mark the task successful."],
    resource_exhaustion: ["Inspect Render memory and runtime logs.", "Reduce concurrent work and output size.", "Ask the owner to approve any instance or infrastructure change."],
    execution_error: ["Inspect the specialist's task, stack trace and execution logs.", "Reproduce with a small isolated task.", "Propose a code change only after confirming the root cause."]
  },
  report_quality: {
    missing_sections: ["Keep the original report unchanged as the recovery source.", "Run the bounded missing-section repair for the exact omitted headings.", "Re-score the repaired report; keep it in needs-review if any section remains missing."],
    empty_sections: ["Identify headings with empty bodies.", "Regenerate only those sections with concrete role-specific content.", "Re-score and retain owner review if sections remain empty."],
    evidence_gap: ["Mark unsupported claims as unverified.", "Request sources or measurements; never fabricate evidence.", "Keep factual accuracy separate from structural score."],
    quality_threshold: ["List the exact failed quality checks.", "Repair only the flagged sections.", "Re-run the structural reviewer."]
  }
};

export function buildRepairProposals(healthSnapshot = {}) {
  const degradedAgents = Array.isArray(healthSnapshot.agents)
    ? healthSnapshot.agents.filter(agent => agent && agent.status === "degraded")
    : [];
  return degradedAgents.map(agent => {
    const failureType = ["ai_provider", "specialist_execution", "report_quality"].includes(agent.lastFailureType)
      ? agent.lastFailureType : "ai_provider";
    const category = GUIDANCE[failureType]?.[agent.lastErrorCategory]
      ? agent.lastErrorCategory
      : failureType === "ai_provider" ? "invalid_output" :
        failureType === "specialist_execution" ? "execution_error" : "quality_threshold";
    const actions = GUIDANCE[failureType][category];
    const failures = Math.max(1, Number(agent.consecutiveFailures) || 1);
    const repeated = Math.max(1, Number(agent.failureHistoryCount) || 1);
    const priority = repeated >= 5 ? "critical" : repeated >= 3 ? "high" : repeated >= 2 ? "medium" : "low";
    return {
      proposalId: agent.agentId + ":" + failureType + ":" + category + ":" + (agent.lastCheckedAt || "latest"),
      agentId: agent.agentId,
      status: "pending_owner_review",
      priority,
      failureType,
      failureCategory: category,
      diagnosis: agent.rootCause || "The failure needs further log evidence.",
      observedError: String(agent.lastError || "No error details were recorded.").slice(0, 300),
      consecutiveFailures: failures,
      repeatedFailureCount: repeated,
      lastFailureAt: agent.lastFailureAt || agent.lastCheckedAt || null,
      title: failureType === "ai_provider" ? "Repair AI provider availability" :
        failureType === "specialist_execution" ? "Repair specialist execution" : "Repair specialist report quality",
      proposedActions: [...actions],
      approvalRequired: true,
      safeToAutoExecute: false,
      executionEnabled: false,
      ownerDecision: "pending"
    };
  });
}
