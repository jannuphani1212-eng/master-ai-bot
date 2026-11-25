const TABLE = "master_ai_job_queue";
const AGENTS = ["affiliate", "youtube", "blogging", "app-development", "seo"];

function config(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
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
      priority: Number.isInteger(item.priority) ? Math.max(0, Math.min(1000, item.priority)) : 100,
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
  async function renew(jobId, workerId) {
    const rows = await request(cfg, TABLE + "?id=eq." + encodeURIComponent(jobId) +
      "&locked_by=eq." + encodeURIComponent(workerId) + "&status=eq.running", {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ locked_at: new Date().toISOString() })
      }, fetchImpl);
    return Array.isArray(rows) && rows.length === 1;
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
  async function notify(ownerId, item) {
    const row = { owner_user_id: ownerId, agent_id: item.agentId || null, notification_type: item.type || "agent_update", title: String(item.title || "Agent update").slice(0, 180), body: String(item.body || "").slice(0, 4000), metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {} };
    await request(cfg, "master_ai_notifications", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }, fetchImpl);
  }
  async function notifications(ownerId) {
    const rows = await request(cfg, "master_ai_notifications?select=id,agent_id,notification_type,title,body,metadata,read_at,created_at&owner_user_id=eq." + encodeURIComponent(ownerId) + "&order=created_at.desc&limit=100", {}, fetchImpl);
    return Array.isArray(rows) ? rows : [];
  }
  async function markNotificationRead(ownerId, id) {
    const rows = await request(cfg, "master_ai_notifications?id=eq." + encodeURIComponent(id) + "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&read_at=is.null", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ read_at: new Date().toISOString() }) }, fetchImpl);
    return Array.isArray(rows) && rows.length === 1;
  }
  async function saveBlogDraft(ownerId, jobId, draft) {
    const content = draft.content && typeof draft.content === "object" ? draft.content : { report: String(draft.report || "") };
    const articleText = String(content.article || "").trim();
    const wordCount = Number(content.wordCount || 0);
    if (articleText.length < 1800 || wordCount < 350) {
      throw new Error("Blog draft persistence rejected an incomplete article body.");
    }
    const body = {
      owner_user_id: ownerId,
      source_job_id: jobId,
      topic: String(draft.topic || "Daily article draft").slice(0, 180),
      language: ["English", "Telugu", "Bilingual"].includes(draft.language) ? draft.language : "English",
      audience: String(draft.audience || "India-focused readers").slice(0, 300),
      target_keyword: String(draft.targetKeyword || "").slice(0, 240),
      content_json: content,
      generation_provider: String(draft.provider || "unknown").slice(0, 120),
      status: "draft",
      updated_at: new Date().toISOString()
    };
    const existing = await request(cfg, "blog_drafts?select=id,topic,content_json,status&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&source_job_id=eq." + encodeURIComponent(jobId) + "&limit=1", {}, fetchImpl);
    if (Array.isArray(existing) && existing[0]?.id) {
      const prior = existing[0];
      if (prior.status !== "draft") {
        throw new Error("Existing blog draft has moved beyond draft status; refusing to overwrite owner-reviewed content.");
      }
      const priorContent = prior.content_json && typeof prior.content_json === "object" ? prior.content_json : {};
      if (String(priorContent.article || "").trim().length >= 1800 &&
          Number(priorContent.wordCount || 0) >= 350 &&
          priorContent.editorialReview?.status === "passed") {
        const verifiedExisting = await request(cfg, "blog_drafts?select=id,topic,content_json,status&owner_user_id=eq." +
          encodeURIComponent(ownerId) + "&id=eq." + encodeURIComponent(prior.id) + "&limit=1", {}, fetchImpl);
        if (!Array.isArray(verifiedExisting) || !verifiedExisting[0]?.id ||
            verifiedExisting[0].id !== prior.id ||
            String(verifiedExisting[0].content_json?.article || "").trim().length < 1800) {
          throw new Error("Existing blog draft could not be verified after lookup.");
        }
        return { id: prior.id, inserted: false, verified: true, updated: false };
      }
      const updated = await request(cfg, "blog_drafts?id=eq." + encodeURIComponent(prior.id) +
        "&owner_user_id=eq." + encodeURIComponent(ownerId), {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(body)
        }, fetchImpl);
      if (!Array.isArray(updated) || updated.length !== 1 || updated[0].id !== prior.id) {
        throw new Error("Incomplete existing blog draft could not be safely replaced.");
      }
      const verifiedUpdated = await request(cfg, "blog_drafts?select=id,topic,content_json,status&owner_user_id=eq." +
        encodeURIComponent(ownerId) + "&id=eq." + encodeURIComponent(prior.id) + "&limit=1", {}, fetchImpl);
      if (!Array.isArray(verifiedUpdated) || !verifiedUpdated[0]?.id ||
          verifiedUpdated[0].id !== prior.id ||
          String(verifiedUpdated[0].topic || "") !== body.topic ||
          String(verifiedUpdated[0].content_json?.article || "").trim() !== articleText ||
          Number(verifiedUpdated[0].content_json?.wordCount || 0) !== wordCount) {
        throw new Error("Replaced blog draft failed its full-content read-back verification.");
      }
      return { id: prior.id, inserted: false, verified: true, updated: true };
    }
    const rows = await request(cfg, "blog_drafts?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body)
    }, fetchImpl);
    if (!Array.isArray(rows) || !rows[0]?.id) throw new Error("Blog draft was not saved to persistent storage.");
    const verified = await request(cfg, "blog_drafts?select=id,topic,content_json,status&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&id=eq." + encodeURIComponent(rows[0].id) + "&limit=1", {}, fetchImpl);
    if (!Array.isArray(verified) || !verified[0]?.id ||
        verified[0].id !== rows[0].id ||
        String(verified[0].topic || "") !== body.topic ||
        String(verified[0].content_json?.article || "").trim() !== articleText ||
        Number(verified[0].content_json?.wordCount || 0) !== wordCount) {
      throw new Error("Blog draft insert returned an ID but full-content read-back verification failed.");
    }
    return { id: verified[0].id, inserted: true, verified: true, updated: false };
  }
  async function recentBlogTopics(ownerId, limit = 30) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 30));
    const rows = await request(cfg, "blog_drafts?select=id,topic,created_at,status&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&order=created_at.desc&limit=" + safeLimit, {}, fetchImpl);
    return Array.isArray(rows) ? rows : [];
  }
  async function saveAffiliateCampaign(ownerId, jobId, campaign) {
    const existing = await request(cfg, "affiliate_campaigns?select=id&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&source_job_id=eq." + encodeURIComponent(jobId) + "&limit=1", {}, fetchImpl);
    if (Array.isArray(existing) && existing[0]?.id) return { id: existing[0].id, inserted: false };
    const body = {
      owner_user_id: ownerId,
      source_job_id: jobId,
      product_name: String(campaign.productName || "Daily affiliate opportunity brief").slice(0, 180),
      category: String(campaign.category || "Research brief").slice(0, 80),
      commission_status: "not_provided",
      research_status: "needs_live_verification",
      content_json: campaign.content && typeof campaign.content === "object"
        ? campaign.content
        : { report: String(campaign.report || ""), productClaimsVerified: false },
      generation_provider: String(campaign.provider || "unknown").slice(0, 120),
      status: "draft",
      updated_at: new Date().toISOString()
    };
    const rows = await request(cfg, "affiliate_campaigns?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body)
    }, fetchImpl);
    if (!Array.isArray(rows) || !rows[0]?.id) throw new Error("Affiliate campaign research draft was not saved to persistent storage.");
    return { id: rows[0].id, inserted: true };
  }
  async function dailyResults(ownerId, dayKey) {
    const rows = await request(cfg, TABLE + "?select=agent_id,status,result,last_error&owner_user_id=eq." + encodeURIComponent(ownerId) + "&idempotency_key=like.daily:" + encodeURIComponent(dayKey) + ":*&order=created_at.asc", {}, fetchImpl);
    return Array.isArray(rows) ? rows : [];
  }
  async function status(ownerId) {
    const rows = await request(cfg, TABLE + "?select=status,agent_id,attempts,idempotency_key,next_run_at,created_at,finished_at,last_error&owner_user_id=eq." + encodeURIComponent(ownerId) + "&order=created_at.desc&limit=100", {}, fetchImpl);
    return Array.isArray(rows) ? rows : [];
  }
  return { enqueue, claim, renew, complete, fail, status, notify, notifications, markNotificationRead, dailyResults, recentBlogTopics, saveBlogDraft, saveAffiliateCampaign };
}

export const DAILY_AGENT_IDS = AGENTS;
