const ALLOWED_AGENTS = new Set(["master", "youtube", "affiliate", "blogging", "app-development", "seo"]);

function getConfig(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\\/+$/, "");
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) throw new Error("Persistent agent history is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.");
  return { url, serviceKey };
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

export function createAgentHistoryHandlers({ env = process.env, fetchImpl = fetch } = {}) {
  async function record(ownerId, item) {
    if (!ownerId || !ALLOWED_AGENTS.has(item?.agentId)) return false;
    const cfg = getConfig(env);
    const body = {
      owner_user_id: ownerId,
      agent_id: item.agentId,
      task: String(item.task || "Untitled task").slice(0, 10000),
      status: ["completed", "needs_attention", "failed"].includes(item.status) ? item.status : "failed",
      provider: item.provider ? String(item.provider).slice(0, 160) : null,
      quality_score: Number.isInteger(item.qualityScore) && item.qualityScore >= 0 && item.qualityScore <= 100 ? item.qualityScore : null,
      report: item.report ? String(item.report).slice(0, 30000) : null,
      error: item.error ? String(item.error).slice(0, 2000) : null,
      metadata: item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {}
    };
    const response = await fetchImpl(cfg.url + "/rest/v1/agent_task_history", {
      method: "POST",
      headers: {
        apikey: cfg.serviceKey,
        Authorization: "Bearer " + cfg.serviceKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("Could not persist agent task history (" + response.status + "): " + detail.slice(0, 180));
    }
    return true;
  }

  async function list(req, res) {
    try {
      const agentId = String(req.query?.agentId || "");
      if (agentId && !ALLOWED_AGENTS.has(agentId)) {
        return res.status(400).json({ success: false, error: "Invalid agent selected." });
      }
      const cfg = getConfig(env);
      const params = new URLSearchParams({
        select: "id,agent_id,task,status,provider,quality_score,report,error,created_at",
        owner_user_id: "eq." + req.ownerUser.id,
        order: "created_at.desc",
        limit: "100"
      });
      if (agentId) params.set("agent_id", "eq." + agentId);
      const response = await fetchImpl(cfg.url + "/rest/v1/agent_task_history?" + params.toString(), {
        headers: { apikey: cfg.serviceKey, Authorization: "Bearer " + cfg.serviceKey }
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error("Supabase history query failed (" + response.status + ").");
      const history = Array.isArray(data) ? data.map(row => ({
        id: row.id,
        agentId: row.agent_id,
        task: row.task,
        status: row.status === "completed" ? "Completed" : row.status === "needs_attention" ? "Needs attention" : "Failed",
        provider: row.provider || "Not reported",
        quality: row.quality_score,
        report: row.report || row.error || "",
        timestamp: row.created_at
      })) : [];
      return res.json({ success: true, history, source: "supabase", count: history.length });
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message || "Persistent history is unavailable." });
    }
  }

  return { list, record };
}
