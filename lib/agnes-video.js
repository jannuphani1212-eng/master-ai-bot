const DEFAULT_BASE_URL = "https://apihub.agnes-ai.com";

function jsonError(res, status, error) {
  return res.status(status).json({ success: false, error });
}

function getConfig(env) {
  const apiKey = String(env.AGNES_API_KEY || "").trim();
  const baseUrl = String(env.AGNES_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { apiKey, baseUrl };
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || data?.error || data?.message || ("Agnes API returned HTTP " + response.status);
    throw new Error(String(detail).slice(0, 300));
  }
  return data;
}

export function createAgnesVideoHandlers({ env = process.env, fetchImpl = fetch } = {}) {
  async function create(req, res) {
    if (String(env.AGNES_VIDEO_FREE_MODE_ENABLED || "").toLowerCase() !== "true") {
      return jsonError(res, 503, "Video generation is locked until the Agnes console confirms the selected model is free. No video request was sent.");
    }
    const { apiKey, baseUrl } = getConfig(env);
    if (!apiKey) return jsonError(res, 503, "AGNES_API_KEY is not configured on the server.");
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (prompt.length < 20 || prompt.length > 3000) {
      return jsonError(res, 400, "Please provide a video prompt between 20 and 3,000 characters.");
    }
    const seconds = Number(req.body?.seconds ?? 5);
    if (!Number.isInteger(seconds) || seconds < 4 || seconds > 12) {
      return jsonError(res, 400, "Video duration must be between 4 and 12 seconds.");
    }
    const aspectRatio = String(req.body?.aspect_ratio || "16:9");
    if (!["16:9", "9:16", "1:1", "4:3", "3:4"].includes(aspectRatio)) {
      return jsonError(res, 400, "Unsupported video aspect ratio.");
    }

    try {
      const response = await fetchImpl(baseUrl + "/v1/videos", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "agnes-video-2.5-flash",
          prompt,
          mode: "text",
          seconds: String(seconds),
          size: "720P",
          aspect_ratio: aspectRatio,
          n: 1
        }),
        signal: AbortSignal.timeout(30000)
      });
      const data = await readJson(response);
      const videoId = data.video_id || data.id;
      if (!videoId || typeof videoId !== "string") {
        return jsonError(res, 502, "Agnes did not return a video ID. Check the provider response and usage console.");
      }
      return res.status(202).json({
        success: true,
        status: data.status || "queued",
        videoId,
        model: "agnes-video-2.5-flash",
        message: "Video job submitted. Check its status to retrieve the result."
      });
    } catch (error) {
      return jsonError(res, 502, "Agnes video request failed: " + error.message);
    }
  }

  async function status(req, res) {
    if (String(env.AGNES_VIDEO_FREE_MODE_ENABLED || "").toLowerCase() !== "true") {
      return jsonError(res, 503, "Video generation is locked pending free-tier verification.");
    }
    const { apiKey, baseUrl } = getConfig(env);
    if (!apiKey) return jsonError(res, 503, "AGNES_API_KEY is not configured on the server.");
    const videoId = String(req.query?.video_id || "").trim();
    if (!/^[A-Za-z0-9_-]{5,200}$/.test(videoId)) {
      return jsonError(res, 400, "A valid video_id is required.");
    }
    try {
      const url = new URL(baseUrl + "/agnesapi");
      url.searchParams.set("video_id", videoId);
      url.searchParams.set("model_name", "agnes-video-2.5-flash");
      const response = await fetchImpl(url.toString(), {
        headers: { Authorization: "Bearer " + apiKey },
        signal: AbortSignal.timeout(20000)
      });
      const data = await readJson(response);
      const state = String(data.status || "unknown").toLowerCase();
      return res.json({
        success: true,
        status: state,
        progress: Number.isFinite(Number(data.progress)) ? Number(data.progress) : null,
        videoUrl: state === "completed" && typeof data.url === "string" ? data.url : null,
        error: state === "failed" ? String(data.error || "Video generation failed.").slice(0, 300) : null
      });
    } catch (error) {
      return jsonError(res, 502, "Agnes status check failed: " + error.message);
    }
  }

  return { create, status };
}
