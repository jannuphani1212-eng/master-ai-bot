const TABLE = "youtube_video_jobs";
const BUCKET = "youtube-production";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function config(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("YouTube video storage requires server-side Supabase credentials.");
  return { url, key };
}
async function parse(response) {
  const raw = await response.text();
  let value = null;
  try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
  if (!response.ok) throw new Error("YouTube production storage request failed (" + response.status + "): " + String(raw).slice(0, 240));
  return value;
}
function ownerPath(ownerId, jobId, filename) {
  if (!UUID.test(ownerId) || !UUID.test(jobId)) throw new Error("Invalid owner or production job identifier.");
  const safeName = String(filename || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  if (!safeName || safeName === "." || safeName === "..") throw new Error("A safe asset filename is required.");
  return ownerId + "/" + jobId + "/" + safeName;
}

export function createYoutubeVideoJobStore({ env = process.env, fetchImpl = fetch } = {}) {
  const cfg = () => config(env);
  async function request(path, options = {}) {
    const c = cfg();
    return parse(await fetchImpl(c.url + "/rest/v1/" + path, {
      ...options,
      headers: {
        apikey: c.key,
        Authorization: "Bearer " + c.key,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: AbortSignal.timeout(20000)
    }));
  }
  async function create(ownerId, input = {}) {
    if (!UUID.test(String(ownerId || ""))) throw new Error("Owner authentication is required.");
    const title = String(input.rhyme_title || input.rhymeTitle || "").trim().slice(0, 180);
    if (!title) throw new Error("Rhyme title is required.");
    const body = {
      owner_user_id: ownerId,
      rhyme_title: title,
      rhyme_project_id: UUID.test(String(input.rhyme_project_id || "")) ? input.rhyme_project_id : null,
      status: "queued",
      script: String(input.script || "").slice(0, 30000),
      total_scenes: Array.isArray(input.scenes) ? Math.min(20, input.scenes.length) : 0,
      next_scene: 1,
      production_spec: input.production_spec && typeof input.production_spec === "object" ? input.production_spec : {},
      metadata: { createdBy: "youtube-specialist", reviewRequired: true, publishingEnabled: false }
    };
    const rows = await request(TABLE + "?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) });
    if (!Array.isArray(rows) || !rows[0]) throw new Error("Could not create the production job.");
    return rows[0];
  }
  async function update(ownerId, jobId, patch = {}) {
    if (!UUID.test(String(ownerId || "")) || !UUID.test(String(jobId || ""))) throw new Error("Invalid production job identifier.");
    const allowed = ["status","total_scenes","completed_scenes","next_scene","retry_at","retry_attempts","script","production_spec","asset_paths","video_path","thumbnail_path","metadata","last_error"];
    const body = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
    body.updated_at = new Date().toISOString();
    const rows = await request(TABLE + "?id=eq." + encodeURIComponent(jobId) + "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&select=*", {
      method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body)
    });
    if (!Array.isArray(rows) || !rows[0]) throw new Error("Production job was not found for this owner.");
    return rows[0];
  }
  async function list(ownerId, limit = 20) {
    if (!UUID.test(String(ownerId || ""))) throw new Error("Owner authentication is required.");
    const rows = await request(TABLE + "?select=id,rhyme_title,status,total_scenes,completed_scenes,next_scene,retry_at,video_path,thumbnail_path,last_error,script,production_spec,metadata,created_at,updated_at&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&order=updated_at.desc&limit=" + Math.max(1, Math.min(50, Number(limit) || 20)));
    return Array.isArray(rows) ? rows : [];
  }
  async function listPending(limit = 10) {
    const now = encodeURIComponent(new Date().toISOString());
    const rows = await request(TABLE + "?select=*&status=in.(queued,planning,rendering,uploading)&or=(retry_at.is.null,retry_at.lte." + now + ")&order=created_at.asc&limit=" + Math.max(1, Math.min(20, Number(limit) || 10)));
    return Array.isArray(rows) ? rows : [];
  }
  async function get(ownerId, jobId) {
    if (!UUID.test(String(ownerId || "")) || !UUID.test(String(jobId || ""))) throw new Error("Invalid production job identifier.");
    const rows = await request(TABLE + "?select=*&owner_user_id=eq." + encodeURIComponent(ownerId) +
      "&id=eq." + encodeURIComponent(jobId) + "&limit=1");
    return Array.isArray(rows) ? rows[0] || null : null;
  }
  async function signedAsset(ownerId, jobId, kind) {
    const job = await get(ownerId, jobId);
    if (!job) return null;
    const path = kind === "thumbnail" ? job.thumbnail_path : job.video_path;
    if (!path || typeof path !== "string" || !path.startsWith(ownerId + "/" + jobId + "/")) return null;
    const c = cfg();
    const response = await fetchImpl(c.url + "/storage/v1/object/sign/" + BUCKET + "/" +
      path.split("/").map(encodeURIComponent).join("/") , {
      method: "POST",
      headers: {
        apikey: c.key,
        Authorization: "Bearer " + c.key,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ expiresIn: 900 }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await parse(response);
    const signed = data?.signedURL || data?.signedUrl;
    if (typeof signed !== "string" || !signed) throw new Error("Supabase did not return a signed asset URL.");
    return signed.startsWith("http") ? signed : c.url + signed;
  }
  async function download(ownerId, jobId, storagePath) {
    if (!UUID.test(String(ownerId || "")) || !UUID.test(String(jobId || "")) ||
        typeof storagePath !== "string" || !storagePath.startsWith(ownerId + "/" + jobId + "/")) {
      throw new Error("Invalid private scene asset path.");
    }
    const c = cfg();
    const response = await fetchImpl(c.url + "/storage/v1/object/" + BUCKET + "/" +
      storagePath.split("/").map(encodeURIComponent).join("/"), {
      method: "GET",
      headers: { apikey: c.key, Authorization: "Bearer " + c.key },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error("Could not resume saved scene artwork (" + response.status + ").");
    return Buffer.from(await response.arrayBuffer());
  }
  async function upload(ownerId, jobId, filename, bytes, contentType) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error("A non-empty generated asset is required.");
    const allowed = new Set(["video/mp4", "image/png", "image/jpeg", "audio/mpeg", "audio/wav"]);
    if (!allowed.has(contentType)) throw new Error("Unsupported production asset type.");
    if (bytes.length > 100 * 1024 * 1024) throw new Error("Production asset exceeds the private bucket's 100 MB limit.");
    const path = ownerPath(ownerId, jobId, filename);
    const c = cfg();
    const response = await fetchImpl(c.url + "/storage/v1/object/" + BUCKET + "/" +
      path.split("/").map(encodeURIComponent).join("/"), {
      method: "POST",
      headers: {
        apikey: c.key,
        Authorization: "Bearer " + c.key,
        "Content-Type": contentType,
        "x-upsert": "true"
      },
      body: bytes,
      signal: AbortSignal.timeout(60000)
    });
    await parse(response);
    return path;
  }
  return { create, update, list, listPending, get, signedAsset, upload, download };
}

export function createYoutubeVideoJobHandlers(store) {
  async function list(req, res) {
    try {
      const jobs = await store.list(req.ownerUser.id);
      const enriched = await Promise.all(jobs.map(async job => ({
        ...job,
        videoUrl: job.video_path ? await store.signedAsset(req.ownerUser.id, job.id, "video") : null,
        thumbnailUrl: job.thumbnail_path ? await store.signedAsset(req.ownerUser.id, job.id, "thumbnail") : null
      })));
      return res.json({ success: true, jobs: enriched });
    } catch (error) { return res.status(503).json({ success: false, error: error.message }); }
  }
  async function get(req, res) {
    try {
      const job = await store.get(req.ownerUser.id, req.params.id);
      if (!job) return res.status(404).json({ success: false, error: "Production job not found." });
      const videoUrl = job.video_path ? await store.signedAsset(req.ownerUser.id, job.id, "video") : null;
      const thumbnailUrl = job.thumbnail_path ? await store.signedAsset(req.ownerUser.id, job.id, "thumbnail") : null;
      return res.json({ success: true, job, videoUrl, thumbnailUrl, reviewRequired: true, publishingEnabled: false });
    } catch (error) { return res.status(503).json({ success: false, error: error.message }); }
  }
  return { list, get };
}
