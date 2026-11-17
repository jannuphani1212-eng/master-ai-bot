const REPAIR_GUIDANCE = {
  authentication: {
    title: "Check provider credentials and permissions",
    diagnosis: "The recorded error indicates an authentication or authorization failure.",
    actions: [
      "Open the provider dashboard and verify that its API key is active and has the required permissions.",
      "Update the matching secret in Render environment variables if the key is invalid or rotated.",
      "Restart/redeploy only after the owner confirms the credential change."
    ]
  },
  rate_limit: {
    title: "Recover from provider quota or rate limits",
    diagnosis: "The recorded error indicates a quota, token limit, or rate-limit response.",
    actions: [
      "Keep the affected provider in cooldown and avoid repeated requests during the limit window.",
      "Allow the configured fallback chain to use the next available provider.",
      "Retry one small test request after the cooldown expires."
    ]
  },
  timeout: {
    title: "Investigate request timeout",
    diagnosis: "The recorded error indicates that the provider did not respond within the allowed time.",
    actions: [
      "Check Render application logs for the request timestamp and timeout details.",
      "Check the provider status page and current service availability.",
      "After service recovery, retry once through the normal provider fallback chain."
    ]
  },
  network: {
    title: "Investigate network connectivity",
    diagnosis: "The recorded error indicates a network, DNS, socket, or fetch failure.",
    actions: [
      "Check Render logs for DNS, socket, TLS, or connection errors.",
      "Check whether the affected provider endpoint is reachable and operational.",
      "Retry once after connectivity is restored; keep fallback enabled."
    ]
  },
  provider_outage: {
    title: "Use fallback while provider recovers",
    diagnosis: "The recorded error indicates a provider-side server error or outage.",
    actions: [
      "Check the provider status page for an incident.",
      "Keep the affected provider in cooldown and use the next available provider.",
      "Retry after the provider reports recovery."
    ]
  },
  invalid_output: {
    title: "Validate and regenerate invalid AI output",
    diagnosis: "The recorded error indicates malformed, incomplete, or unparseable AI output.",
    actions: [
      "Preserve the failed response/error in logs for review.",
      "Retry once with a constrained output format and explicit validation.",
      "If the second attempt fails, keep the task marked failed and request owner review."
    ]
  },
  unknown: {
    title: "Investigate an unclassified agent failure",
    diagnosis: "The recorded error does not match a known failure pattern; more log evidence is needed.",
    actions: [
      "Inspect Render application logs around the recorded failure time.",
      "Compare the failing request with the agent's configured instructions and provider response.",
      "Do not change code or secrets until the root cause is confirmed."
    ]
  }
};

export function buildRepairProposals(healthSnapshot = {}) {
  const degradedAgents = Array.isArray(healthSnapshot.agents)
    ? healthSnapshot.agents.filter(agent => agent && agent.status === "degraded")
    : [];

  return degradedAgents.map(agent => {
    const category = REPAIR_GUIDANCE[agent.lastErrorCategory]
      ? agent.lastErrorCategory
      : "unknown";
    const guidance = REPAIR_GUIDANCE[category];
    const failures = Math.max(1, Number(agent.consecutiveFailures) || 1);

    return {
      proposalId: agent.agentId + ":" + (agent.lastCheckedAt || "latest"),
      agentId: agent.agentId,
      status: "pending_owner_review",
      priority: failures >= 3 ? "high" : failures >= 2 ? "medium" : "low",
      failureCategory: category,
      diagnosis: guidance.diagnosis,
      observedError: String(agent.lastError || "No error details were recorded.").slice(0, 300),
      consecutiveFailures: failures,
      lastFailureAt: agent.lastFailureAt || agent.lastCheckedAt || null,
      title: guidance.title,
      proposedActions: [...guidance.actions],
      approvalRequired: true,
      safeToAutoExecute: false,
      executionEnabled: false,
      ownerDecision: "pending"
    };
  });
}
