import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const INSTAGRAM_OAUTH_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_GRAPH = "https://graph.instagram.com/v27.0";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(key + " is not configured on the server.");
  return value;
}

function config(env) {
  const encryptionHex = String(
    env.INSTAGRAM_TOKEN_ENCRYPTION_KEY || env.YOUTUBE_TOKEN_ENCRYPTION_KEY || ""
  ).trim();
  if (!/^[a-f0-9]{64}$/i.test(encryptionHex)) {
    throw new Error("Set INSTAGRAM_TOKEN_ENCRYPTION_KEY to 64 hexadecimal characters (or reuse the existing YOUTUBE_TOKEN_ENCRYPTION_KEY).");
  }
  return {
    appId: required(env, "INSTAGRAM_APP_ID"),
    appSecret: required(env, "INSTAGRAM_APP_SECRET"),
    redirectUri: required(env, "INSTAGRAM_REDIRECT_URI"),
    encryptionKey: Buffer.from(encryptionHex, "hex"),
    supabaseUrl: required(env, "SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY")
  };
}

function encryptToken(token, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

function decryptToken(value, key) {
  const [ivText, tagText, encryptedText] = String(value || "").split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Stored Instagram token is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function createState(ownerId, secret) {
  const payload = Buffer.from(JSON.stringify({
    ownerId,
    expiresAt: Date.now() + 10 * 60 * 1000,
    nonce: randomBytes(16).toString("hex")
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

function verifyState(value, secret) {
  const [payload, signature] = String(value || "").split(".");
  if (!payload || !signature) throw new Error("Instagram OAuth state is invalid.");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("Instagram OAuth state could not be verified.");
  }
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!data.ownerId || !Number.isFinite(data.expiresAt) || data.expiresAt < Date.now()) {
    throw new Error("Instagram OAuth state has expired.");
  }
  return data;
}

async function responseJson(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(label + " failed (" + response.status + ").");
  }
  return data;
}

async function graphGet(path, accessToken) {
  const url = new URL(INSTAGRAM_GRAPH + path);
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  return responseJson(response, "Instagram API request");
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
    await response.text();
    throw new Error("Instagram connection storage request failed (" + response.status + ").");
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function loadConnections(cfg, ownerId) {
  const rows = await supabaseRequest(
    cfg,
    "instagram_connections?select=owner_user_id,ig_user_id,username,account_type,access_token_ciphertext,expires_at,updated_at&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&order=created_at.asc"
  );
  return Array.isArray(rows) ? rows : [];
}

async function saveConnection(cfg, ownerId, profile, token, expiresIn) {
  const igUserId = String(profile.user_id || profile.id || "").trim();
  if (!igUserId) throw new Error("Instagram did not return an account ID.");
  const expiresAt = new Date(Date.now() + Number(expiresIn || 0) * 1000).toISOString();
  const body = {
    owner_user_id: ownerId,
    ig_user_id: igUserId,
    username: profile.username || null,
    account_type: profile.account_type || "UNKNOWN",
    access_token_ciphertext: encryptToken(token, cfg.encryptionKey),
    expires_at: expiresAt,
    updated_at: new Date().toISOString()
  };
  await supabaseRequest(cfg, "instagram_connections?on_conflict=owner_user_id,ig_user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body)
  });
}

async function refreshIfNeeded(cfg, row) {
  const expiresAt = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt - Date.now() > 5 * 24 * 60 * 60 * 1000) {
    return row;
  }
  const token = decryptToken(row.access_token_ciphertext, cfg.encryptionKey);
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  const refreshed = await responseJson(await fetch(url), "Instagram token refresh");
  const nextRow = {
    ...row,
    access_token_ciphertext: encryptToken(refreshed.access_token, cfg.encryptionKey),
    expires_at: new Date(Date.now() + Number(refreshed.expires_in || 0) * 1000).toISOString(),
    updated_at: new Date().toISOString()
  };
  await supabaseRequest(
    cfg,
    "instagram_connections?owner_user_id=eq." + encodeURIComponent(row.owner_user_id) +
      "&ig_user_id=eq." + encodeURIComponent(row.ig_user_id),
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        access_token_ciphertext: nextRow.access_token_ciphertext,
        expires_at: nextRow.expires_at,
        updated_at: nextRow.updated_at
      })
    }
  );
  return nextRow;
}

async function accessForAccount(cfg, ownerId, igUserId) {
  const rows = await loadConnections(cfg, ownerId);
  const original = rows.find(row => row.ig_user_id === igUserId);
  if (!original) throw new Error("The selected Instagram account is not connected to this owner.");
  const row = await refreshIfNeeded(cfg, original);
  return { row, accessToken: decryptToken(row.access_token_ciphertext, cfg.encryptionKey) };
}

async function graphPost(path, fields) {
  const response = await fetch(INSTAGRAM_GRAPH + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields)
  });
  return responseJson(response, "Instagram publishing request");
}

async function assertPublishingQuota(igUserId, accessToken) {
  const response = await graphGet(
    "/" + encodeURIComponent(igUserId) + "/content_publishing_limit?fields=quota_usage,config",
    accessToken
  );
  const quota = Array.isArray(response.data) ? response.data[0] : response;
  const usage = Number(quota?.quota_usage);
  const total = Number(quota?.config?.quota_total || 50);
  if (Number.isFinite(usage) && Number.isFinite(total) && usage >= total) {
    const error = new Error("Instagram's 24-hour publishing quota is already used. Wait for the quota window to reset.");
    error.statusCode = 429;
    throw error;
  }
}

async function loadApproval(cfg, ownerId, approvalId) {
  const rows = await supabaseRequest(
    cfg,
    "approval_requests?select=id,owner_id,created_by,title,action_type,payload,status,created_at,decided_at,decision_note&id=eq." +
      encodeURIComponent(approvalId) + "&owner_id=eq." + encodeURIComponent(ownerId) +
      "&action_type=eq.instagram_reel_publish&limit=1"
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadPublishJob(cfg, ownerId, approvalId) {
  const rows = await supabaseRequest(
    cfg,
    "instagram_publish_jobs?select=id,approval_request_id,owner_user_id,ig_user_id,video_url,caption,share_to_feed,container_id,media_id,status,error_message,created_at,updated_at,published_at&approval_request_id=eq." +
      encodeURIComponent(approvalId) + "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&limit=1"
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function updatePublishJob(cfg, ownerId, jobId, patch) {
  const rows = await supabaseRequest(
    cfg,
    "instagram_publish_jobs?id=eq." + encodeURIComponent(jobId) +
      "&owner_user_id=eq." + encodeURIComponent(ownerId),
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
    }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function listPublishJobs(cfg, ownerId) {
  const rows = await supabaseRequest(
    cfg,
    "instagram_publish_jobs?select=id,approval_request_id,owner_user_id,ig_user_id,video_url,caption,share_to_feed,container_id,media_id,status,error_message,created_at,updated_at,published_at&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&order=created_at.desc&limit=50"
  );
  return Array.isArray(rows) ? rows : [];
}

export function createInstagramIntegrationHandlers({ env = process.env } = {}) {
  return {
    connectUrl(req, res) {
      try {
        const cfg = config(env);
        const state = createState(req.ownerUser.id, cfg.appSecret);
        const url = new URL(INSTAGRAM_OAUTH_URL);
        url.searchParams.set("client_id", cfg.appId);
        url.searchParams.set("redirect_uri", cfg.redirectUri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
        url.searchParams.set("enable_fb_login", "0");
        url.searchParams.set("force_authentication", "1");
        url.searchParams.set("state", state);
        return res.json({ success: true, authorizationUrl: url.toString() });
      } catch (error) {
        return res.status(503).json({ success: false, error: error.message });
      }
    },

    async callback(req, res) {
      try {
        if (req.query.error) return res.redirect("/?instagram=error");
        const cfg = config(env);
        const state = verifyState(req.query.state, cfg.appSecret);
        const code = String(req.query.code || "");
        if (!code) return res.redirect("/?instagram=error");

        const form = new URLSearchParams({
          client_id: cfg.appId,
          client_secret: cfg.appSecret,
          grant_type: "authorization_code",
          redirect_uri: cfg.redirectUri,
          code
        });
        const shortToken = await responseJson(await fetch(INSTAGRAM_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form
        }), "Instagram authorization code exchange");

        const longUrl = new URL("https://graph.instagram.com/access_token");
        longUrl.searchParams.set("grant_type", "ig_exchange_token");
        longUrl.searchParams.set("client_secret", cfg.appSecret);
        longUrl.searchParams.set("access_token", shortToken.access_token);
        const longToken = await responseJson(await fetch(longUrl), "Instagram long-lived token exchange");

        const profile = await graphGet("/me?fields=user_id,username,account_type", longToken.access_token);
        const accountType = String(profile.account_type || "").toUpperCase();
        if (!["BUSINESS", "CREATOR", "MEDIA_CREATOR"].includes(accountType)) {
          return res.redirect("/?instagram=professional-required");
        }
        await saveConnection(cfg, state.ownerId, profile, longToken.access_token, longToken.expires_in);
        return res.redirect("/?instagram=connected");
      } catch (error) {
        console.error("Instagram OAuth callback failed:", error.message);
        return res.redirect("/?instagram=error");
      }
    },

    async status(req, res) {
      try {
        const cfg = config(env);
        const rows = await loadConnections(cfg, req.ownerUser.id);
        const accounts = [];
        for (const original of rows) {
          try {
            const row = await refreshIfNeeded(cfg, original);
            accounts.push({
              id: row.ig_user_id,
              username: row.username,
              accountType: row.account_type,
              expiresAt: row.expires_at
            });
          } catch {
            accounts.push({
              id: original.ig_user_id,
              username: original.username,
              accountType: original.account_type,
              expiresAt: original.expires_at,
              reconnectRequired: true
            });
          }
        }
        return res.json({ success: true, connected: accounts.length > 0, accounts });
      } catch (error) {
        console.error("Instagram status failed:", error.message);
        return res.status(503).json({ success: false, error: "Instagram connection status is unavailable." });
      }
    },

    async createPublishRequest(req, res) {
      try {
        const cfg = config(env);
        const igUserId = String(req.body?.igUserId || "").trim();
        const videoUrl = String(req.body?.videoUrl || "").trim();
        const caption = String(req.body?.caption || "").trim();
        const shareToFeed = req.body?.shareToFeed !== false;
        const affiliateDisclosureConfirmed = req.body?.affiliateDisclosureConfirmed === true;
        const mediaRightsConfirmed = req.body?.mediaRightsConfirmed === true;
        let parsedUrl;
        try { parsedUrl = new URL(videoUrl); } catch { parsedUrl = null; }
        if (!igUserId) return res.status(400).json({ success: false, error: "Choose a connected Instagram account." });
        if (!parsedUrl || parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
          return res.status(400).json({ success: false, error: "Video URL must be a public HTTPS URL without embedded credentials." });
        }
        if (!caption || caption.length > 2200) {
          return res.status(400).json({ success: false, error: "Enter a Reel caption up to 2,200 characters." });
        }
        if (!affiliateDisclosureConfirmed) {
          return res.status(400).json({ success: false, error: "Confirm that the caption contains a clear affiliate disclosure." });
        }
        if (!mediaRightsConfirmed) {
          return res.status(400).json({ success: false, error: "Confirm that you have publishing rights to the video and audio." });
        }
        const { row } = await accessForAccount(cfg, req.ownerUser.id, igUserId);
        if (!["BUSINESS", "CREATOR", "MEDIA_CREATOR"].includes(String(row.account_type || "").toUpperCase())) {
          return res.status(400).json({ success: false, error: "A connected Instagram Business or Creator account is required." });
        }
        const rows = await supabaseRequest(cfg, "approval_requests", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            owner_id: req.ownerUser.id,
            created_by: req.ownerUser.id,
            title: "Publish Instagram Reel · @" + (row.username || igUserId),
            action_type: "instagram_reel_publish",
            payload: {
              platform: "instagram",
              mediaType: "REELS",
              igUserId,
              username: row.username,
              videoUrl: parsedUrl.toString(),
              caption,
              shareToFeed,
              affiliateDisclosureConfirmed,
              mediaRightsConfirmed
            }
          })
        });
        const approval = Array.isArray(rows) ? rows[0] : null;
        if (!approval) throw new Error("Approval request was not saved.");
        return res.status(201).json({
          success: true,
          approvalRequest: {
            id: approval.id,
            status: approval.status,
            title: approval.title
          },
          message: "Approval request created. No Reel has been uploaded or published."
        });
      } catch (error) {
        console.error("Instagram publish approval request failed:", error.message);
        return res.status(503).json({ success: false, error: "The Instagram publishing approval request could not be created." });
      }
    },

    async listPublishRequests(req, res) {
      try {
        const cfg = config(env);
        const approvals = await supabaseRequest(
          cfg,
          "approval_requests?select=id,title,action_type,payload,status,created_at,decided_at,decision_note&owner_id=eq." +
            encodeURIComponent(req.ownerUser.id) + "&action_type=eq.instagram_reel_publish&order=created_at.desc&limit=50"
        );
        const jobs = await listPublishJobs(cfg, req.ownerUser.id);
        const jobMap = new Map(jobs.map(job => [job.approval_request_id, job]));
        return res.json({
          success: true,
          requests: (Array.isArray(approvals) ? approvals : []).map(approval => ({
            ...approval,
            publishJob: jobMap.get(approval.id) || null
          }))
        });
      } catch (error) {
        console.error("Instagram publish request list failed:", error.message);
        return res.status(503).json({ success: false, error: "Instagram publishing requests are temporarily unavailable." });
      }
    },

    async prepareApprovedReel(req, res) {
      try {
        const cfg = config(env);
        const approval = await loadApproval(cfg, req.ownerUser.id, req.params.id);
        if (!approval) return res.status(404).json({ success: false, error: "Instagram publishing approval was not found." });
        if (approval.status !== "approved") {
          return res.status(409).json({ success: false, error: "The exact Reel request must be approved in the Owner Approval Center before preparation." });
        }
        const existing = await loadPublishJob(cfg, req.ownerUser.id, approval.id);
        if (existing) return res.json({ success: true, publishJob: existing, message: "A publishing job already exists; no duplicate container was created." });
        const payload = approval.payload || {};
        const { accessToken } = await accessForAccount(cfg, req.ownerUser.id, payload.igUserId);
        await assertPublishingQuota(payload.igUserId, accessToken);
        const videoUrl = new URL(String(payload.videoUrl || ""));
        if (videoUrl.protocol !== "https:") throw new Error("Approved video URL is not HTTPS.");
        const reserved = await supabaseRequest(cfg, "instagram_publish_jobs", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            approval_request_id: approval.id,
            owner_user_id: req.ownerUser.id,
            ig_user_id: payload.igUserId,
            video_url: videoUrl.toString(),
            caption: String(payload.caption || ""),
            share_to_feed: payload.shareToFeed !== false,
            status: "preparing"
          })
        });
        const job = Array.isArray(reserved) ? reserved[0] : null;
        if (!job) throw new Error("Could not reserve a single-use publishing job.");
        try {
          const container = await graphPost("/" + encodeURIComponent(payload.igUserId) + "/media", {
            media_type: "REELS",
            video_url: videoUrl.toString(),
            caption: String(payload.caption || ""),
            share_to_feed: payload.shareToFeed === false ? "false" : "true",
            access_token: accessToken
          });
          if (!container.id) throw new Error("Instagram did not return a Reel container ID.");
          const updated = await updatePublishJob(cfg, req.ownerUser.id, job.id, {
            container_id: String(container.id),
            status: "processing",
            error_message: null
          });
          return res.status(201).json({
            success: true,
            publishJob: updated,
            message: "Instagram is processing the approved Reel. Check its status before publishing."
          });
        } catch (error) {
          await updatePublishJob(cfg, req.ownerUser.id, job.id, {
            status: "failed",
            error_message: "Instagram could not prepare this Reel. Review the video URL, account permissions and media format."
          });
          throw error;
        }
      } catch (error) {
        console.error("Instagram Reel preparation failed:", error.message);
        return res.status(error.statusCode || 503).json({
          success: false,
          error: error.statusCode === 429 ? error.message : "The approved Reel could not be prepared."
        });
      }
    },

    async publishStatus(req, res) {
      try {
        const cfg = config(env);
        const approval = await loadApproval(cfg, req.ownerUser.id, req.params.id);
        if (!approval) return res.status(404).json({ success: false, error: "Instagram publishing approval was not found." });
        const job = await loadPublishJob(cfg, req.ownerUser.id, approval.id);
        if (!job) return res.json({ success: true, status: approval.status === "approved" ? "awaiting_preparation" : approval.status, publishJob: null });
        if (job.status !== "processing" || !job.container_id) {
          return res.json({ success: true, status: job.status, publishJob: job });
        }
        const { accessToken } = await accessForAccount(cfg, req.ownerUser.id, job.ig_user_id);
        const container = await graphGet("/" + encodeURIComponent(job.container_id) + "?fields=status_code,status", accessToken);
        let nextStatus = "processing";
        if (container.status_code === "FINISHED") nextStatus = "ready";
        else if (["ERROR", "EXPIRED"].includes(container.status_code)) nextStatus = "failed";
        const updated = nextStatus === job.status ? job : await updatePublishJob(cfg, req.ownerUser.id, job.id, {
          status: nextStatus,
          error_message: nextStatus === "failed" ? "Instagram reported that the Reel container failed or expired." : null
        });
        return res.json({ success: true, status: nextStatus, publishJob: updated, containerStatus: container.status_code || null });
      } catch (error) {
        console.error("Instagram Reel status check failed:", error.message);
        return res.status(503).json({ success: false, error: "Instagram Reel processing status is unavailable." });
      }
    },

    async publishApprovedReel(req, res) {
      try {
        const cfg = config(env);
        const approval = await loadApproval(cfg, req.ownerUser.id, req.params.id);
        if (!approval) return res.status(404).json({ success: false, error: "Instagram publishing approval was not found." });
        if (approval.status !== "approved") {
          return res.status(409).json({ success: false, error: "The exact Reel request is no longer approved." });
        }
        const job = await loadPublishJob(cfg, req.ownerUser.id, approval.id);
        if (!job) return res.status(409).json({ success: false, error: "Prepare the approved Reel and wait for Instagram to finish processing it first." });
        if (job.status === "published") {
          return res.json({ success: true, alreadyPublished: true, mediaId: job.media_id });
        }
        if (job.status !== "ready") {
          return res.status(409).json({ success: false, error: "The Reel is not ready to publish. Current status: " + job.status });
        }
        const { accessToken: quotaAccessToken } = await accessForAccount(cfg, req.ownerUser.id, job.ig_user_id);
        await assertPublishingQuota(job.ig_user_id, quotaAccessToken);
        const reserved = await updatePublishJob(cfg, req.ownerUser.id, job.id, { status: "publishing", error_message: null });
        if (!reserved) return res.status(409).json({ success: false, error: "The Reel publishing job could not be reserved." });
        try {
          const { accessToken } = await accessForAccount(cfg, req.ownerUser.id, job.ig_user_id);
          const published = await graphPost("/" + encodeURIComponent(job.ig_user_id) + "/media_publish", {
            creation_id: job.container_id,
            access_token: accessToken
          });
          if (!published.id) throw new Error("Instagram did not return a published media ID.");
          const updated = await updatePublishJob(cfg, req.ownerUser.id, job.id, {
            status: "published",
            media_id: String(published.id),
            published_at: new Date().toISOString(),
            error_message: null
          });
          return res.json({ success: true, publishJob: updated, mediaId: String(published.id) });
        } catch (error) {
          await updatePublishJob(cfg, req.ownerUser.id, job.id, {
            status: "publish_unknown",
            error_message: "Instagram's final publish result could not be confirmed. Check the account before retrying to avoid duplicate publication."
          });
          throw error;
        }
      } catch (error) {
        console.error("Instagram Reel publish failed:", error.message);
        return res.status(error.statusCode || 503).json({
          success: false,
          error: error.statusCode === 429 ? error.message : "Instagram could not confirm the Reel publication. Check the Instagram account before retrying."
        });
      }
    }
  };
}
