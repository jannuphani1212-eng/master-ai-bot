import { createSelfHealingPersistence } from "./self-healing-store.js";

const DEFAULT_AGENT_IDS = [
  "master", "affiliate", "youtube", "blogging", "app-development", "seo"
];
const MAX_HISTORY = 50;
const FAILURE_TYPES = new Set(["ai_provider", "specialist_execution", "report_quality"]);

function inferFailureType(message, requestedType) {
  if (FAILURE_TYPES.has(requestedType)) return requestedType;
  const value = String(message || "");
  if (/\b(?:Gemini|Groq|OpenRouter)\s*:/i.test(value) || /\b(?:provider|API key|HTTP 429|HTTP 5\d\d)\b/i.test(value)) return "ai_provider";
  if (/quality|missing section|structural report|needs_review|empty section/i.test(value)) return "report_quality";
  return "specialist_execution";
}

function classifyFailure(message, failureType = "ai_provider") {
  const value = String(message || "").toLowerCase();
  if (failureType === "report_quality") {
    if (/missing section|incomplete|omitted section/.test(value)) return "missing_sections";
    if (/empty|no substantive|blank/.test(value)) return "empty_sections";
    if (/evidence|unverified|unsupported|source/.test(value)) return "evidence_gap";
    return "quality_threshold";
  }
  if (failureType === "specialist_execution") {
    if (/timeout|timed out|aborterror|aborted/.test(value)) return "execution_timeout";
    if (/json|parse|syntax|invalid plan|no specialist/.test(value)) return "invalid_execution_output";
    if (/memory|heap|out of memory/.test(value)) return "resource_exhaustion";
    return "execution_error";
  }
  if (/401|403|unauthori[sz]ed|invalid api key|authentication/.test(value)) return "authentication";
  if (/429|quota|rate.?limit|tpm|resource exhausted/.test(value)) return "rate_limit";
  if (/timeout|timed out|aborterror|aborted/.test(value)) return "timeout";
  if (/network|fetch failed|econn|enotfound|socket/.test(value)) return "network";
  if (/500|502|503|504|unavailable|overloaded/.test(value)) return "provider_outage";
  if (/truncat|finish_reason\s*=\s*length|no usable text|output.?token|incomplete response|json|parse|unexpected token|syntax/.test(value)) return "invalid_output";
  return "unknown";
}

function diagnoseFailure(failureType, category, message) {
  const value = String(message || "").slice(0, 300);
  if (failureType === "report_quality") {
    const labels = {
      missing_sections: "The specialist omitted one or more required report sections.",
      empty_sections: "The report contains headings without meaningful section content.",
      evidence_gap: "The report does not clearly separate supported evidence from assumptions or unverified claims.",
      quality_threshold: "The report did not meet the structural quality checks."
    };
    return labels[category] || "The report failed a quality check.";
  }
  if (failureType === "specialist_execution") {
    const labels = {
      execution_timeout: "The specialist task did not finish within the allowed execution time.",
      invalid_execution_output: "The specialist or planner returned output that could not be parsed or used.",
      resource_exhaustion: "The specialist process appears to have exhausted an available runtime resource.",
      execution_error: "The specialist task failed outside a confirmed provider response."
    };
    return labels[category] || "The specialist execution failed.";
  }
  const labels = {
    authentication: "The AI provider rejected the configured credentials or permissions.",
    rate_limit: "The AI provider rejected the request because of quota or rate limits.",
    timeout: "The AI provider did not respond before the request timeout.",
    network: "The application could not establish a reliable connection to the AI provider.",
    provider_outage: "The AI provider returned a server-side or availability error.",
    invalid_output: "The AI provider returned empty, truncated, or unusable output."
  };
  return labels[category] || ("The AI provider failed; the exact cause needs log verification. " + value);
}

function recoveryFor(failureType, category) {
  if (failureType === "report_quality") {
    if (category === "missing_sections" || category === "empty_sections") return "Run the bounded missing-section repair, then re-score the completed report; retain the draft and request owner review if it still fails.";
    if (category === "evidence_gap") return "Request evidence labels and source details; do not invent facts, metrics, prices, or citations.";
    return "Revise only the flagged report sections and rerun structural checks.";
  }
  if (failureType === "specialist_execution") {
    if (category === "execution_timeout") return "Retry the specialist once with a smaller bounded task; if it times out again, retain the failure and request owner review.";
    if (category === "invalid_execution_output") return "Use deterministic routing or a constrained output format, validate it, and avoid repeating the same invalid plan.";
    if (category === "resource_exhaustion") return "Reduce task/output size and inspect runtime memory limits before retrying.";
    return "Inspect the specialist task, logs and runtime; do not change code automatically.";
  }
  switch (category) {
    case "authentication": return "Stop retrying this provider; ask the owner to verify its API key and permissions.";
    case "rate_limit": return "Respect the provider cooldown and continue through the next configured provider.";
    case "timeout":
    case "network":
    case "provider_outage": return "Use the next configured provider; retry the affected provider only after a bounded cooldown.";
    case "invalid_output": return "Request one constrained regeneration; if still invalid, retain the failed output for owner review.";
    default: return "Capture provider logs, avoid repeated retries, and request owner review if fallback also fails.";
  }
}

function decodeStoredCategory(value) {
  const raw = String(value || "");
  const split = raw.indexOf(":");
  if (split > 0 && FAILURE_TYPES.has(raw.slice(0, split))) {
    return { failureType: raw.slice(0, split), category: raw.slice(split + 1) || "unknown" };
  }
  return { failureType: "ai_provider", category: raw || "unknown" };
}

export function createSelfHealingMonitor({
  agentIds = DEFAULT_AGENT_IDS,
  now = () => Date.now(),
  maxHistory = MAX_HISTORY,
  persistence = createSelfHealingPersistence()
} = {}) {
  const states = new Map();
  const history = [];

  function emptyState(agentId) {
    return {
      agentId, status: "unknown", consecutiveFailures: 0, failureHistoryCount: 0,
      lastCheckedAt: null, lastSuccessAt: null, lastFailureAt: null,
      lastFailureType: null, lastErrorCategory: null, lastError: null,
      rootCause: null, recoveryAction: "No health check has been recorded yet."
    };
  }
  for (const id of agentIds) states.set(id, emptyState(id));

  function timestamp() { return new Date(now()).toISOString(); }
  function appendHistory(item) {
    history.push(item);
    if (history.length > maxHistory) history.splice(0, history.length - maxHistory);
  }

  function restore(snapshot = {}) {
    for (const saved of Array.isArray(snapshot.agents) ? snapshot.agents : []) {
      if (!saved || typeof saved.agentId !== "string") continue;
      const current = states.get(saved.agentId);
      if (!current) continue;
      const currentTime = current.lastCheckedAt ? Date.parse(current.lastCheckedAt) : 0;
      const savedTime = saved.lastCheckedAt ? Date.parse(saved.lastCheckedAt) : 0;
      if (currentTime > savedTime) continue;
      const decoded = decodeStoredCategory(saved.lastErrorCategory);
      const failureType = FAILURE_TYPES.has(saved.lastFailureType) ? saved.lastFailureType : decoded.failureType;
      const category = saved.lastErrorCategory ? decoded.category : null;
      const status = saved.status === "healthy" || saved.status === "degraded" ? saved.status : "unknown";
      states.set(saved.agentId, {
        ...current, ...saved, agentId: saved.agentId, status,
        lastFailureType: saved.lastFailureType || failureType,
        lastErrorCategory: category,
        rootCause: saved.rootCause || (category ? diagnoseFailure(failureType, category, saved.lastError) : null),
        consecutiveFailures: Math.max(0, Number(saved.consecutiveFailures) || 0),
        failureHistoryCount: Math.max(0, Number(saved.failureHistoryCount) || 0)
      });
    }
    if (history.length === 0) {
      for (const item of (Array.isArray(snapshot.recentHistory) ? snapshot.recentHistory : []).reverse()) {
        if (!item || !states.has(item.agentId)) continue;
        const decoded = decodeStoredCategory(item.category);
        appendHistory({
          agentId: item.agentId, success: item.success === true,
          checkedAt: item.checkedAt || null,
          failureType: item.failureType || decoded.failureType,
          category: item.category ? decoded.category : null
        });
      }
    }
  }

  function record(agentId, outcome = {}) {
    if (!states.has(agentId)) states.set(agentId, emptyState(agentId));
    const previous = states.get(agentId);
    const checkedAt = timestamp();
    let next;
    if (outcome.success === true) {
      next = {
        ...previous, status: "healthy", consecutiveFailures: 0,
        lastCheckedAt: checkedAt, lastSuccessAt: checkedAt,
        lastFailureType: null, lastErrorCategory: null, lastError: null,
        rootCause: null, recoveryAction: "No repair needed."
      };
      appendHistory({ agentId, success: true, checkedAt, failureType: null, category: null });
    } else {
      const error = String(outcome.error || "Unknown failure").slice(0, 300);
      const failureType = inferFailureType(error, outcome.failureType);
      const category = outcome.category || classifyFailure(error, failureType);
      const rootCause = outcome.rootCause || diagnoseFailure(failureType, category, error);
      const failureHistoryCount = history.filter(item =>
        item.agentId === agentId && item.success === false &&
        item.failureType === failureType && item.category === category
      ).length + 1;
      next = {
        ...previous, status: "degraded",
        consecutiveFailures: previous.consecutiveFailures + 1,
        failureHistoryCount, lastCheckedAt: checkedAt, lastFailureAt: checkedAt,
        lastFailureType: failureType, lastErrorCategory: category,
        lastError: error, rootCause,
        recoveryAction: recoveryFor(failureType, category)
      };
      appendHistory({ agentId, success: false, checkedAt, failureType, category });
    }
    states.set(agentId, next);
    if (persistence?.configured) void ready.then(() => persistence.save({ ...next })).catch(() => {});
    return { ...next };
  }

  const ready = persistence?.configured
    ? persistence.restore().then(data => { restore(data); return true; }).catch(() => false)
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
      overallStatus: agents.some(item => item.status === "degraded") ? "degraded" :
        agents.every(item => item.status === "healthy") ? "healthy" : "unknown",
      agents, recentHistory: history.map(item => ({ ...item })),
      persistence: persistence?.status ? persistence.status() : {
        enabled: false, connected: false, lastLoadedAt: null, lastError: null
      }
    };
  }
  return { record, getAgent, snapshot, restore, ready };
}

export { classifyFailure, diagnoseFailure, inferFailureType };
