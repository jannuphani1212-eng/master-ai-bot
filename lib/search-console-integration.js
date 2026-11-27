import crypto from "node:crypto";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
const TABLE = "search_console_connections";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(key + " is not configured on the server.");
  return value;
}

function config(env) {
  const encryptionValue = required(env, "SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(encryptionValue)) {
    throw new Error("SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters.");
  }
  return {
    clientId: required(env, "YOUTUBE_CLIENT_ID"),
    clientSecret: required(env, "YOUTUBE_CLIENT_SECRET"),
    redirectUri: required(env, "SEARCH_CONSOLE_REDIRECT_URI"),
    supabaseUrl: required(env, "SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    encryptionKey: Buffer.from(encryptionValue, "hex")
  };
}

function stateSecret(key) {
  return crypto.createHmac("sha256", key).update("master-ai-search-console-oauth-state").digest();
}

function signState(payload, key) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", stateSecret(key)).update(encoded).digest("base64url");
  return encoded + "." + signature;
}

function verifyState(value, key, now = Date.now()) {
  if (typeof value !== "string" || value.length > 2000) throw new Error("Invalid Search Console OAuth state.");
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("Invalid Search Console OAuth state.");
  const expected = crypto.createHmac("sha256", stateSecret(key)).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("Search Console OAuth state signature is invalid.");
  }
  const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  if (!UUID.test(String(payload?.ownerId || "")) ||
      !Number.isFinite(payload.issuedAt) || now - payload.issuedAt > 10 * 60 * 1000 ||
      payload.issuedAt > now + 60_000) {
    throw new Error("Search Console connection request expired. Start again from the SEO workspace.");
  }
  return payload;
}

function encryptToken(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

function decryptToken(value, key) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) throw new Error("Stored Search Console token cannot be decrypted.");
  const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

async function supabaseRequest(cfg, path, options = {}, fetchImpl = fetch) {
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
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error("Search Console token storage failed (" + response.status + "): " +
      String(data?.message || data?.error_description || JSON.stringify(data || {})).slice(0, 220));
  }
  return data;
}

async function exchangeCode(cfg, code, fetchImpl) {
  const response = await fetchImpl(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code"
    }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await readJson(response);
  if (!response.ok || !data?.access_token) {
    throw new Error("Search Console token exchange failed: " +
      String(data?.error_description || data?.error || response.status).slice(0, 180));
  }
  return data;
}

async function refreshAccessToken(cfg, refreshToken, fetchImpl) {
  const response = await fetchImpl(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await readJson(response);
  if (!response.ok || !data?.access_token) {
    throw new Error("Search Console access-token refresh failed: " +
      String(data?.error_description || data?.error || response.status).slice(0, 180));
  }
  return data.access_token;
}

async function googleJson(url, accessToken, fetchImpl, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: { Authorization: "Bearer " + accessToken, ...(options.headers || {}) },
    signal: AbortSignal.timeout(20000)
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error("Google Search Console API (" + response.status + "): " +
      String(data?.error?.message || data?.error_description || response.status).slice(0, 220));
  }
  return data || {};
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function createSearchConsoleHandlers({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  async function getConnection(ownerId) {
    if (!UUID.test(String(ownerId || ""))) throw new Error("Owner authentication is required.");
    const cfg = config(env);
    const rows = await supabaseRequest(cfg, TABLE + "?select=id,owner_user_id,google_email,refresh_token_ciphertext,updated_at&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&limit=1", {}, fetchImpl);
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? { cfg, row, refreshToken: decryptToken(row.refresh_token_ciphertext, cfg.encryptionKey) } : { cfg, row: null };
  }

  async function accessForOwner(ownerId) {
    const connection = await getConnection(ownerId);
    if (!connection.row) return null;
    const accessToken = await refreshAccessToken(connection.cfg, connection.refreshToken, fetchImpl);
    return { ...connection, accessToken };
  }

  async function connectUrl(req, res) {
    try {
      const cfg = config(env);
      const ownerId = req.ownerUser?.id;
      if (!UUID.test(String(ownerId || ""))) return res.status(401).json({ success: false, error: "Owner sign-in is required." });
      const state = signState({ ownerId, issuedAt: now() }, cfg.encryptionKey);
      const url = new URL(GOOGLE_AUTH);
      url.searchParams.set("client_id", cfg.clientId);
      url.searchParams.set("redirect_uri", cfg.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email " + SCOPE);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("include_granted_scopes", "true");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      return res.json({ success: true, url: url.toString() });
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message });
    }
  }

  async function callback(req, res) {
    try {
      const cfg = config(env);
      if (req.query?.error) throw new Error("Google did not grant Search Console access. Return to the SEO workspace and try again.");
      const state = verifyState(req.query?.state, cfg.encryptionKey, now());
      const code = String(req.query?.code || "").trim();
      if (!code) throw new Error("Google did not return an authorization code.");
      const token = await exchangeCode(cfg, code, fetchImpl);
      let refreshToken = String(token.refresh_token || "");
      if (!refreshToken) {
        const existing = await supabaseRequest(cfg, TABLE + "?select=refresh_token_ciphertext&owner_user_id=eq." +
          encodeURIComponent(state.ownerId) + "&limit=1", {}, fetchImpl);
        if (Array.isArray(existing) && existing[0]?.refresh_token_ciphertext) {
          refreshToken = decryptToken(existing[0].refresh_token_ciphertext, cfg.encryptionKey);
        }
      }
      if (!refreshToken) throw new Error("Google did not issue a refresh token. Reconnect and approve offline access.");
      const profile = await googleJson(GOOGLE_USERINFO, token.access_token, fetchImpl);
      const email = String(profile.email || "").trim().slice(0, 254);
      if (!email) throw new Error("Google did not return an account email for this connection.");
      const existing = await supabaseRequest(cfg, TABLE + "?select=id&owner_user_id=eq." +
        encodeURIComponent(state.ownerId) + "&limit=1", {}, fetchImpl);
      const body = {
        owner_user_id: state.ownerId,
        google_email: email,
        refresh_token_ciphertext: encryptToken(refreshToken, cfg.encryptionKey),
        updated_at: new Date(now()).toISOString()
      };
      if (Array.isArray(existing) && existing[0]?.id) {
        await supabaseRequest(cfg, TABLE + "?id=eq." + encodeURIComponent(existing[0].id), {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body)
        }, fetchImpl);
      } else {
        await supabaseRequest(cfg, TABLE, {
          method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body)
        }, fetchImpl);
      }
      return res.redirect("/?searchConsole=connected");
    } catch (error) {
      console.error("Search Console OAuth callback failed:", error.message);
      return res.redirect("/?searchConsole=error");
    }
  }

  async function status(req, res) {
    try {
      const connection = await accessForOwner(req.ownerUser?.id);
      if (!connection) return res.json({ success: true, connected: false, properties: [] });
      const data = await googleJson(SEARCH_CONSOLE_API + "/sites", connection.accessToken, fetchImpl);
      const properties = (Array.isArray(data.siteEntry) ? data.siteEntry : []).map(site => ({
        siteUrl: String(site.siteUrl || "").slice(0, 500),
        permissionLevel: String(site.permissionLevel || "unknown").slice(0, 80)
      }));
      return res.json({
        success: true,
        connected: true,
        googleEmail: connection.row.google_email,
        properties,
        propertyCount: properties.length
      });
    } catch (error) {
      return res.status(503).json({ success: false, connected: false, error: error.message });
    }
  }

  async function sites(req, res) {
    return status(req, res);
  }

  async function analytics(req, res) {
    try {
      const siteUrl = String(req.body?.siteUrl || "").trim();
      const startDate = String(req.body?.startDate || "").trim();
      const endDate = String(req.body?.endDate || "").trim();
      if (!siteUrl || siteUrl.length > 500 || !validDate(startDate) || !validDate(endDate) || startDate > endDate) {
        return res.status(400).json({ success: false, error: "Choose a valid Search Console property and date range." });
      }
      const start = new Date(startDate + "T00:00:00Z");
      const end = new Date(endDate + "T00:00:00Z");
      if ((end.getTime() - start.getTime()) / 86400000 > 90) {
        return res.status(400).json({ success: false, error: "Search Console queries are limited to a 90-day window." });
      }
      const connection = await accessForOwner(req.ownerUser?.id);
      if (!connection) return res.status(409).json({ success: false, error: "Connect Google Search Console first." });
      const sitesData = await googleJson(SEARCH_CONSOLE_API + "/sites", connection.accessToken, fetchImpl);
      const properties = Array.isArray(sitesData.siteEntry) ? sitesData.siteEntry : [];
      if (!properties.some(site => site.siteUrl === siteUrl)) {
        return res.status(403).json({ success: false, error: "That property is not available to the connected Google account." });
      }
      const url = SEARCH_CONSOLE_API + "/sites/" + encodeURIComponent(siteUrl) + "/searchAnalytics/query";
      const data = await googleJson(url, connection.accessToken, fetchImpl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ["query", "page", "country", "device"],
          type: "web",
          rowLimit: 1000,
          dataState: "final"
        })
      });
      return res.json({
        success: true,
        verified: true,
        siteUrl,
        startDate,
        endDate,
        rows: Array.isArray(data.rows) ? data.rows : []
      });
    } catch (error) {
      return res.status(503).json({ success: false, verified: false, error: error.message });
    }
  }

  return { connectUrl, callback, status, sites, analytics };
}
