import crypto from "node:crypto";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const BLOGGER_API = "https://www.googleapis.com/blogger/v3";
const WPCOM_AUTH = "https://public-api.wordpress.com/oauth2/authorize";
const WPCOM_TOKEN = "https://public-api.wordpress.com/oauth2/token";
const WPCOM_API = "https://public-api.wordpress.com/rest/v1.1";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(key + " is not configured on the server.");
  return value;
}

function config(env) {
  const encryptionHex = String(env.BLOG_CMS_TOKEN_ENCRYPTION_KEY || env.YOUTUBE_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(encryptionHex)) {
    throw new Error("Set BLOG_CMS_TOKEN_ENCRYPTION_KEY to 64 hexadecimal characters, or reuse YOUTUBE_TOKEN_ENCRYPTION_KEY.");
  }
  return {
    key: Buffer.from(encryptionHex, "hex"),
    stateSecret: crypto.createHmac("sha256", Buffer.from(encryptionHex, "hex")).update("master-ai-blog-cms-state").digest(),
    supabaseUrl: required(env, "SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY")
  };
}

function providerConfig(env, provider) {
  if (provider === "blogger") return {
    clientId: required(env, "BLOGGER_CLIENT_ID"),
    clientSecret: required(env, "BLOGGER_CLIENT_SECRET"),
    redirectUri: required(env, "BLOGGER_REDIRECT_URI")
  };
  if (provider === "wordpress") return {
    clientId: required(env, "WORDPRESS_CLIENT_ID"),
    clientSecret: required(env, "WORDPRESS_CLIENT_SECRET"),
    redirectUri: required(env, "WORDPRESS_REDIRECT_URI")
  };
  throw new Error("Choose Blogger or WordPress.com.");
}

function signState(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return encoded + "." + signature;
}

function verifyState(state, secret) {
  if (typeof state !== "string" || state.length > 2000) throw new Error("Invalid CMS connection state.");
  const parts = state.split(".");
  if (parts.length !== 2) throw new Error("Invalid CMS connection state.");
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("CMS connection state signature is invalid.");
  const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  if (!payload?.ownerId || !["blogger", "wordpress"].includes(payload.provider) ||
      !Number.isFinite(payload.issuedAt) || Date.now() - payload.issuedAt > 10 * 60 * 1000 ||
      payload.issuedAt > Date.now() + 60_000) {
    throw new Error("This CMS connection request expired. Start again from the dashboard.");
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
  if (parts.length !== 3) throw new Error("Stored CMS token cannot be decrypted.");
  const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

async function db(cfg, path, options = {}) {
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
    throw new Error("Blog CMS storage failed (" + response.status + "): " + detail.slice(0, 220));
  }
  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

async function apiJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      ...(options.body ? { "Content-Type": options.contentType || "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || data?.error_description || data?.error || "CMS API request failed (" + response.status + ").");
  return data;
}

function markdownHtml(markdown) {
  const escape = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return String(markdown || "").split(/\r?\n/).map(line => {
    const value = line.trim();
    if (!value) return "";
    const heading = value.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      return "<h" + level + ">" + escape(heading[2]) + "</h" + level + ">";
    }
    if (/^[-*]\s+/.test(value)) return "<p>• " + escape(value.replace(/^[-*]\s+/, "")) + "</p>";
    return "<p>" + escape(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") + "</p>";
  }).filter(Boolean).join("\n");
}

async function saveSite(cfg, ownerId, provider, site, accessToken, refreshToken) {
  const body = {
    owner_user_id: ownerId,
    provider,
    site_id: String(site.id),
    site_name: String(site.name || site.url || site.host || provider),
    site_url: site.url || null,
    access_token_ciphertext: encrypt(accessToken, cfg.key),
    refresh_token_ciphertext: refreshToken ? encrypt(refreshToken, cfg.key) : null,
    selected: false,
    updated_at: new Date().toISOString()
  };
  await db(cfg, "blog_cms_connections?on_conflict=owner_user_id,provider,site_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body)
  });
}

async function refreshBlogger(cfg, env, row) {
  if (!row.refresh_token_ciphertext) throw new Error("Blogger needs a refresh token. Disconnect and reconnect Blogger with consent.");
  const form = new URLSearchParams({
    client_id: required(env, "BLOGGER_CLIENT_ID"),
    client_secret: required(env, "BLOGGER_CLIENT_SECRET"),
    refresh_token: decrypt(row.refresh_token_ciphertext, cfg.key),
    grant_type: "refresh_token"
  });
  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Blogger authorization expired. Reconnect Blogger.");
  return data.access_token;
}

async function loadDraft(cfg, ownerId, draftId) {
  const rows = await db(cfg, "blog_drafts?select=id,topic,content_json,status&owner_user_id=eq." +
    encodeURIComponent(ownerId) + "&id=eq." + encodeURIComponent(draftId) + "&limit=1");
  return Array.isArray(rows) ? rows[0] || null : null;
}

export function createBlogCmsHandlers({ env = process.env } = {}) {
  return {
    connectUrl(req, res) {
      try {
        const provider = String(req.params.provider || "");
        const base = config(env);
        const oauth = providerConfig(env, provider);
        const state = signState({
          ownerId: req.ownerUser.id,
          provider,
          issuedAt: Date.now(),
          nonce: crypto.randomBytes(18).toString("base64url")
        }, base.stateSecret);
        const url = new URL(provider === "blogger" ? GOOGLE_AUTH : WPCOM_AUTH);
        const params = {
          client_id: oauth.clientId,
          redirect_uri: oauth.redirectUri,
          response_type: "code",
          state
        };
        if (provider === "blogger") {
          params.scope = "https://www.googleapis.com/auth/blogger";
          params.access_type = "offline";
          params.prompt = "consent select_account";
          params.include_granted_scopes = "true";
        } else {
          params.scope = "posts,sites";
        }
        url.search = new URLSearchParams(params).toString();
        return res.json({ success: true, authorizationUrl: url.toString() });
      } catch (error) {
        return res.status(503).json({ success: false, error: error.message });
      }
    },

    async callback(req, res) {
      try {
        if (req.query.error) throw new Error("CMS authorization was not completed.");
        const base = config(env);
        const state = verifyState(req.query.state, base.stateSecret);
        const provider = state.provider;
        const oauth = providerConfig(env, provider);
        const code = String(req.query.code || "");
        if (!code || code.length > 4096) throw new Error("The CMS did not return a valid authorization code.");
        const form = new URLSearchParams({
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          code,
          redirect_uri: oauth.redirectUri,
          grant_type: "authorization_code"
        });
        const tokenResponse = await fetch(provider === "blogger" ? GOOGLE_TOKEN : WPCOM_TOKEN, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form
        });
        const tokens = await tokenResponse.json().catch(() => ({}));
        if (!tokenResponse.ok || !tokens.access_token) throw new Error(tokens.error_description || tokens.error || "The CMS did not return an access token.");
        if (provider === "blogger" && !tokens.refresh_token) throw new Error("Google did not return offline access. Reconnect Blogger and approve consent.");
        let sites = [];
        if (provider === "blogger") {
          const data = await apiJson(BLOGGER_API + "/users/self/blogs?fetchUserInfo=false", tokens.access_token);
          sites = (data.items || []).map(item => ({ id: item.id, name: item.name, url: item.url }));
        } else {
          const data = await apiJson(WPCOM_API + "/me/sites", tokens.access_token);
          sites = (data.sites || []).map(item => ({ id: item.ID, name: item.name || item.title, url: item.URL || item.url }));
        }
        if (!sites.length) throw new Error("No blogs or sites were found for this account.");
        for (const site of sites) await saveSite(base, state.ownerId, provider, site, tokens.access_token, tokens.refresh_token || null);
        const first = sites[0];
        await db(base, "blog_cms_connections?owner_user_id=eq." + encodeURIComponent(state.ownerId) +
          "&provider=eq." + provider, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ selected: false })
        });
        await db(base, "blog_cms_connections?owner_user_id=eq." + encodeURIComponent(state.ownerId) +
          "&provider=eq." + provider + "&site_id=eq." + encodeURIComponent(String(first.id)), {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ selected: true, updated_at: new Date().toISOString() })
        });
        return res.redirect("/?blogcms=" + provider + "-connected");
      } catch (error) {
        console.error("Blog CMS OAuth callback failed:", error.message);
        return res.redirect("/?blogcms=error");
      }
    },

    async connections(req, res) {
      try {
        const base = config(env);
        const rows = await db(base, "blog_cms_connections?select=provider,site_id,site_name,site_url,selected,updated_at&owner_user_id=eq." +
          encodeURIComponent(req.ownerUser.id) + "&order=provider.asc,site_name.asc");
        return res.json({ success: true, connections: Array.isArray(rows) ? rows : [] });
      } catch (error) {
        return res.status(503).json({ success: false, error: error.message });
      }
    },

    async selectSite(req, res) {
      try {
        const provider = String(req.params.provider || "");
        if (!["blogger", "wordpress"].includes(provider)) return res.status(400).json({ success: false, error: "Choose Blogger or WordPress.com." });
        const siteId = String(req.body?.siteId || "").trim();
        if (!siteId || siteId.length > 180) return res.status(400).json({ success: false, error: "Choose a valid blog or site." });
        const base = config(env);
        const owned = await db(base, "blog_cms_connections?select=site_id&owner_user_id=eq." +
          encodeURIComponent(req.ownerUser.id) + "&provider=eq." + provider + "&site_id=eq." + encodeURIComponent(siteId) + "&limit=1");
        if (!Array.isArray(owned) || !owned.length) return res.status(404).json({ success: false, error: "That site is not connected to your account." });
        await db(base, "blog_cms_connections?owner_user_id=eq." + encodeURIComponent(req.ownerUser.id) + "&provider=eq." + provider, {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ selected: false })
        });
        await db(base, "blog_cms_connections?owner_user_id=eq." + encodeURIComponent(req.ownerUser.id) + "&provider=eq." + provider + "&site_id=eq." + encodeURIComponent(siteId), {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ selected: true, updated_at: new Date().toISOString() })
        });
        return res.json({ success: true, message: "Publishing destination selected. New content will still be saved as a draft." });
      } catch (error) {
        return res.status(503).json({ success: false, error: "Could not select that blog or site." });
      }
    },

    async saveDraft(req, res) {
      try {
        const id = String(req.params.id || "");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          return res.status(400).json({ success: false, error: "Invalid blog draft ID." });
        }
        const requested = Array.isArray(req.body?.providers) ? req.body.providers : [];
        const providers = [...new Set(requested)].filter(item => ["blogger", "wordpress"].includes(item));
        if (!providers.length || providers.length !== new Set(requested).size) {
          return res.status(400).json({ success: false, error: "Select Blogger, WordPress.com, or both." });
        }
        const base = config(env);
        const draft = await loadDraft(base, req.ownerUser.id, id);
        if (!draft) return res.status(404).json({ success: false, error: "Blog draft not found for this owner." });
        const content = draft.content_json || {};
        const title = String(content.title || draft.topic || "Untitled article").slice(0, 180);
        const html = markdownHtml(content.articleMarkdown || "");
        if (html.replace(/<[^>]+>/g, "").trim().length < 100) return res.status(400).json({ success: false, error: "The article content is too short to send to a CMS." });
        const results = [];
        for (const provider of providers) {
          const existing = await db(base, "blog_cms_publications?select=id,remote_post_id,remote_url,status&owner_user_id=eq." +
            encodeURIComponent(req.ownerUser.id) + "&draft_id=eq." + encodeURIComponent(id) + "&provider=eq." + provider + "&limit=1");
          if (Array.isArray(existing) && existing.length) {
            results.push({ provider, alreadySaved: true, publication: existing[0] });
            continue;
          }
          const rows = await db(base, "blog_cms_connections?select=site_id,site_name,site_url,access_token_ciphertext,refresh_token_ciphertext&owner_user_id=eq." +
            encodeURIComponent(req.ownerUser.id) + "&provider=eq." + provider + "&selected=eq.true&limit=1");
          const connection = Array.isArray(rows) ? rows[0] : null;
          if (!connection) {
            results.push({ provider, success: false, error: "Connect and select a " + (provider === "blogger" ? "Blogger blog" : "WordPress.com site") + " first." });
            continue;
          }
          let accessToken = decrypt(connection.access_token_ciphertext, base.key);
          if (provider === "blogger") accessToken = await refreshBlogger(base, env, connection);
          let remote;
          if (provider === "blogger") {
            remote = await apiJson(BLOGGER_API + "/blogs/" + encodeURIComponent(connection.site_id) + "/posts?isDraft=true", accessToken, {
              method: "POST",
              body: JSON.stringify({ kind: "blogger#post", title, content: html })
            });
          } else {
            const form = new URLSearchParams({
              title,
              content: html,
              status: "draft",
              excerpt: String(content.excerpt || "").slice(0, 500),
              slug: String(content.slug || "").slice(0, 180)
            });
            remote = await apiJson(WPCOM_API + "/sites/" + encodeURIComponent(connection.site_id) + "/posts/new", accessToken, {
              method: "POST",
              body: form.toString(),
              contentType: "application/x-www-form-urlencoded"
            });
          }
          const remoteId = String(remote.id || remote.ID || "");
          if (!remoteId) throw new Error("The CMS did not return a post ID.");
          const saved = await db(base, "blog_cms_publications", {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify([{
              owner_user_id: req.ownerUser.id,
              draft_id: id,
              provider,
              site_id: connection.site_id,
              remote_post_id: remoteId,
              remote_url: remote.url || remote.URL || null,
              status: "draft",
              updated_at: new Date().toISOString()
            }])
          });
          results.push({ provider, success: true, publication: Array.isArray(saved) ? saved[0] : null });
        }
        return res.json({ success: true, results, message: "CMS copies are saved as drafts only. Nothing has been published." });
      } catch (error) {
        console.error("Blog CMS draft save failed:", error.message);
        return res.status(502).json({ success: false, error: error.message });
      }
    }
  };
}
