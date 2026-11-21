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
  const tokenKey = encryptionKey(env);
  return {
    clientId: required(env, "YOUTUBE_CLIENT_ID"),
    clientSecret: required(env, "YOUTUBE_CLIENT_SECRET"),
    redirectUri: required(env, "YOUTUBE_REDIRECT_URI"),
    supabaseUrl: required(env, "SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    tokenKey,
    stateSecret: crypto.createHmac("sha256", tokenKey).update("master-ai-bot-youtube-oauth-state").digest()
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
  const rows = await supabaseRequest(
    cfg,
    "youtube_connections?select=owner_user_id,channel_id,channel_title,thumbnail_url,refresh_token_ciphertext,updated_at&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&order=updated_at.desc"
  );
  return Array.isArray(rows) ? rows : [];
}

async function loadConnection(cfg, ownerId, channelId) {
  const rows = await loadConnections(cfg, ownerId);
  const row = channelId ? rows.find(item => item.channel_id === channelId) : rows[0];
  if (!row && channelId) throw new Error("That YouTube channel is not connected to this owner account. Refresh the channel list or connect it first.");
  return row || null;
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
  await supabaseRequest(cfg, "youtube_connections?on_conflict=owner_user_id,channel_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
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
  if (!row) throw new Error("No YouTube channel is connected yet. Use Add YouTube channel first.");
  const refreshToken = decryptToken(row.refresh_token_ciphertext, cfg.tokenKey);
  return { cfg, row, accessToken: await refreshAccessToken(cfg, refreshToken) };
}

function channelSummary(channel, row) {
  return {
    id: channel.id,
    title: channel.snippet?.title || row.channel_title,
    description: channel.snippet?.description || "",
    thumbnailUrl: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url || row.thumbnail_url || null,
    publishedAt: channel.snippet?.publishedAt || null,
    subscribers: channel.statistics?.hiddenSubscriberCount ? null : Number(channel.statistics?.subscriberCount || 0),
    views: Number(channel.statistics?.viewCount || 0),
    videoCount: Number(channel.statistics?.videoCount || 0),
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads || null,
    updatedAt: row.updated_at
  };
}

export async function getYoutubeAgentContext({ env = process.env, ownerId, channelId } = {}) {
  const cfg = config(env);
  const rows = channelId ? [await loadConnection(cfg, ownerId, channelId)].filter(Boolean) : await loadConnections(cfg, ownerId);
  if (!rows.length) throw new Error("No YouTube channel is connected yet. Use Add YouTube channel first.");

  const channelContexts = [];
  for (const row of rows) {
    const refreshToken = decryptToken(row.refresh_token_ciphertext, cfg.tokenKey);
    const accessToken = await refreshAccessToken(cfg, refreshToken);
    const data = await googleJson(
      YOUTUBE_API + "/channels?part=snippet,statistics,contentDetails&id=" + encodeURIComponent(row.channel_id),
      accessToken
    );
    const channel = data.items?.[0];
    if (!channel) continue;
    const summary = channelSummary(channel, row);
    let recentVideos = [];
    const playlistId = summary.uploadsPlaylistId;
    if (playlistId) {
      const playlist = await googleJson(
        YOUTUBE_API + "/playlistItems?part=contentDetails&playlistId=" + encodeURIComponent(playlistId) + "&maxResults=5",
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
    channelContexts.push({ summary, recentVideos });
  }

  if (!channelContexts.length) throw new Error("Connected YouTube channels could not be found through the YouTube API.");
  const lines = [
    "LIVE CONNECTED YOUTUBE CHANNEL CONTEXT (verified channel records; never mix metrics between channels):",
    "Connected channel count: " + channelContexts.length
  ];
  for (const item of channelContexts) {
    const channel = item.summary;
    lines.push(
      "",
      "CHANNEL: " + channel.title,
      "Channel ID: " + channel.id,
      "Subscribers: " + (channel.subscribers === null ? "hidden" : channel.subscribers),
      "Lifetime views: " + channel.views,
      "Published videos: " + channel.videoCount,
      "Recent uploads:"
    );
    lines.push(...(item.recentVideos.length ? item.recentVideos.map(video =>
      "- " + (video.snippet?.title || "Untitled") + " | views: " + (video.statistics?.viewCount || "not reported") +
      " | published: " + (video.snippet?.publishedAt || "not reported")
    ) : ["- No recent uploads were returned."]));
  }
  if (channelContexts.length > 1 && !channelId) {
    lines.push(
      "",
      "MULTI-CHANNEL RULE: The owner has multiple connected channels. Ask which exact channel the task is for before preparing channel-specific content or interpreting performance. Never combine channel analytics or assume all channels share the same audience, language, brand or content niche."
    );
  } else {
    lines.push(
      "",
      "Use only the selected channel's verified history and metrics. Do not claim to upload, publish, edit, or schedule videos. Publishing remains disabled and requires a separately implemented owner approval workflow."
    );
  }
  return lines.join("\n");
}

export function createYoutubeIntegrationHandlers({ env = process.env } = {}) {
  return {
    connectUrl(req, res) {
      try {
        const cfg = config(env);
        const state = signState({
          ownerId: req.ownerUser.id,
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
          prompt: "consent",
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
          throw new Error(tokens.error_description || tokens.error || "Google did not return offline access. Start Add YouTube channel again and approve the requested access.");
        }
        const channelData = await googleJson(
          YOUTUBE_API + "/channels?part=snippet,statistics,contentDetails&mine=true",
          tokens.access_token
        );
        const channels = (channelData.items || []).filter(item => item.id);
        if (!channels.length) return res.redirect("/?youtube=channel-mismatch");
        for (const channel of channels) {
          await saveConnection(cfg, state.ownerId, channel, tokens.refresh_token);
        }
        return res.redirect("/?youtube=connected&count=" + channels.length);
      } catch (error) {
        console.error("YouTube OAuth callback failed:", error.message);
        return res.redirect("/?youtube=error");
      }
    },

    async status(req, res) {
      try {
        const cfg = config(env);
        const rows = await loadConnections(cfg, req.ownerUser.id);
        const channels = rows.map(row => ({
          id: row.channel_id,
          title: row.channel_title,
          thumbnailUrl: row.thumbnail_url,
          updatedAt: row.updated_at
        }));
        return res.json({
          success: true,
          connected: channels.length > 0,
          channelCount: channels.length,
          channels,
          // Backward-compatible field for older dashboard clients.
          channel: channels[0] || null
        });
      } catch (error) {
        return res.status(503).json({ success: false, error: error.message });
      }
    },

    async channel(req, res) {
      try {
        const { accessToken, row } = await accessForOwner(env, req.ownerUser.id, String(req.query.channelId || ""));
        const data = await googleJson(
          YOUTUBE_API + "/channels?part=snippet,statistics,contentDetails&id=" + encodeURIComponent(row.channel_id),
          accessToken
        );
        const channel = data.items?.[0];
        if (!channel) return res.status(404).json({ success: false, error: "No connected YouTube channel was found." });
        return res.json({ success: true, channel: channelSummary(channel, row) });
      } catch (error) {
        return res.status(502).json({ success: false, error: error.message });
      }
    },

    async videos(req, res) {
      try {
        const { accessToken, row } = await accessForOwner(env, req.ownerUser.id, String(req.query.channelId || ""));
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
        const { accessToken } = await accessForOwner(env, req.ownerUser.id, String(req.query.channelId || ""));
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
