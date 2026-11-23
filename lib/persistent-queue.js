const TABLE = "master_ai_job_queue";
const AGENTS = ["affiliate", "youtube", "blogging", "app-development", "seo"];

function config(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("Persistent queue needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return { url, key };
}

async function request(cfg, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(cfg.url + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: cfg.key,
      Authorization: "Bearer " + cfg.key,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error("Queue database request failed (" + response.status + "): " + String(raw).slice(0, 250));
  return data;
}

export function createPersistentQueue({ env = process.env, fetchImpl = fetch } = {}) {
  const cfg = config(env);
  async function enqueue(ownerId, items) {
    if (!ownerId || !Array.isArray(items) || !items.length) throw new Error("Owner and queue items are required.");
    const rows = items.map(item => ({
      owner_user_id: ownerId,
      agent_id: item.agentId,
      task: String(item.task || "").slice(0, 10000),
      idempotency_key: String(item.idempotencyKey || "").slice(0, 180),
      status: "pending",
      max_attempts: 4,
      payload: item.payload && typeof item.payload === "object" ? item.payload : {}
    }));
    if (rows.some(row => !AGENTS.includes(row.agent_id) || !row.task || !row.idempotency_key)) {
      throw new Error("Queue item has an invalid agent, task, or idempotency key.");
    }
    const saved = await request(cfg, TABLE + "?on_conflict=owner_user_id,idempotency_key", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(rows)
    }, fetchImpl);
    return { inserted: Array.isArray(saved) ? saved.length : 0, requested: rows.length };
  }
  async function claim(workerId) {
    const rows = await request(cfg, "rpc/claim_master_ai_job", {
      method: "POST",
      body: JSON.stringify({ p_worker_id: workerId })
    }, fetchImpl);
    return Array.isArray(rows) ? rows[0] || null : rows || null;
  }
  async function complete(jobId, workerId, result) {
    const rows = await request(cfg, TABLE + "?id=eq." + encodeURIComponent(jobId) + "&locked_by=eq." + encodeURIComponent(workerId) + "&status=eq.running", {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "completed", result: result || {}, finished_at: new Date().toISOString(), locked_at: null, locked_by: null, last_error: null })
    }, fetchImpl);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Queue completion lease was lost; job was not marked completed.");
    return true;
  }
  async function fail(job, workerId, error) {
    const message = String(error?.message || error || "Unknown worker failure").slice(0, 2000);
    const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, Number(job.attempts || 1) - 1)));
    const terminal = Number(job.attempts || 1) >= Number(job.max_attempts || 4);
    const rows = await request(cfg, TABLE + "?id=eq." + encodeURIComponent(job.id) + "&locked_by=eq." + encodeURIComponent(workerId) + "&status=eq.running", {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: terminal ? "failed" : "pending",
        next_run_at: terminal ? new Date().toISOString() : new Date(Date.now() + delaySeconds * 1000).toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: message,
        finished_at: terminal ? new Date().toISOString() : null
      })
    }, fetchImpl);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Queue failure update lost its lease.");
    return { terminal, retryInSeconds: terminal ? 0 : delaySeconds };
  }
  async function notify(ownerId, item) {\n    const row = { owner_user_id: ownerId, agent_id: item.agentId || null, notification_type: item.type || "agent_update", title: String(item.title || "Agent update").slice(0, 180), body: String(item.body || "").slice(0, 4000), metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {} };\n    await request(cfg, "master_ai_notifications", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }, fetchImpl);\n  }\n  async function notifications(ownerId) {\n    const rows = await request(cfg, "master_ai_notifications?select=id,agent_id,notification_type,title,body,metadata,read_at,created_at&owner_user_id=eq." + encodeURIComponent(ownerId) + "&order=created_at.desc&limit=100", {}, fetchImpl);\n    return Array.isArray(rows) ? rows : [];\n  }\n  async function markNotificationRead(ownerId, id) {\n    const rows = await request(cfg, "master_ai_notifications?id=eq." + encodeURIComponent(id) + "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&read_at=is.null", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ read_at: new Date().toISOString() }) }, fetchImpl);\n    return Array.isArray(rows) && rows.length === 1;\n  }\n  async function dailyResults(ownerId, dayKey) {\n    const rows = await request(cfg, TABLE + "?select=agent_id,status,result&owner_user_id=eq." + encodeURIComponent(ownerId) + "&idempotency_key=like.daily:" + encodeURIComponent(dayKey) + ":*&status=eq.completed&order=created_at.asc", {}, fetchImpl);\n    return Array.isArray(rows) ? rows : [];\n  }\n  async function status(ownerId) {
    const rows = await request(cfg, TABLE + "?select=status,agent_id,attempts,created_at,finished_at,last_error&owner_user_id=eq." + encodeURIComponent(ownerId) + "&order=created_at.desc&limit=100", {}, fetchImpl);
    return Array.isArray(rows) ? rows : [];
  }
  return { enqueue, claim, complete, fail, status, notify, notifications, markNotificationRead, dailyResults };
}

export const DAILY_AGENT_IDS = AGENTS;
