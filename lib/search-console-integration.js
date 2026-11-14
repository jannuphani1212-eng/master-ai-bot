import {
  createCipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
  createDecipheriv
} from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3";
const PROFILE_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(key + " is not configured on the server.");
  return value;
}

function config(env) {
  const keyHex = String(
    env.SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY || env.YOUTUBE_TOKEN_ENCRYPTION_KEY || ""
  ).trim();
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) {
    throw new Error("Set SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY to 64 hexadecimal characters (or reuse YOUTUBE_TOKEN_ENCRYPTION_KEY).");
  }
  return {
    clientId: required(env, "GOOGLE_SEARCH_CONSOLE_CLIENT_ID"),
    clientSecret: required(env, "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET"),
    redirectUri: required(env, "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI"),
    encryptionKey: Buffer.from(keyHex, "hex"),
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
  if (!ivText || !tagText || !encryptedText) throw new Error("Stored Search Console token is invalid.");
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
  return payload + "." + createHmac("sha256", secret).update(payload).digest("base64url");
}

function verifyState(value, secret) {
  const [payload, signature] = String(value || "").split(".");
  if (!payload || !signature) throw new Error("Search Console OAuth state is invalid.");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("Search Console OAuth state could not be verified.");
  }
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!state.ownerId || !Number.isFinite(state.expiresAt) || state.expiresAt < Date.now()) {
    throw new Error("Search Console OAuth state has expired.");
  }
  return state;
}

async function jsonResponse(response, label) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(label + " failed (" + response.status + ").");
  return data;
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
    throw new Error("Search Console storage request failed (" + response.status + ").");
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function loadConnections(cfg, ownerId) {
  const rows = await supabaseRequest(
    cfg,
    "search_console_connections?select=owner_user_id,google_email,refresh_token_ciphertext,updated_at&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&order=created_at.asc"
  );
  return Array.isArray(rows) ? rows : [];
}

async function refreshAccessToken(cfg, refreshToken) {
  const form = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const token = await jsonResponse(await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  }), "Google access-token refresh");
  if (!token.access_token) throw new Error("Google did not return an access token.");
  return token.access_token;
}

async function getSites(cfg, refreshToken) {
  const accessToken = await refreshAccessToken(cfg, refreshToken);
  const response = await jsonResponse(await fetch(SEARCH_CONSOLE_API + "/sites", {
    headers: { Authorization: "Bearer " + accessToken }
  }), "Search Console sites list");
  return Array.isArray(response.siteEntry) ? response.siteEntry : [];
}

export function createSearchConsoleHandlers({ env = process.env } = {}) {
  return {
    connectUrl(req, res) {
      try {
        const cfg = config(env);
        const url = new URL(AUTH_URL);
        url.searchParams.set("client_id", cfg.clientId);
        url.searchParams.set("redirect_uri", cfg.redirectUri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent select_account");
        url.searchParams.set("include_granted_scopes", "true");
        url.searchParams.set("scope", "openid email " + SEARCH_CONSOLE_SCOPE);
        url.searchParams.set("state", createState(req.ownerUser.id, cfg.clientSecret));
        return res.json({ success: true, authorizationUrl: url.toString() });
      } catch (error) {
        return res.status(503).json({ success: false, error: error.message });
      }
    },

    async callback(req, res) {
      try {
        if (req.query.error) return res.redirect("/?searchConsole=error");
        const cfg = config(env);
        const state = verifyState(req.query.state, cfg.clientSecret);
        const code = String(req.query.code || "");
        if (!code) return res.redirect("/?searchConsole=error");
        const form = new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: "authorization_code"
        });
        const tokens = await jsonResponse(await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form
        }), "Google OAuth code exchange");
        if (!tokens.refresh_token) {
          return res.redirect("/?searchConsole=reauthorize");
        }
        const profileResponse = await jsonResponse(await fetch(PROFILE_URL, {
          headers: { Authorization: "Bearer " + tokens.access_token }
        }), "Google account profile");
        if (!profileResponse.email) return res.redirect("/?searchConsole=error");
        await supabaseRequest(cfg, "search_console_connections?on_conflict=owner_user_id,google_email", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({
            owner_user_id: state.ownerId,
            google_email: profileResponse.email,
            refresh_token_ciphertext: encryptToken(tokens.refresh_token, cfg.encryptionKey),
            updated_at: new Date().toISOString()
          })
        });
        return res.redirect("/?searchConsole=connected");
      } catch (error) {
        console.error("Search Console OAuth callback failed:", error.message);
        return res.redirect("/?searchConsole=error");
      }
    },

    async sites(req, res) {
      try {
        const cfg = config(env);
        const connections = await loadConnections(cfg, req.ownerUser.id);
        const accounts = [];
        for (const connection of connections) {
          try {
            const refreshToken = decryptToken(connection.refresh_token_ciphertext, cfg.encryptionKey);
            const sites = await getSites(cfg, refreshToken);
            accounts.push({
              googleEmail: connection.google_email,
              sites: sites.map(site => ({
                siteUrl: site.siteUrl,
                permissionLevel: site.permissionLevel
              }))
            });
          } catch {
            accounts.push({ googleEmail: connection.google_email, sites: [], reconnectRequired: true });
          }
        }
        return res.json({ success: true, accounts });
      } catch (error) {
        console.error("Search Console sites request failed:", error.message);
        return res.status(503).json({ success: false, error: "Search Console properties are temporarily unavailable." });
      }
    },

    async query(req, res) {
      try {
        const cfg = config(env);
        const siteUrl = String(req.body?.siteUrl || "").trim();
        const googleEmail = String(req.body?.googleEmail || "").trim().toLowerCase();
        const startDate = String(req.body?.startDate || "");
        const endDate = String(req.body?.endDate || "");
        const dimension = String(req.body?.dimension || "query");
        const allowedDimensions = new Set(["query", "page", "country", "device", "date"]);
        const rowLimit = Number(req.body?.rowLimit || 100);
        const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 10) === value;
        if (!siteUrl || siteUrl.length > 2048 || !googleEmail) {
          return res.status(400).json({ success: false, error: "Choose a connected Google account and Search Console property." });
        }
        if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
          return res.status(400).json({ success: false, error: "Choose a valid date range in YYYY-MM-DD format." });
        }
        if (!allowedDimensions.has(dimension)) {
          return res.status(400).json({ success: false, error: "Choose query, page, country, device or date as the report dimension." });
        }
        if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25000) {
          return res.status(400).json({ success: false, error: "Row limit must be between 1 and 25,000." });
        }

        const connections = await loadConnections(cfg, req.ownerUser.id);
        const connection = connections.find(item => item.google_email.toLowerCase() === googleEmail);
        if (!connection) return res.status(404).json({ success: false, error: "That Google account is not connected to this owner." });
        const refreshToken = decryptToken(connection.refresh_token_ciphertext, cfg.encryptionKey);
        const accessToken = await refreshAccessToken(cfg, refreshToken);
        const siteResponse = await jsonResponse(await fetch(SEARCH_CONSOLE_API + "/sites", {
          headers: { Authorization: "Bearer " + accessToken }
        }), "Search Console sites list");
        const site = (siteResponse.siteEntry || []).find(item => item.siteUrl === siteUrl);
        if (!site || site.permissionLevel === "siteUnverifiedUser") {
          return res.status(403).json({ success: false, error: "The selected property is not accessible to this Google account." });
        }
        const queryUrl = SEARCH_CONSOLE_API + "/sites/" + encodeURIComponent(siteUrl) + "/searchAnalytics/query";
        const report = await jsonResponse(await fetch(queryUrl, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + accessToken,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: [dimension],
            rowLimit,
            type: "web",
            dataState: "final"
          })
        }), "Search Console analytics query");
        return res.json({
          success: true,
          siteUrl,
          googleEmail,
          startDate,
          endDate,
          dimension,
          rows: Array.isArray(report.rows) ? report.rows : [],
          responseAggregationType: report.responseAggregationType || null,
          note: "Search Console returns top rows and may not include every query or page."
        });
      } catch (error) {
        console.error("Search Console query failed:", error.message);
        return res.status(503).json({ success: false, error: "Search Console report is temporarily unavailable." });
      }
    }
  };
}
