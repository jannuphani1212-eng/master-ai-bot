const TABLE = "self_healing_events";
const AGENT_IDS = new Set([
  "master",
  "affiliate",
  "youtube",
  "blogging",
  "app-development",
  "seo"
]);

function getConfig(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const ownerUserId = String(env.SUPABASE_OWNER_USER_ID || "").trim();
  const validOwnerId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerUserId);
  if (!url || !serviceKey || !validOwnerId) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return null;
  } catch {
    return null;
  }
  return { url, serviceKey, ownerUserId };
}

async function parseResponse(response) {
  const body = await response.text();
  if (!body) return null;
  try { return JSON.parse(body); } catch { return body; }
}

export function createSelfHealingPersistence({
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date().toISOString()
} = {}) {
  const config = getConfig(env);
  let lastError = null;
  let lastLoadedAt = null;

  async function request(path, options = {}) {
    if (!config) throw new Error("Self-healing persistence is not configured.");
    const response = await fetchImpl(config.url + "/rest/v1/" + path, {
      ...options,
      headers: {
        apikey: config.serviceKey,
        Authorization: "Bearer " + config.serviceKey,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const data = await parseResponse(response);
    if (!response.ok) {
      const detail = typeof data === "string" ? data : JSON.stringify(data || {});
      throw new Error("Supabase self-healing storage HTTP " + response.status + ": " + detail.slice(0, 300));
    }
    return data;
  }

  async function restore() {
    if (!config) return { agents: [], recentHistory: [] };
    try {
      const query = TABLE +
        "?select=agent_id,status,consecutive_failures,checked_at,last_success_at,last_failure_at,error_category,error_message,recovery_action" +
        "&owner_user_id=eq." + encodeURIComponent(config.ownerUserId) +
        "&order=checked_at.desc&limit=50";
      const rows = await request(query);
      const agentsById = new Map();
      const recentHistory = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!AGENT_IDS.has(row.agent_id)) continue;
        if (!agentsById.has(row.agent_id)) {
          agentsById.set(row.agent_id, {
            agentId: row.agent_id,
            status: row.status,
            consecutiveFailures: Number(row.consecutive_failures || 0),
            lastCheckedAt: row.checked_at || null,
            lastSuccessAt: row.last_success_at || null,
            lastFailureAt: row.last_failure_at || null,
            lastErrorCategory: row.error_category || null,
            lastError: row.error_message || null,
            recoveryAction: row.recovery_action || "Review the latest recorded health event."
          });
        }
        recentHistory.push({
          agentId: row.agent_id,
          success: row.status === "healthy",
          checkedAt: row.checked_at || null,
          category: row.error_category || null
        });
      }
      lastLoadedAt = now();
      lastError = null;
      return { agents: [...agentsById.values()], recentHistory };
    } catch (error) {
      lastError = String(error.message || "Supabase restore failed").slice(0, 300);
      throw error;
    }
  }

  async function save(state) {
    if (!config) return false;
    const row = {
      owner_user_id: config.ownerUserId,
      agent_id: state.agentId,
      status: state.status,
      consecutive_failures: state.consecutiveFailures,
      checked_at: state.lastCheckedAt || now(),
      last_success_at: state.lastSuccessAt,
      last_failure_at: state.lastFailureAt,
      error_category: state.lastFailureType && state.lastErrorCategory
        ? state.lastFailureType + ":" + state.lastErrorCategory
        : state.lastErrorCategory,
      error_message: state.lastError,
      recovery_action: state.recoveryAction || ""
    };
    try {
      await request(TABLE, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(row)
      });
      lastError = null;
      return true;
    } catch (error) {
      lastError = String(error.message || "Supabase save failed").slice(0, 300);
      throw error;
    }
  }

  function status() {
    return {
      enabled: Boolean(config),
      connected: Boolean(config) && lastError === null && lastLoadedAt !== null,
      lastLoadedAt,
      lastError
    };
  }

  return { configured: Boolean(config), restore, save, status };
}
