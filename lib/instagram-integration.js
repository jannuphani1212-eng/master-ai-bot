import crypto from "node:crypto";

const AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const SHORT_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const LONG_TOKEN_URL = "https://graph.instagram.com/access_token";
const REFRESH_TOKEN_URL = "https://graph.instagram.com/refresh_access_token";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(key + " is not configured on the server.");
  return value;
}
function config(env) {
  const keyText = required(env, "INSTAGRAM_TOKEN_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(keyText)) throw new Error("INSTAGRAM_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters.");
  const version = String(env.META_GRAPH_API_VERSION || "v26.0").trim();
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("META_GRAPH_API_VERSION must look like v26.0.");
  return {
    appId: required(env, "INSTAGRAM_APP_ID"),
    appSecret: required(env, "INSTAGRAM_APP_SECRET"),
    redirectUri: required(env, "INSTAGRAM_REDIRECT_URI"),
    supabaseUrl: required(env, "SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    encryptionKey: Buffer.from(keyText, "hex"),
    graphBase: "https://graph.instagram.com/" + version
  };
}
function stateKey(key) {
  return crypto.createHmac("sha256", key).update("master-ai-instagram-oauth-state").digest();
}
function signState(payload, key) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", stateKey(key)).update(encoded).digest("base64url");
  return encoded + "." + signature;
}
function verifyState(value, key) {
  if (typeof value !== "string" || value.length > 2000) throw new Error("Invalid Instagram OAuth state.");
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("Invalid Instagram OAuth state.");
  const expected = crypto.createHmac("sha256", stateKey(key)).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Instagram OAuth state signature is invalid.");
  const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  if (!payload?.ownerId || !Number.isFinite(payload.issuedAt) ||
      Date.now() - payload.issuedAt > 10 * 60 * 1000 || payload.issuedAt > Date.now() + 60_000) {
    throw new Error("Instagram connection request expired. Start again from the dashboard.");
  }
  return payload;
}
function encrypt(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}
function decrypt(value, key) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) throw new Error("Stored Instagram token cannot be decrypted.");
  const [iv, tag, data] = parts.map(part => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
async function json(response) { try { return await response.json(); } catch { return null; } }
async function request(cfg, url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...options, signal: options.signal || AbortSignal.timeout(20000) });
  const data = await json(response);
  if (!response.ok) throw new Error("Instagram API request failed (" + response.status + "): " + String(data?.error?.message || data?.error_description || data?.message || "Unknown error").slice(0, 220));
  return data;
}
async function supabase(cfg, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(cfg.supabaseUrl + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: cfg.serviceKey,
      Authorization: "Bearer " + cfg.serviceKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(20000)
  });
  const data = await json(response);
  if (!response.ok) throw new Error("Instagram token storage failed (" + response.status + ").");
  return data;
}
async function exchangeShortToken(cfg, code, fetchImpl) {
  const body = new URLSearchParams({
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
    code
  });
  const response = await fetchImpl(SHORT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20000)
  });
  const data = await json(response);
  if (!response.ok || !data?.access_token) throw new Error("Instagram authorization-code exchange failed: " + String(data?.error_message || data?.error?.message || response.status).slice(0, 180));
  return data;
}
async function exchangeLongToken(cfg, shortToken, fetchImpl) {
  const url = new URL(LONG_TOKEN_URL);
  url.search = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: cfg.appSecret,
    access_token: shortToken
  }).toString();
  const data = await request(cfg, url.toString(), {}, fetchImpl);
  if (!data?.access_token || !Number.isFinite(Number(data.expires_in))) throw new Error("Instagram did not return a valid long-lived token.");
  return data;
}
async function getProfile(cfg, token, fetchImpl) {
  const url = cfg.graphBase + "/me?" + new URLSearchParams({ fields: "user_id,username,account_type" }).toString();
  const profile = await request(cfg, url, { headers: { Authorization: "Bearer " + token } }, fetchImpl);
  const id = String(profile.user_id || profile.id || "");
  if (!id) throw new Error("Instagram did not return a professional account ID.");
  const type = String(profile.account_type || "UNKNOWN").toUpperCase();
  if (!["BUSINESS", "CREATOR"].includes(type)) throw new Error("Only Instagram professional Business or Creator accounts are supported. Convert the account in Instagram first.");
  return { id, username: String(profile.username || ""), accountType: type };
}
async function saveConnection(cfg, ownerId, profile, token, expiresIn, fetchImpl) {
  const expiresAt = new Date(Date.now() + Number(expiresIn) * 1000).toISOString();
  await supabase(cfg, "instagram_connections?on_conflict=owner_user_id,ig_user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      owner_user_id: ownerId,
      ig_user_id: profile.id,
      username: profile.username,
      account_type: profile.accountType,
      access_token_ciphertext: encrypt(token, cfg.encryptionKey),
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    })
  }, fetchImpl);
  return { igUserId: profile.id, username: profile.username, accountType: profile.accountType, expiresAt };
}
async function refreshConnection(cfg, row, fetchImpl) {
  const token = decrypt(row.access_token_ciphertext, cfg.encryptionKey);
  const updatedAt = Date.parse(row.updated_at || row.created_at || 0);
  const expiresAt = Date.parse(row.expires_at || 0);
  const shouldRefresh = Number.isFinite(expiresAt) && expiresAt - Date.now() < 14 * 24 * 60 * 60 * 1000 &&
    Date.now() - updatedAt > 24 * 60 * 60 * 1000;
  if (!shouldRefresh) return row;
  const url = new URL(REFRESH_TOKEN_URL);
  url.search = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token }).toString();
  const data = await request(cfg, url.toString(), {}, fetchImpl);
  if (!data?.access_token || !Number.isFinite(Number(data.expires_in))) throw new Error("Instagram token refresh did not return a valid token.");
  const updated = await supabase(cfg, "instagram_connections?id=eq." + encodeURIComponent(row.id), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      access_token_ciphertext: encrypt(data.access_token, cfg.encryptionKey),
      expires_at: new Date(Date.now() + Number(data.expires_in) * 1000).toISOString(),
      updated_at: new Date().toISOString()
    })
  }, fetchImpl);
  return Array.isArray(updated) ? updated[0] || row : row;
}

export function createInstagramIntegrationHandlers({ env = process.env, fetchImpl = fetch } = {}) {
  async function connectUrl(req, res) {
    try {
      const cfg = config(env);
      const state = signState({ ownerId: req.ownerUser.id, issuedAt: Date.now(), nonce: crypto.randomBytes(18).toString("base64url") }, cfg.encryptionKey);
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: cfg.appId,
        redirect_uri: cfg.redirectUri,
        response_type: "code",
        scope: "instagram_business_basic",
        state
      }).toString();
      return res.json({ success: true, authorizationUrl: url.toString() });
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message });
    }
  }

  async function callback(req, res) {
    try {
      const cfg = config(env);
      const state = verifyState(String(req.query?.state || ""), cfg.encryptionKey);
      if (req.query?.error) throw new Error("Instagram authorization was cancelled or rejected.");
      const code = String(req.query?.code || "");
      if (!code) throw new Error("Instagram OAuth callback did not include an authorization code.");
      const short = await exchangeShortToken(cfg, code, fetchImpl);
      const long = await exchangeLongToken(cfg, short.access_token, fetchImpl);
      const profile = await getProfile(cfg, long.access_token, fetchImpl);
      await saveConnection(cfg, state.ownerId, profile, long.access_token, long.expires_in, fetchImpl);
      return res.redirect("/?instagramConnection=success");
    } catch (error) {
      console.error("Instagram OAuth callback failed:", error.message);
      return res.redirect("/?instagramConnection=error");
    }
  }

  async function status(req, res) {
    try {
      const cfg = config(env);
      const rows = await supabase(cfg,
        "instagram_connections?select=id,ig_user_id,username,account_type,expires_at,created_at,updated_at&owner_user_id=eq." +
        encodeURIComponent(req.ownerUser.id) + "&order=created_at.asc",
        {}, fetchImpl);
      const accounts = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        try {
          const refreshed = await refreshConnection(cfg, row, fetchImpl);
          accounts.push({
            id: refreshed.ig_user_id,
            username: refreshed.username,
            accountType: refreshed.account_type,
            expiresAt: refreshed.expires_at,
            connected: Date.parse(refreshed.expires_at) > Date.now()
          });
        } catch (error) {
          accounts.push({ id: row.ig_user_id, username: row.username, accountType: row.account_type, expiresAt: row.expires_at, connected: false, error: error.message });
        }
      }
      return res.json({ success: true, accounts });
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message });
    }
  }

  return { connectUrl, callback, status };
}
