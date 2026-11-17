import { createSelfHealingPersistence } from "./self-healing-store.js";

const DEFAULT_AGENT_IDS = [
  "master",
  "affiliate",
  "youtube",
  "blogging",
  "app-development",
  "seo"
];

const MAX_HISTORY = 50;

function classifyFailure(message) {
  const value = String(message || "").toLowerCase();

  if (/401|403|unauthori[sz]ed|invalid api key|authentication/.test(value)) return "authentication";
  if (/429|quota|rate.?limit|tpm|resource exhausted/.test(value)) return "rate_limit";
  if (/timeout|timed out|aborterror|aborted/.test(value)) return "timeout";
  if (/network|fetch failed|econn|enotfound|socket/.test(value)) return "network";
  if (/500|502|503|504|unavailable|overloaded/.test(value)) return "provider_outage";
  if (/json|parse|unexpected token|syntax/.test(value)) return "invalid_output";
  return "unknown";
}

function recoveryFor(category) {
  switch (category) {
    case "authentication":
      return "Stop retrying this provider; alert the owner to verify its API key and permissions.";
    case "rate_limit":
      return "Respect the provider cooldown and retry through the next configured provider.";
    case "timeout":
    case "network":
    case "provider_outage":
      return "Retry once with bounded backoff, then use the next configured provider.";
    case "invalid_output":
      return "Request one constrained regeneration; if still invalid, mark the task failed for owner review.";
    default:
      return "Capture the error, avoid repeated retries, and request owner review if the next safe attempt fails.";
  }
}

export function createSelfHealingMonitor({
  agentIds = DEFAULT_AGENT_IDS,
  now = () => Date.now(),
  maxHistory = MAX_HISTORY,
  persistence = createSelfHealingPersistence()
} = {}) {
  const states = new Map();
  const history = [];

  for (const id of agentIds) {
    states.set(id, {
      agentId: id,
      status: "unknown",
      consecutiveFailures: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCategory: null,
      lastError: null,
      recoveryAction: "No health check has been recorded yet."
    });
  }

  function timestamp() {
    return new Date(now()).toISOString();
  }

  function appendHistory(item) {
    history.push(item);
    if (history.length > maxHistory) history.splice(0, history.length - maxHistory);
  }

  function restore(snapshot = {}) {
    for (const saved of Array.isArray(snapshot.agents) ? snapshot.agents : []) {
      if (!saved || typeof saved.agentId !== "string") continue;
      const current = states.get(saved.agentId);
      if (!current) continue;

      // Never let a delayed database read overwrite a newer event recorded
      // by this running process.
      const currentTime = current.lastCheckedAt ? Date.parse(current.lastCheckedAt) : 0;
      const savedTime = saved.lastCheckedAt ? Date.parse(saved.lastCheckedAt) : 0;
      if (currentTime > savedTime) continue;

      const status = saved.status === "healthy" || saved.status === "degraded"
        ? saved.status
        : "unknown";
      states.set(saved.agentId, {
        ...current,
        ...saved,
        agentId: saved.agentId,
        status,
        consecutiveFailures: Math.max(0, Number(saved.consecutiveFailures) || 0)
      });
    }

    if (history.length === 0) {
      for (const item of (Array.isArray(snapshot.recentHistory) ? snapshot.recentHistory : []).reverse()) {
        if (!item || !states.has(item.agentId)) continue;
        appendHistory({
          agentId: item.agentId,
          success: item.success === true,
          checkedAt: item.checkedAt || null,
          category: item.category || null
        });
      }
    }
  }

  function record(agentId, outcome = {}) {
    if (!states.has(agentId)) {
      states.set(agentId, {
        agentId,
        status: "unknown",
        consecutiveFailures: 0,
        lastCheckedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastErrorCategory: null,
        lastError: null,
        recoveryAction: "No health check has been recorded yet."
      });
    }

    const previous = states.get(agentId);
    const checkedAt = timestamp();
    let next;

    if (outcome.success === true) {
      next = {
        ...previous,
        status: "healthy",
        consecutiveFailures: 0,
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt,
        lastErrorCategory: null,
        lastError: null,
        recoveryAction: "No repair needed."
      };
      appendHistory({ agentId, success: true, checkedAt, category: null });
    } else {
      const error = String(outcome.error || "Unknown failure").slice(0, 300);
      const category = classifyFailure(error);
      next = {
        ...previous,
        status: "degraded",
        consecutiveFailures: previous.consecutiveFailures + 1,
        lastCheckedAt: checkedAt,
        lastFailureAt: checkedAt,
        lastErrorCategory: category,
        lastError: error,
        recoveryAction: recoveryFor(category)
      };
      appendHistory({ agentId, success: false, checkedAt, category });
    }

    states.set(agentId, next);

    // Persistence is best-effort: database outages must never break AI work.
    if (persistence?.configured) {
      void ready.then(() => persistence.save({ ...next })).catch(() => {});
    }

    return { ...next };
  }

  const ready = persistence?.configured
    ? persistence.restore().then(data => {
        restore(data);
        return true;
      }).catch(() => false)
    : Promise.resolve(false);

  function getAgent(agentId) {
    const value = states.get(agentId);
    return value ? { ...value } : null;
  }

  function snapshot() {
    const agents = [...states.values()].map(item => ({ ...item }));
    return {
      monitoredAgents: agents.length,
      healthy: agents.filter(item => item.status === "healthy").length,
      degraded: agents.filter(item => item.status === "degraded").length,
      unknown: agents.filter(item => item.status === "unknown").length,
      overallStatus: agents.some(item => item.status === "degraded")
        ? "degraded"
        : agents.every(item => item.status === "healthy")
          ? "healthy"
          : "unknown",
      agents,
      recentHistory: history.map(item => ({ ...item })),
      persistence: persistence?.status ? persistence.status() : {
        enabled: false,
        connected: false,
        lastLoadedAt: null,
        lastError: null
      }
    };
  }

  return { record, getAgent, snapshot, restore, ready };
}

export { classifyFailure };
