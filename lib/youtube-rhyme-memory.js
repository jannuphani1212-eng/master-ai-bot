const STATUSES = new Set(["planning", "generating", "cooldown", "ready_for_review", "complete", "paused", "needs_attention"]);
const COOLDOWNS = new Set(["not_waiting", "cooling_down", "ready", "unknown"]);

function config(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("YouTube rhyme memory is not configured. Check the server-side Supabase settings.");
  return { url, key };
}
async function json(response) { try { return await response.json(); } catch { return null; } }
function asArray(value) { return Array.isArray(value) ? value.slice(0, 100) : []; }
function asObject(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function cleanText(value, max = 20000) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function asContinuity(value) {
  if (typeof value === "string" && value.trim()) return { description: cleanText(value, 4000) };
  return asObject(value);
}
function extractScriptFromReport(report) {
  const heading = /^#{1,4}\s+(?:[0-9]+(?:\.[0-9]+)*\s*)?(?:(?:complete|full|original)\s+)?(?:rhyme\s+)?(?:script|lyrics)\b[^\n]*\n/im;
  const match = heading.exec(report);
  if (!match) return "";
  const rest = report.slice(match.index + match[0].length);
  const endMatch = /^(?:#{1,4}\s+|---\s*$)/m.exec(rest);
  return cleanText(endMatch ? rest.slice(0, endMatch.index) : rest, 30000);
}

function normalizeState(input = {}) {
  const totalScenes = Number.isInteger(input.totalScenes ?? input.total_scenes) ? Math.max(0, Math.min(100, input.totalScenes ?? input.total_scenes)) : 0;
  const completedScenes = asArray(input.completedScenes ?? input.completed_scenes);
  const remainingScenes = asArray(input.remainingScenes ?? input.remaining_scenes);
  const nextScene = Number.isInteger((input.nextScene ?? input.next_scene)) && (input.nextScene ?? input.next_scene) >= 1 && (input.nextScene ?? input.next_scene) <= 100 ? (input.nextScene ?? input.next_scene) : null;
  const cooldownStatus = COOLDOWNS.has((input.cooldownStatus ?? input.cooldown_status) ?? input.cooldown_status) ? (input.cooldownStatus ?? input.cooldown_status) : "unknown";
  const productionStatus = STATUSES.has((input.productionStatus ?? input.production_status) ?? input.production_status) ? (input.productionStatus ?? input.production_status) : "planning";
  const retryValue = input.retryAt ?? input.retry_at;
  const retryAt = typeof retryValue === "string" && !Number.isNaN(Date.parse(retryValue)) ? new Date(retryValue).toISOString() : null;
  return {
    rhyme_title: cleanText(input.rhymeTitle || input.rhyme_title, 180),
    script: cleanText(input.script, 30000),
    total_scenes: totalScenes,
    completed_scenes: completedScenes,
    remaining_scenes: remainingScenes,
    character_continuity: asObject(input.characterContinuity || input.character_continuity),
    background_continuity: asObject(input.backgroundContinuity || input.background_continuity),
    last_generated_clip: asObject(input.lastGeneratedClip || input.last_generated_clip),
    next_scene: nextScene,
    cooldown_status: cooldownStatus,
    retry_at: retryAt,
    failed_clips: asArray(input.failedClips || input.failed_clips),
    retry_attempts: Number.isInteger((input.retryAttempts ?? input.retry_attempts)) ? Math.max(0, Math.min(1000, input.retryAttempts ?? input.retry_attempts)) : 0,
    production_status: productionStatus
  };
}

function extractSection(report, labels) {
  const headings = [...report.matchAll(/^#{1,4}\\s+(.+)$/gim)];
  const labelPattern = new RegExp("^(?:" + labels.join("|") + ")\\\\b", "i");
  const match = headings.find(item => {
    const heading = item[1].replace(/^\\d+(?:\\.\\d+)*\\s*/, "").trim();
    return labelPattern.test(heading);
  });
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = report.slice(start);
  const nextHeading = /^#{1,4}\\s+/m.exec(rest);
  return cleanText(nextHeading ? rest.slice(0, nextHeading.index) : rest, 8000);
}

function extractTitleFromReport(report) {
  const explicit = report.match(/^\s*(?:rhyme\s+title|title)\s*:\s*["“]?([^\n"”]+)["”]?/im);
  if (explicit) return cleanText(explicit[1], 180);
  const headings = [...report.matchAll(/^#\s+(.+)$/gm)];
  for (const item of headings) {
    const title = cleanText(item[1].replace(/^\d+[.)]\s*/, ""), 180);
    if (title && !/^(?:youtube|specialist report|production plan|complete rhyme production plan)$/i.test(title)) return title;
  }
  return "";
}

export function extractRhymeProductionState(report) {
  if (typeof report !== "string") return null;
  const match = report.match(/<RHYME_PRODUCTION_STATE>\s*([\s\S]*?)\s*<\/RHYME_PRODUCTION_STATE>/i);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      const state = normalizeState(parsed);
      if (!state.script || /complete script as above|script as above|insert (?:the )?(?:full )?script|placeholder/i.test(state.script)) {
        state.script = extractScriptFromReport(report);
      }
      state.character_continuity = asContinuity(parsed.characterContinuity !== undefined ? parsed.characterContinuity : parsed.character_continuity);
      state.background_continuity = asContinuity(parsed.backgroundContinuity !== undefined ? parsed.backgroundContinuity : parsed.background_continuity);
      if (state.rhyme_title && state.script.length >= 8 && state.total_scenes > 0) return state;
    } catch { /* Fall through to conservative report extraction. */ }
  }

  // Fallback for providers that return the complete human-readable production
  // plan but omit the machine-readable state block. Only persist when title,
  // full lyrics, and at least one explicitly numbered scene are present.
  const script = extractScriptFromReport(report);
  const sceneNumbers = [...report.matchAll(/^\s*(?:#{1,5}\s*)?(?:scene|video scene)\s*#?0*(\d+)\b/gim)]
    .map(item => Number(item[1])).filter(n => Number.isInteger(n) && n > 0 && n <= 100);
  const totalScenes = sceneNumbers.length ? Math.max(...sceneNumbers) : 0;
  const rhymeTitle = extractTitleFromReport(report);
  if (!rhymeTitle || script.length < 80 || totalScenes < 1) return null;
  const characterText = extractSection(report, ["character(?:s)?(?:\\s+continuity)?", "character\\s+design"]);
  const backgroundText = extractSection(report, ["background(?:s)?(?:\\s+continuity)?", "environment\\s+design"]);
  return normalizeState({
    rhyme_title: rhymeTitle,
    script,
    total_scenes: totalScenes,
    completed_scenes: [],
    remaining_scenes: Array.from({ length: totalScenes }, (_, index) => index + 1),
    next_scene: 1,
    cooldown_status: "not_waiting",
    production_status: "planning",
    character_continuity: characterText ? { description: characterText } : {},
    background_continuity: backgroundText ? { description: backgroundText } : {}
  });
}

export function createYoutubeRhymeMemory({ env = process.env, fetchImpl = fetch } = {}) {
  async function request(path, options = {}) {
    const cfg = config(env);
    const response = await fetchImpl(cfg.url + "/rest/v1/" + path, {
      ...options,
      headers: {
        apikey: cfg.key,
        Authorization: "Bearer " + cfg.key,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("YouTube rhyme memory request failed (" + response.status + "): " + detail.slice(0, 180));
    }
    if (response.status === 204) return null;
    return await json(response);
  }

  async function list(ownerId, channelId) {
    if (!ownerId) throw new Error("Owner authentication is required.");
    const query = "youtube_rhyme_projects?select=*&owner_user_id=eq." + encodeURIComponent(ownerId) +
      (channelId ? "&channel_id=eq." + encodeURIComponent(channelId) : "") +
      "&order=updated_at.desc&limit=30";
    return await request(query) || [];
  }

  async function getActive(ownerId, channelId) {
    const projects = await list(ownerId, channelId);
    return projects.find(project => !["complete", "paused"].includes(project.production_status)) || projects[0] || null;
  }

  async function save(ownerId, input, channelId) {
    if (!ownerId) throw new Error("Owner authentication is required.");
    const state = normalizeState(input);
    if (!state.rhyme_title) throw new Error("Rhyme name is required to save production progress.");
    const body = {
      owner_user_id: ownerId,
      channel_id: cleanText(channelId || input.channelId || input.channel_id, 180) || null,
      ...state,
      updated_at: new Date().toISOString()
    };
    const id = cleanText(input.id, 80);
    if (id) {
      const rows = await request("youtube_rhyme_projects?id=eq." + encodeURIComponent(id) +
        "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&select=id", {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(body)
        });
      if (!Array.isArray(rows) || !rows.length) throw new Error("Rhyme project was not found for this owner.");
      return rows[0];
    }
    const existing = await request("youtube_rhyme_projects?select=id&owner_user_id=eq." + encodeURIComponent(ownerId) +
      "&rhyme_title=eq." + encodeURIComponent(state.rhyme_title) +
      (body.channel_id ? "&channel_id=eq." + encodeURIComponent(body.channel_id) : "") +
      "&order=updated_at.desc&limit=1");
    if (Array.isArray(existing) && existing[0]?.id) {
      const rows = await request("youtube_rhyme_projects?id=eq." + encodeURIComponent(existing[0].id) +
        "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&select=*", {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(body)
        });
      return rows?.[0] || null;
    }
    const rows = await request("youtube_rhyme_projects?select=*", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body)
    });
    return Array.isArray(rows) ? rows[0] : null;
  }

  async function persistReport(ownerId, channelId, report) {
    const state = extractRhymeProductionState(report);
    if (!state || !ownerId) return null;
    return await save(ownerId, state, channelId);
  }

  async function context(ownerId, channelId) {
    const project = await getActive(ownerId, channelId);
    if (!project) return "";
    return [
      "SAVED RHYME PRODUCTION MEMORY — CONTINUE FROM THIS STATE ONLY WHEN THE USER ASKS TO RESUME THIS RHYME:",
      "Rhyme: " + project.rhyme_title,
      "Full script: " + (project.script || "Not saved yet"),
      "Total scenes: " + project.total_scenes,
      "Completed scenes: " + JSON.stringify(project.completed_scenes || []),
      "Remaining scenes: " + JSON.stringify(project.remaining_scenes || []),
      "Character continuity: " + JSON.stringify(project.character_continuity || {}),
      "Background continuity: " + JSON.stringify(project.background_continuity || {}),
      "Last generated clip: " + JSON.stringify(project.last_generated_clip || {}),
      "Next scene: " + (project.next_scene ?? "Not set"),
      "Cooldown: " + project.cooldown_status + (project.retry_at ? " until " + project.retry_at : ""),
      "Failed clips: " + JSON.stringify(project.failed_clips || []),
      "Retry attempts: " + project.retry_attempts,
      "Production status: " + project.production_status,
      "Do not mark a scene complete unless a real generated clip is confirmed. Do not invent a clip URL, cooldown, or retry time."
    ].join("\n");
  }

  async function listHandler(req, res) {
    try { return res.json({ success: true, projects: await list(req.ownerUser.id, req.query?.channel_id) }); }
    catch (error) { return res.status(503).json({ success: false, error: error.message }); }
  }
  async function saveHandler(req, res) {
    try {
      const project = await save(req.ownerUser.id, req.body || {}, req.body?.channelId || req.body?.channel_id);
      return res.status(200).json({ success: true, project });
    } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  }
  async function getHandler(req, res) {
    try {
      const rows = await request("youtube_rhyme_projects?select=*&id=eq." + encodeURIComponent(req.params.id) +
        "&owner_user_id=eq." + encodeURIComponent(req.ownerUser.id) + "&limit=1");
      if (!Array.isArray(rows) || !rows[0]) return res.status(404).json({ success: false, error: "Rhyme project not found." });
      return res.json({ success: true, project: rows[0] });
    } catch (error) { return res.status(503).json({ success: false, error: error.message }); }
  }

  return { list, getActive, save, persistReport, context, listHandler, saveHandler, getHandler };
}
