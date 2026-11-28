const TABLE = "master_ai_job_queue";
const AGENTS = ["affiliate", "youtube", "blogging", "app-development", "seo"];

function normalizeBlogTopic(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}


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
  async function recoverExpired(jobId, staleMinutes = 2) {
    const staleBefore = new Date(Date.now() - Math.max(1, Math.min(10, Number(staleMinutes) || 2)) * 60 * 1000).toISOString();
    const filter = TABLE + "?id=eq." + encodeURIComponent(jobId) +
      "&status=eq.running&locked_at=lt." + encodeURIComponent(staleBefore);
    const current = await request(cfg, filter + "&select=attempts,max_attempts", {}, fetchImpl);
    if (!Array.isArray(current) || current.length !== 1) return { recovered: false, status: null };
    const attempts = Number(current[0].attempts || 0);
    const maxAttempts = Number(current[0].max_attempts || 4);
    const finalAttempt = attempts >= maxAttempts;
    const now = new Date().toISOString();
    const rows = await request(cfg, filter + "&attempts=eq." + encodeURIComponent(String(current[0].attempts)), {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: finalAttempt ? "failed" : "pending",
        next_run_at: now,
        finished_at: finalAttempt ? now : null,
        locked_at: null,
        locked_by: null,
        last_error: finalAttempt
          ? "Worker lease expired on the final attempt; marked failed so a fresh recovery job can be queued."
          : "Recovered after the worker lease expired during service restart."
      })
    }, fetchImpl);
    if (!Array.isArray(rows) || rows.length !== 1) return { recovered: false, status: null };
    return { recovered: true, status: finalAttempt ? "failed" : "pending" };
  }
  async function finalizeExhaustedPending(jobId) {
    const filter = TABLE + "?id=eq." + encodeURIComponent(jobId) + "&status=eq.pending";
    const current = await request(cfg, filter + "&select=attempts,max_attempts", {}, fetchImpl);
    if (!Array.isArray(current) || current.length !== 1 ||
        Number(current[0].attempts || 0) < Number(current[0].max_attempts || 4)) {
      return { finalized: false, status: null };
    }
    const now = new Date().toISOString();
    const rows = await request(cfg, filter + "&attempts=eq." + encodeURIComponent(String(current[0].attempts)), {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "failed",
        finished_at: now,
        locked_at: null,
        locked_by: null,
        last_error: "Pending job had exhausted all attempts; marked failed so a fresh recovery job can be queued."
      })
    }, fetchImpl);
    if (!Array.isArray(rows) || rows.length !== 1) return { finalized: false, status: null };
    return { finalized: true, status: "failed" };
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
  async function checkpoint(jobId, workerId, result) {
    const safeResult = result && typeof result === "object" ? result : {};
    const rows = await request(cfg, TABLE + "?id=eq." + encodeURIComponent(jobId) +
      "&locked_by=eq." + encodeURIComponent(workerId) + "&status=eq.running", {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ result: safeResult })
      }, fetchImpl);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Queue checkpoint lease was lost; diagnostic output was not saved.");
    return true;
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
    // Provider-wide daily quota exhaustion and deterministic output truncation
    // will not recover by repeating the same request. Stop this job immediately
    // so the worker does not burn retries or send misleading retry notifications.
    const providerQuotaBlocked =
      /tokens per day|\bTPD\b|daily (?:token|request|quota)|free[_ -]?tier.{0,80}(?:requests|quota)|quota exceeded.*(?:daily|per day)|(?:daily|per day).*quota/i.test(message);
    const outputTruncated =
      /response was truncated by its output-token limit|finish_reason\s*=\s*length/i.test(message);
    const nonRetryable = error?.nonRetryable === true;
    const terminal = Number(job.attempts || 1) >= Number(job.max_attempts || 4) || providerQuotaBlocked || outputTruncated || nonRetryable;
    const blocked = providerQuotaBlocked;
    const nextStatus = blocked ? "blocked" : terminal ? "failed" : "pending";
    const rows = await request(cfg, TABLE + "?id=eq." + encodeURIComponent(job.id) + "&locked_by=eq." + encodeURIComponent(workerId) + "&status=eq.running", {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: nextStatus,
        next_run_at: blocked
          ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          : terminal ? new Date().toISOString() : new Date(Date.now() + delaySeconds * 1000).toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: message,
        finished_at: terminal ? new Date().toISOString() : null
      })
    }, fetchImpl);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Queue failure update lost its lease.");
    return { terminal, blocked, status: nextStatus, retryInSeconds: blocked ? 86400 : terminal ? 0 : delaySeconds };
  }
  async function requeueDueBlocked(ownerId, now = new Date()) {
    if (!ownerId) throw new Error("Owner is required to requeue blocked jobs.");
    const dueAt = new Date(now).toISOString();
    const filter = TABLE + "?owner_user_id=eq." + encodeURIComponent(ownerId) +
      "&status=eq.blocked&next_run_at=lte." + encodeURIComponent(dueAt) +
      "&select=id,agent_id,attempts,max_attempts,idempotency_key";
    const dueJobs = await request(cfg, filter, {}, fetchImpl);
    if (!Array.isArray(dueJobs) || !dueJobs.length) return [];
    const requeued = [];
    for (const job of dueJobs) {
      const attempts = Math.max(0, Number(job.attempts) || 0);
      const maxAttempts = Math.max(1, Number(job.max_attempts) || 4);
      const exhausted = attempts >= maxAttempts;
      const rowFilter = TABLE + "?id=eq." + encodeURIComponent(job.id) +
        "&owner_user_id=eq." + encodeURIComponent(ownerId) +
        "&status=eq.blocked&next_run_at=lte." + encodeURIComponent(dueAt) +
        "&attempts=eq." + encodeURIComponent(String(attempts)) +
        "&max_attempts=eq." + encodeURIComponent(String(maxAttempts));
      const updated = await request(cfg, rowFilter, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(exhausted ? {
          status: "failed",
          next_run_at: dueAt,
          finished_at: dueAt,
          locked_at: null,
          locked_by: null,
          last_error: "Provider quota cooldown elapsed after all attempts were used; marked failed instead of requeuing an unclaimable job."
        } : {
          status: "pending",
          next_run_at: dueAt,
          finished_at: null,
          locked_at: null,
          locked_by: null,
          last_error: "Provider quota cooldown elapsed; safely requeued for one bounded retry."
        })
      }, fetchImpl);
      if (!Array.isArray(updated) || updated.length !== 1) continue;
      requeued.push(updated[0]);
    }
    return requeued;
  }
  async function notify(ownerId, item) {
    const row = { owner_user_id: ownerId, agent_id: item.agentId || null, notification_type: item.type || "agent_update", title: String(item.title || "Agent update").slice(0, 180), body: String(item.body || "").slice(0, 4000), metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {} };
    await request(cfg, "master_ai_notifications", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) }, fetchImpl);
  }
  async function upsertDailyReport(ownerId, report) {
    const existing = await request(cfg, "master_ai_notifications?select=id&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&notification_type=eq.daily_report&title=eq." +
      encodeURIComponent(String(report.title || "")) + "&order=created_at.desc&limit=1", {}, fetchImpl);
    if (Array.isArray(existing) && existing[0]?.id) {
      const updated = await request(cfg, "master_ai_notifications?id=eq." +
        encodeURIComponent(existing[0].id) + "&owner_user_id=eq." + encodeURIComponent(ownerId), {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ body: String(report.body || "").slice(0, 4000), metadata: report.metadata || {} })
      }, fetchImpl);
      if (!Array.isArray(updated) || updated.length !== 1 || updated[0].id !== existing[0].id) {
        throw new Error("Existing daily Master AI report could not be updated safely.");
      }
      return { id: existing[0].id, updated: true };
    }
    await notify(ownerId, {
      agentId: "master",
      type: "daily_report",
      title: report.title,
      body: report.body,
      metadata: report.metadata
    });
    return { id: null, updated: false };
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
    const dayKey = String(content.dayKey || "").trim().slice(0, 10);
    if (dayKey) {
      const sameDay = await request(cfg, "blog_drafts?select=id,topic,content_json,status,created_at&owner_user_id=eq." +
        encodeURIComponent(ownerId) + "&content_json->>dayKey=eq." + encodeURIComponent(dayKey) +
        "&order=created_at.asc&limit=100", {}, fetchImpl);
      const topicKey = normalizeBlogTopic(body.topic);
      const duplicates = (Array.isArray(sameDay) ? sameDay : [])
        .filter(row => normalizeBlogTopic(row.topic) === topicKey)
        .sort((a, b) => Number(b.content_json?.editorialReview?.score || 0) - Number(a.content_json?.editorialReview?.score || 0) ||
          String(a.created_at || "").localeCompare(String(b.created_at || "")));
      if (duplicates.length) {
        const priorDaily = duplicates[0];
        if (priorDaily.status !== "draft") {
          throw new Error("A same-day article with this topic has moved beyond draft status; refusing to create a duplicate.");
        }
        const priorScore = Number(priorDaily.content_json?.editorialReview?.score || 0);
        const newScore = Number(content.editorialReview?.score || 0);
        const priorPassed = priorDaily.content_json?.editorialReview?.status === "passed";
        if (priorPassed || priorScore >= newScore) {
          const verifiedDaily = await request(cfg, "blog_drafts?select=id,topic,content_json,status&owner_user_id=eq." +
            encodeURIComponent(ownerId) + "&id=eq." + encodeURIComponent(priorDaily.id) + "&limit=1", {}, fetchImpl);
          if (!Array.isArray(verifiedDaily) || verifiedDaily.length !== 1 ||
              verifiedDaily[0].id !== priorDaily.id ||
              String(verifiedDaily[0].content_json?.article || "").trim().length < 1800) {
            throw new Error("Existing same-day blog draft could not be verified after duplicate lookup.");
          }
          return { id: priorDaily.id, inserted: false, verified: true, updated: false, deduplicated: true };
        }
        const replacement = await request(cfg, "blog_drafts?id=eq." + encodeURIComponent(priorDaily.id) +
          "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&status=eq.draft", {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify(body)
          }, fetchImpl);
        if (!Array.isArray(replacement) || replacement.length !== 1 || replacement[0].id !== priorDaily.id) {
          throw new Error("Better same-day blog draft could not safely replace the lower-scored private draft.");
        }
        const verifiedReplacement = await request(cfg, "blog_drafts?select=id,topic,content_json,status&owner_user_id=eq." +
          encodeURIComponent(ownerId) + "&id=eq." + encodeURIComponent(priorDaily.id) + "&limit=1", {}, fetchImpl);
        if (!Array.isArray(verifiedReplacement) || verifiedReplacement.length !== 1 ||
            verifiedReplacement[0].id !== priorDaily.id ||
            String(verifiedReplacement[0].topic || "") !== body.topic ||
            String(verifiedReplacement[0].content_json?.article || "").trim() !== articleText ||
            Number(verifiedReplacement[0].content_json?.wordCount || 0) !== wordCount) {
          throw new Error("Updated same-day blog draft failed full-content read-back verification.");
        }
        return { id: priorDaily.id, inserted: false, verified: true, updated: true, deduplicated: true };
      }
    }
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
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 200));
    const rows = await request(cfg, "blog_drafts?select=id,topic,content_json,created_at,status&owner_user_id=eq." +
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
    const rows = await request(cfg, TABLE + "?select=agent_id,status,result,last_error,idempotency_key&owner_user_id=eq." + encodeURIComponent(ownerId) + "&idempotency_key=like.daily:" + encodeURIComponent(dayKey) + ":*&order=created_at.asc", {}, fetchImpl);
    const expectedKeys = new Set(AGENTS.map(agentId => "daily:" + dayKey + ":" + agentId));
    return Array.isArray(rows) ? rows.filter(row => expectedKeys.has(row.idempotency_key)) : [];
  }
  async function status(ownerId) {
    const rows = await request(cfg, TABLE + "?select=id,status,agent_id,attempts,max_attempts,idempotency_key,next_run_at,locked_at,locked_by,created_at,finished_at,last_error&owner_user_id=eq." + encodeURIComponent(ownerId) + "&order=created_at.desc&limit=100", {}, fetchImpl);
    return Array.isArray(rows) ? rows : [];
  }
  return { enqueue, claim, renew, recoverExpired, finalizeExhaustedPending, checkpoint, complete, fail, requeueDueBlocked, status, notify, notifications, upsertDailyReport, markNotificationRead, dailyResults, recentBlogTopics, saveBlogDraft, saveAffiliateCampaign };
}

export const DAILY_AGENT_IDS = AGENTS;
