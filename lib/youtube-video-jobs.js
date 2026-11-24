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
  async function list(ownerId, limit = 20) {
    if (!UUID.test(String(ownerId || ""))) throw new Error("Owner authentication is required.");
    const rows = await request(TABLE + "?select=id,rhyme_title,status,total_scenes,completed_scenes,next_scene,retry_at,video_path,thumbnail_path,last_error,created_at,updated_at&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&order=updated_at.desc&limit=" + Math.max(1, Math.min(50, Number(limit) || 20)));
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
        "x-upsert": "false"
      },
      body: bytes,
      signal: AbortSignal.timeout(60000)
    });
    await parse(response);
    return path;
  }
  return { list, get, signedAsset, upload };
}

export function createYoutubeVideoJobHandlers(store) {
  async function list(req, res) {
    try { return res.json({ success: true, jobs: await store.list(req.ownerUser.id) }); }
    catch (error) { return res.status(503).json({ success: false, error: error.message }); }
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
