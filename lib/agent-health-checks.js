const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Inexpensive local-readiness checks. These intentionally do not call paid AI
 * APIs; they verify agent registration, instructions, and provider availability.
 */
export function buildAgentReadinessChecks({
  agents = [], specialistAgents = [], agentInstructions = {}, providers = [],
  now = () => Date.now()
} = {}) {
  const configuredProviders = providers.filter(provider => provider.configured);
  const usableProviders = configuredProviders.filter(provider => !provider.coolingDown);
  const timestamp = new Date(now()).toISOString();

  return agents.map(agent => {
    const hasInstructions = typeof agentInstructions[agent.id] === "string" &&
      agentInstructions[agent.id].trim().length > 0;
    const isMaster = agent.id === "master";
    const roleReady = isMaster
      ? specialistAgents.length === 5 && hasInstructions
      : hasInstructions && specialistAgents.some(item => item.id === agent.id);
    const providerReady = usableProviders.length > 0;
    const problems = [];

    if (!roleReady) problems.push("Agent registration or instructions are incomplete.");
    if (configuredProviders.length === 0) problems.push("No AI provider API key is configured.");
    else if (!providerReady) problems.push("All configured AI providers are currently cooling down.");

    return {
      agentId: agent.id,
      checkedAt: timestamp,
      success: roleReady && providerReady,
      error: problems.length ? problems.join(" ") : null,
      checkType: "local_readiness"
    };
  });
}

export const HEALTH_CHECK_INTERVAL_MS = DEFAULT_INTERVAL_MS;
