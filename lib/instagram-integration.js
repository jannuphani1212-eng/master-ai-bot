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
        url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publishinging");
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
    }
  };
}
