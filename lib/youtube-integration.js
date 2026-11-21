import crypto from "node:crypto";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(key + " is not configured on the server.");
  return value;
}

function encryptionKey(env) {
  const value = required(env, "YOUTUBE_TOKEN_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("YOUTUBE_TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).");
  }
  return Buffer.from(value, "hex");
}

function signState(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return encoded + "." + signature;
}

function verifyState(state, secret) {
  if (typeof state !== "string" || state.length > 2000) throw new Error("Invalid YouTube connection state.");
  const parts = state.split(".");
  if (parts.length !== 2) throw new Error("Invalid YouTube connection state.");
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest();
  let actual;
  try { actual = Buffer.from(parts[1], "base64url"); } catch { throw new Error("Invalid YouTube connection state."); }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("YouTube connection state signature is invalid.");
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch {
    throw new Error("YouTube connection state is invalid.");
  }
  if (!payload?.ownerId || !Number.isFinite(payload.issuedAt) || Date.now() - payload.issuedAt > 10 * 60 * 1000 || payload.issuedAt > Date.now() + 60_000) {
    throw new Error("This YouTube connection request expired. Start again from the dashboard.");
  }
  return payload;
}

function encryptToken(token, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

function decryptToken(value, key) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) throw new Error("Stored YouTube connection cannot be decrypted.");
  const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function config(env) {
  return {
    clientId: required(env, "YOUTUBE_CLIENT_ID"),
    clientSecret: required(env, "YOUTUBE_CLIENT_SECRET"),
    redirectUri: required(env, "YOUTUBE_REDIRECT_URI"),
    supabaseUrl: required(env, "SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    tokenKey: encryptionKey(env),
    stateSecret: crypto.createHmac("sha256", encryptionKey(env)).update("master-ai-bot-youtube-oauth-state").digest()
  };
}

async function supabaseRequest(cfg, path, options = {}) {
  const response = await fetch(cfg.supabaseUrl + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: cfg.serviceKey,
      Authorization: "Bearer " + cfg.serviceKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error("Secure YouTube token storage failed (" + response.status + "): " + detail.slice(0, 250));
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function loadConnections(cfg, ownerId) {
  const ownerFilter = "&owner_user_id=eq." + encodeURIComponent(ownerId);
  const [multiRows, legacyRows] = await Promise.all([
    supabaseRequest(cfg, "youtube_channel_connections?select=id,owner_user_id,channel_id,channel_title,thumbnail_url,refresh_token_ciphertext,updated_at,created_at" + ownerFilter + "&order=created_at.asc"),
    supabaseRequest(cfg, "youtube_connections?select=owner_user_id,channel_id,channel_title,thumbnail_url,refresh_token_ciphertext,updated_at,created_at&id=eq.1" + ownerFilter)
  ]);
  const merged = [...(Array.isArray(multiRows) ? multiRows : [])];
  const known = new Set(merged.map(row => row.channel_id));
  for (const row of Array.isArray(legacyRows) ? legacyRows : []) {
    if (!known.has(row.channel_id)) merged.push(row);
  }
  return merged;
}

async function loadConnection(cfg, ownerId, channelId) {
  const rows = await loadConnections(cfg, ownerId);
  if (channelId) return rows.find(row => row.channel_id === channelId) || null;
  return rows.find(row => String(row.channel_title || "").trim().toLowerCase() === "global rhymes 4u") || rows[0] || null;
}

async function saveConnection(cfg, ownerId, channel, refreshToken) {
  const body = {
    owner_user_id: ownerId,
    channel_id: channel.id,
    channel_title: channel.snippet?.title || "YouTube channel",
    thumbnail_url: channel.snippet?.thumbnails?.default?.url || null,
    refresh_token_ciphertext: encryptToken(refreshToken, cfg.tokenKey),
    updated_at: new Date().toISOString()
  };
  const existing = await supabaseRequest(
    cfg,
    "youtube_channel_connections?select=id&owner_user_id=eq." + encodeURIComponent(ownerId) +
      "&channel_id=eq." + encodeURIComponent(channel.id) + "&limit=1"
  );
  if (Array.isArray(existing) && existing[0]?.id) {
    await supabaseRequest(cfg, "youtube_channel_connections?id=eq." + encodeURIComponent(existing[0].id), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body)
    });
    return;
  }
  await supabaseRequest(cfg, "youtube_channel_connections", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body)
  });
}

async function googleJson(url, accessToken) {
  const response = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "Google API request failed.";
    throw new Error("YouTube API (" + response.status + "): " + message);
  }
  return data;
}

async function refreshAccessToken(cfg, refreshToken) {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google could not refresh the YouTube connection. Reconnect the channel.");
  }
  return data.access_token;
}

async function accessForOwner(env, ownerId, channelId) {
  const cfg = config(env);
  const row = await loadConnection(cfg, ownerId, channelId);
  if (!row) throw new Error(channelId ? "That YouTube channel is not connected to this owner account." : "No YouTube channel is connected yet. Use Connect YouTube first.");
  const refreshToken = decryptToken(row.refresh_token_ciphertext, cfg.tokenKey);
  return { cfg, row, accessToken: await refreshAccessToken(cfg, refreshToken) };
}

export async function getYoutubeAgentContext({ env = process.env, ownerId, channelId } = {}) {
  const { accessToken, row } = await accessForOwner(env, ownerId, channelId);
  const channelData = await googleJson(
    YOUTUBE_API + "/channels?part=snippet,statistics,contentDetails&id=" + encodeURIComponent(row.channel_id),
    accessToken
  );
  const channel = channelData.items?.[0];
  if (!channel) throw new Error("The selected connected YouTube channel could not be found.");

  const playlistId = channel.contentDetails?.relatedPlaylists?.uploads;
  let recentVideos = [];
  if (playlistId) {
    const playlist = await googleJson(
      YOUTUBE_API + "/playlistItems?part=contentDetails&playlistId=" + encodeURIComponent(playlistId) + "&maxResults=10",
      accessToken
    );
    const ids = (playlist.items || []).map(item => item.contentDetails?.videoId).filter(Boolean);
    if (ids.length) {
      const details = await googleJson(
        YOUTUBE_API + "/videos?part=snippet,statistics&id=" + ids.map(encodeURIComponent).join(","),
        accessToken
      );
      recentVideos = details.items || [];
    }
  }

  let analyticsSummary = "Analytics unavailable for this request.";
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      ids: "channel==MINE",
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained"
    });
    const analytics = await googleJson(ANALYTICS_API + "?" + params.toString(), accessToken);
    const rowData = analytics.rows?.[0] || [];
    analyticsSummary = "Last 28 days: views=" + (rowData[0] ?? "not reported") +
      ", watch minutes=" + (rowData[1] ?? "not reported") +
      ", average view duration seconds=" + (rowData[2] ?? "not reported") +
      ", subscribers gained=" + (rowData[3] ?? "not reported") + ".";
  } catch (error) {
    analyticsSummary = "Analytics unavailable: " + error.message.slice(0, 180);
  }

  const videoLines = recentVideos.map(video =>
    "- " + (video.snippet?.title || "Untitled") +
    " | views: " + (video.statistics?.viewCount || "not reported") +
    " | likes: " + (video.statistics?.likeCount || "not reported") +
    " | published: " + (video.snippet?.publishedAt || "not reported")
  );

  return [
    "LIVE CONNECTED YOUTUBE CHANNEL CONTEXT (read-only; use as evidence, not as permission to publish):",
    "Channel: " + (channel.snippet?.title || row.channel_title),
    "Channel ID: " + row.channel_id,
    "Subscribers: " + (channel.statistics?.hiddenSubscriberCount ? "hidden" : channel.statistics?.subscriberCount || "not reported"),
    "Lifetime channel views: " + (channel.statistics?.viewCount || "not reported"),
    "Published video count: " + (channel.statistics?.videoCount || "not reported"),
    analyticsSummary,
    "Recent uploads:",
    ...(videoLines.length ? videoLines : ["- No recent uploads were returned."]),
    "Use this real channel history to avoid repeating recent topics. Tailor original video ideas to this channel's own title, description, and audience; do not assume every connected channel is a children's rhyme channel.",
    "Do not claim to upload, publish, edit, or schedule videos. All publishing remains disabled and requires a separately implemented owner approval workflow."
  ].join("\n");
}

export function createYoutubeIntegrationHandlers({ env = process.env } = {}) {
  return {
    connectUrl(req, res) {
      try {
        const cfg = config(env);
        const channelTitle = String(req.query?.channel_title || "Global Rhymes 4U").trim();
        if (!channelTitle || channelTitle.length > 120) {
          return res.status(400).json({ success: false, error: "Enter a channel name between 1 and 120 characters." });
        }
        const state = signState({
          ownerId: req.ownerUser.id,
          channelTitle,
          issuedAt: Date.now(),
          nonce: crypto.randomBytes(18).toString("base64url")
        }, cfg.stateSecret);
        const url = new URL(GOOGLE_AUTH);
        url.search = new URLSearchParams({
          client_id: cfg.clientId,
          redirect_uri: cfg.redirectUri,
          response_type: "code",
          scope: [
            "https://www.googleapis.com/auth/youtube.readonly",
            "https://www.googleapis.com/auth/yt-analytics.readonly"
          ].join(" "),
          access_type: "offline",
          prompt: "select_account consent",
          include_granted_scopes: "true",
          state
        }).toString();
        return res.json({ success: true, authorizationUrl: url.toString() });
      } catch (error) {
        return res.status(503).json({ success: false, error: error.message });
      }
    },

    async callback(req, res) {
      try {
        if (req.query.error) throw new Error("Google authorization was not completed: " + String(req.query.error).slice(0, 100));
        const cfg = config(env);
        const state = verifyState(req.query.state, cfg.stateSecret);
        const code = String(req.query.code || "");
        if (!code || code.length > 4096) throw new Error("Google did not return a valid authorization code.");
        const tokenResponse = await fetch(GOOGLE_TOKEN, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            redirect_uri: cfg.redirectUri,
            grant_type: "authorization_code"
          })
        });
        const tokens = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) {
          throw new Error(tokens.error_description || tokens.error || "Google did not return offline access. Start Connect YouTube again and approve the requested access.");
        }
        const channelData = await googleJson(
          YOUTUBE_API + "/channels?part=snippet,statistics,contentDetails&mine=true",
          tokens.access_token
        );
        const wantedTitle = String(state.channelTitle || "Global Rhymes 4U").trim().toLowerCase();
        const channel = (channelData.items || []).find(item =>
          String(item.snippet?.title || "").trim().toLowerCase() === wantedTitle
        );
        if (!channel?.id) {
          return res.redirect("/?youtube=channel-mismatch");
        }
        const existingConnections = await loadConnections(cfg, state.ownerId);
        const alreadyConnected = existingConnections.some(item => item.channel_id === channel.id);
        if (!alreadyConnected && existingConnections.length >= 3) {
          return res.redirect("/?youtube=limit");
        }
        await saveConnection(cfg, state.ownerId, channel, tokens.refresh_token);
        return res.redirect("/?youtube=connected");
      } catch (error) {
        console.error("YouTube OAuth callback failed:", error.message);
        return res.redirect("/?youtube=error");
      }
    },

    async status(req, res) {
      try {
        const cfg = config(env);
        const rows = await loadConnections(cfg, req.ownerUser.id);
        const row = rows.find(item => String(item.channel_title || "").trim().toLowerCase() === "global rhymes 4u") || rows[0] || null;
        return res.json({
          success: true,
          connected: rows.length > 0,
          maxChannels: 3,
          channels: rows.map(item => ({
            id: item.channel_id,
            title: item.channel_title,
            thumbnailUrl: item.thumbnail_url,
            updatedAt: item.updated_at
          })),
          channel: row ? {
            id: row.channel_id,
            title: row.channel_title,
            thumbnailUrl: row.thumbnail_url,
            updatedAt: row.updated_at
          } : null
        });
      } catch (error) {
        return res.status(503).json({ success: false, error: error.message });
      }
    },

    async channel(req, res) {
      try {
        const { accessToken, row } = await accessForOwner(env, req.ownerUser.id, req.query?.channel_id);
        const data = await googleJson(
          YOUTUBE_API + "/channels?part=snippet,statistics,contentDetails&id=" + encodeURIComponent(row.channel_id),
          accessToken
        );
        const channel = data.items?.[0];
        if (!channel) return res.status(404).json({ success: false, error: "No connected YouTube channel was found." });
        return res.json({
          success: true,
          channel: {
            id: channel.id,
            title: channel.snippet?.title || "",
            description: channel.snippet?.description || "",
            thumbnailUrl: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url || null,
            publishedAt: channel.snippet?.publishedAt || null,
            subscribers: channel.statistics?.hiddenSubscriberCount ? null : Number(channel.statistics?.subscriberCount || 0),
            views: Number(channel.statistics?.viewCount || 0),
            videoCount: Number(channel.statistics?.videoCount || 0),
            uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads || null
          }
        });
      } catch (error) {
        return res.status(502).json({ success: false, error: error.message });
      }
    },

    async videos(req, res) {
      try {
        const { accessToken, row } = await accessForOwner(env, req.ownerUser.id, req.query?.channel_id);
        const channelData = await googleJson(
          YOUTUBE_API + "/channels?part=contentDetails&id=" + encodeURIComponent(row.channel_id),
          accessToken
        );
        const playlistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (!playlistId) return res.json({ success: true, videos: [] });
        const playlist = await googleJson(
          YOUTUBE_API + "/playlistItems?part=snippet,contentDetails&playlistId=" + encodeURIComponent(playlistId) + "&maxResults=20",
          accessToken
        );
        const ids = (playlist.items || []).map(item => item.contentDetails?.videoId).filter(Boolean);
        if (!ids.length) return res.json({ success: true, videos: [] });
        const details = await googleJson(
          YOUTUBE_API + "/videos?part=snippet,statistics,status&id=" + ids.map(encodeURIComponent).join(","),
          accessToken
        );
        return res.json({
          success: true,
          videos: (details.items || []).map(video => ({
            id: video.id,
            title: video.snippet?.title || "",
            description: video.snippet?.description || "",
            thumbnailUrl: video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url || null,
            publishedAt: video.snippet?.publishedAt || null,
            views: Number(video.statistics?.viewCount || 0),
            likes: Number(video.statistics?.likeCount || 0),
            comments: Number(video.statistics?.commentCount || 0),
            privacyStatus: video.status?.privacyStatus || "unknown"
          }))
        });
      } catch (error) {
        return res.status(502).json({ success: false, error: error.message });
      }
    },

    async analytics(req, res) {
      try {
        const { accessToken } = await accessForOwner(env, req.ownerUser.id, req.query?.channel_id);
        const end = new Date();
        const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
        const dateOnly = value => value.toISOString().slice(0, 10);
        const params = new URLSearchParams({
          ids: "channel==MINE",
          startDate: dateOnly(start),
          endDate: dateOnly(end),
          metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained",
          dimensions: "day",
          sort: "day"
        });
        const data = await googleJson(ANALYTICS_API + "?" + params.toString(), accessToken);
        return res.json({
          success: true,
          headers: data.columnHeaders || [],
          rows: data.rows || [],
          startDate: dateOnly(start),
          endDate: dateOnly(end)
        });
      } catch (error) {
        return res.status(502).json({ success: false, error: error.message });
      }
    }
  };
}
