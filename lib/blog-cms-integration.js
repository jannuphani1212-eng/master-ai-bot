import crypto from "node:crypto";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const BLOGGER_API = "https://www.googleapis.com/blogger/v3";
const WORDPRESS_AUTH = "https://public-api.wordpress.com/oauth2/authorize";
const WORDPRESS_TOKEN = "https://public-api.wordpress.com/oauth2/token";
const WORDPRESS_API = "https://public-api.wordpress.com/rest/v1.1";

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(key + " is not configured on the server.");
  return value;
}
function tokenKey(env) {
  const value = required(env, "BLOG_CMS_TOKEN_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("BLOG_CMS_TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters.");
  return Buffer.from(value, "hex");
}
function providerConfig(env, provider) {
  const common = {
    supabaseUrl: required(env, "SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    encryptionKey: tokenKey(env)
  };
  if (provider === "blogger") return {
    ...common,
    clientId: String(env.BLOGGER_CLIENT_ID || env.YOUTUBE_CLIENT_ID || "").trim(),
    clientSecret: String(env.BLOGGER_CLIENT_SECRET || env.YOUTUBE_CLIENT_SECRET || "").trim(),
    redirectUri: required(env, "BLOGGER_REDIRECT_URI")
  };
  if (provider === "wordpress") return {
    ...common,
    clientId: required(env, "WORDPRESS_CLIENT_ID"),
    clientSecret: required(env, "WORDPRESS_CLIENT_SECRET"),
    redirectUri: required(env, "WORDPRESS_REDIRECT_URI")
  };
  throw new Error("Choose Blogger or WordPress.com.");
}
function stateSecret(key) {
  return crypto.createHmac("sha256", key).update("master-ai-blog-cms-oauth-state").digest();
}
function signState(payload, key) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", stateSecret(key)).update(encoded).digest("base64url");
  return encoded + "." + signature;
}
function verifyState(value, key) {
  if (typeof value !== "string" || value.length > 2000) throw new Error("Invalid CMS OAuth state.");
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("Invalid CMS OAuth state.");
  const expected = crypto.createHmac("sha256", stateSecret(key)).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("CMS OAuth state signature is invalid.");
  const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  if (!payload?.ownerId || !["blogger", "wordpress"].includes(payload.provider) ||
      !Number.isFinite(payload.issuedAt) || Date.now() - payload.issuedAt > 30 * 60 * 1000 ||
      payload.issuedAt > Date.now() + 60_000) throw new Error("CMS connection request expired. Start again from the dashboard.");
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
  const [iv, tag, data] = parts.map(part => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const out = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) out.push("<p>" + paragraph.map(escapeHtml).join("<br>") + "</p>");
    paragraph = [];
  };
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(3, heading[1].length);
      out.push("<h" + level + ">" + escapeHtml(heading[2]) + "</h" + level + ">");
    } else if (bullet) {
      flush();
      out.push("<p>• " + escapeHtml(bullet[1]) + "</p>");
    } else if (!line.trim()) flush();
    else paragraph.push(line.trim());
  }
  flush();
  return out.join("\n");
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
  const data = await readJson(response);
  if (!response.ok) {
    const detail = data?.message || data?.error_description || JSON.stringify(data || {});
    throw new Error("CMS storage request failed (" + response.status + "): " + String(detail).slice(0, 220));
  }
  return data;
}
async function exchangeToken(cfg, provider, code, fetchImpl) {
  const url = provider === "blogger" ? GOOGLE_TOKEN : WORDPRESS_TOKEN;
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code"
  });
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20000)
  });
  const data = await readJson(response);
  if (!response.ok || !data?.access_token) throw new Error("CMS token exchange failed: " + String(data?.error_description || data?.error || response.status).slice(0, 180));
  return data;
}
async function discoverSites(provider, accessToken, fetchImpl) {
  const url = provider === "blogger"
    ? BLOGGER_API + "/users/self/blogs"
    : WORDPRESS_API + "/me/sites";
  const response = await fetchImpl(url, {
    headers: { Authorization: "Bearer " + accessToken },
    signal: AbortSignal.timeout(20000)
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error("Could not list " + provider + " sites: " + String(data?.error?.message || data?.message || response.status).slice(0, 180));
  const sites = provider === "blogger" ? data?.items || [] : data?.sites || [];
  return sites.map(site => ({
    id: String(provider === "blogger" ? site.id : site.ID),
    name: String(site.name || site.title || "Blog site").slice(0, 180),
    url: String(site.url || site.URL || "")
  })).filter(site => site.id);
}
async function saveSites(cfg, ownerId, provider, sites, tokens, fetchImpl) {
  await supabase(cfg, "blog_cms_connections?owner_user_id=eq." + encodeURIComponent(ownerId) +
    "&provider=eq." + encodeURIComponent(provider), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ selected: false, updated_at: new Date().toISOString() })
    }, fetchImpl);
  for (let index = 0; index < sites.length; index += 1) {
    const site = sites[index];
    const row = {
      owner_user_id: ownerId,
      provider,
      site_id: site.id,
      site_name: site.name,
      site_url: site.url || null,
      access_token_ciphertext: encrypt(tokens.access_token, cfg.encryptionKey),
      refresh_token_ciphertext: tokens.refresh_token ? encrypt(tokens.refresh_token, cfg.encryptionKey) : null,
      selected: index === 0,
      updated_at: new Date().toISOString()
    };
    await supabase(cfg, "blog_cms_connections?on_conflict=owner_user_id,provider,site_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row)
    }, fetchImpl);
  }
}
export function getBlogDraftContent(row) {
  if (!row || typeof row !== "object") throw new Error("Blog draft was not found for this owner.");
  const content = row.content_json && typeof row.content_json === "object" ? row.content_json : {};
  // Daily Blogging saves the publishable body as "article" and the complete
  // editorial report as "fullReport". Support those canonical fields first.
  const report = String(content.article || content.fullReport || content.report || content.content || "").trim();
  if (!report) throw new Error("The saved blog draft has no article content.");
  return { title: String(content.title || row.topic || "Untitled article").slice(0, 180), html: markdownToHtml(report) };
}

async function getDraft(cfg, ownerId, draftId, fetchImpl) {
  const rows = await supabase(cfg,
    "blog_drafts?select=id,topic,content_json&owner_user_id=eq." + encodeURIComponent(ownerId) +
    "&id=eq." + encodeURIComponent(draftId) + "&limit=1", {}, fetchImpl);
  if (!Array.isArray(rows) || !rows[0]) throw new Error("Blog draft was not found for this owner.");
  return getBlogDraftContent(rows[0]);
}
async function getConnection(cfg, ownerId, provider, siteId, fetchImpl) {
  const rows = await supabase(cfg,
    "blog_cms_connections?select=id,site_id,site_name,site_url,access_token_ciphertext,refresh_token_ciphertext&owner_user_id=eq." +
    encodeURIComponent(ownerId) + "&provider=eq." + encodeURIComponent(provider) +
    "&site_id=eq." + encodeURIComponent(siteId) + "&limit=1", {}, fetchImpl);
  if (!Array.isArray(rows) || !rows[0]) throw new Error("That blog site is not connected to this owner account.");
  return rows[0];
}
async function getUsableAccessToken(cfg, provider, connection, fetchImpl) {
  if (provider !== "blogger" || !connection.refresh_token_ciphertext) {
    return decrypt(connection.access_token_ciphertext, cfg.encryptionKey);
  }
  const refreshToken = decrypt(connection.refresh_token_ciphertext, cfg.encryptionKey);
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
  if (!response.ok || !data?.access_token) throw new Error("Blogger token refresh failed. Reconnect the Blogger account.");
  await supabase(cfg, "blog_cms_connections?id=eq." + encodeURIComponent(connection.id), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      access_token_ciphertext: encrypt(data.access_token, cfg.encryptionKey),
      ...(data.refresh_token ? { refresh_token_ciphertext: encrypt(data.refresh_token, cfg.encryptionKey) } : {}),
      updated_at: new Date().toISOString()
    })
  }, fetchImpl);
  return data.access_token;
}

async function createRemoteDraft(provider, siteId, accessToken, draft, fetchImpl) {
  const url = provider === "blogger"
    ? BLOGGER_API + "/blogs/" + encodeURIComponent(siteId) + "/posts/?isDraft=true"
    : WORDPRESS_API + "/sites/" + encodeURIComponent(siteId) + "/posts/new";
  const body = provider === "blogger"
    ? { kind: "blogger#post", title: draft.title, content: draft.html }
    : new URLSearchParams({ title: draft.title, content: draft.html, status: "draft" });
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      ...(provider === "blogger" ? { "Content-Type": "application/json" } : { "Content-Type": "application/x-www-form-urlencoded" })
    },
    body: provider === "blogger" ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(30000)
  });
  const data = await readJson(response);
  if (!response.ok || !data?.id) throw new Error(provider + " remote draft creation failed: " + String(data?.error?.message || data?.message || response.status).slice(0, 180));
  return { id: String(data.id), url: String(data.url || data.URL || "") };
}

export function createBlogCmsHandlers({ env = process.env, fetchImpl = fetch } = {}) {
  async function connectUrl(req, res) {
    try {
      const provider = String(req.query?.provider || "").toLowerCase();
      const cfg = providerConfig(env, provider);
      if (!cfg.clientId || !cfg.clientSecret) throw new Error(provider.toUpperCase() + " OAuth client credentials are missing.");
      const state = signState({ ownerId: req.ownerUser.id, provider, issuedAt: Date.now(), nonce: crypto.randomBytes(18).toString("base64url") }, cfg.encryptionKey);
      const url = new URL(provider === "blogger" ? GOOGLE_AUTH : WORDPRESS_AUTH);
      const params = {
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: "code",
        scope: provider === "blogger" ? "https://www.googleapis.com/auth/blogger" : "sites,posts",
        state
      };
      if (provider === "blogger") {
        params.access_type = "offline";
        params.prompt = "consent select_account";
      } else {
        params.blog = "true";
      }
      url.search = new URLSearchParams(params).toString();
      return res.json({ success: true, provider, authorizationUrl: url.toString() });
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message });
    }
  }

  async function callback(req, res) {
    try {
      const rawState = String(req.query?.state || "");
      // Verify the signed state before trusting its provider field. This also
      // turns malformed/empty callback state into a controlled OAuth error.
      const state = verifyState(rawState, tokenKey(env));
      const provider = state.provider;
      const cfg = providerConfig(env, provider);
      if (req.query?.error) throw new Error("The owner cancelled or the CMS provider rejected access.");
      const code = String(req.query?.code || "");
      if (!code) throw new Error("CMS OAuth callback did not include an authorization code.");
      const tokens = await exchangeToken(cfg, provider, code, fetchImpl);
      const sites = await discoverSites(provider, tokens.access_token, fetchImpl);
      if (!sites.length) throw new Error("No Blogger or WordPress.com sites were returned for this account.");
      await saveSites(cfg, state.ownerId, provider, sites, tokens, fetchImpl);
      return res.redirect("/?blogConnection=success&provider=" + encodeURIComponent(provider));
    } catch (error) {
      console.error("Blog CMS OAuth callback failed:", error.message);
      return res.redirect("/?blogConnection=error");
    }
  }

  async function status(req, res) {
    try {
      const provider = String(req.query?.provider || "").toLowerCase();
      const cfg = providerConfig(env, provider);
      const rows = await supabase(cfg,
        "blog_cms_connections?select=id,provider,site_id,site_name,site_url,selected,created_at,updated_at&owner_user_id=eq." +
        encodeURIComponent(req.ownerUser.id) + "&provider=eq." + encodeURIComponent(provider) + "&order=created_at.asc",
        {}, fetchImpl);
      return res.json({ success: true, provider, sites: Array.isArray(rows) ? rows : [] });
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message });
    }
  }

  async function createRemoteCmsDraft({ ownerId, provider, siteId, draftId }) {
    if (!ownerId || !["blogger", "wordpress"].includes(provider) || !siteId || !draftId) {
      throw new Error("Owner, provider, site ID and saved draft ID are required.");
    }
    const cfg = providerConfig(env, provider);
    const existing = await supabase(cfg,
      "blog_cms_publications?select=id,remote_post_id,remote_url,status&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&draft_id=eq." + encodeURIComponent(draftId) +
      "&provider=eq." + encodeURIComponent(provider) + "&limit=1", {}, fetchImpl);
    if (Array.isArray(existing) && existing[0]) {
      return { success: true, alreadyCreated: true, publication: existing[0] };
    }
    const [connection, draft] = await Promise.all([
      getConnection(cfg, ownerId, provider, siteId, fetchImpl),
      getDraft(cfg, ownerId, draftId, fetchImpl)
    ]);
    const accessToken = await getUsableAccessToken(cfg, provider, connection, fetchImpl);
    const remote = await createRemoteDraft(provider, siteId, accessToken, draft, fetchImpl);
    const saved = await supabase(cfg, "blog_cms_publications?on_conflict=owner_user_id,draft_id,provider", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({
        owner_user_id: ownerId,
        draft_id: draftId,
        provider,
        site_id: siteId,
        remote_post_id: remote.id,
        remote_url: remote.url || null,
        status: "draft"
      })
    }, fetchImpl);
    if (Array.isArray(saved) && saved[0]) {
      return { success: true, alreadyCreated: false, publication: saved[0], remoteDraft: remote };
    }
    // A concurrent worker may have inserted the idempotency record first.
    const reconciled = await supabase(cfg,
      "blog_cms_publications?select=id,remote_post_id,remote_url,status&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&draft_id=eq." + encodeURIComponent(draftId) +
      "&provider=eq." + encodeURIComponent(provider) + "&limit=1", {}, fetchImpl);
    if (Array.isArray(reconciled) && reconciled[0]) {
      return { success: true, alreadyCreated: true, publication: reconciled[0], reconciliationRequired: true };
    }
    throw new Error("Remote draft was created but its publication record could not be verified. Check Blogger before retrying to avoid duplicates.");
  }

  async function createDailyCmsDraft({ ownerId, draftId }) {
    const provider = "blogger";
    const cfg = providerConfig(env, provider);
    const rows = await supabase(cfg,
      "blog_cms_connections?select=site_id,site_name,site_url&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&provider=eq.blogger&selected=eq.true&order=updated_at.desc&limit=1",
      {}, fetchImpl);
    if (!Array.isArray(rows) || !rows.length) {
      return { success: false, status: "not_connected", message: "No selected Blogger site is connected." };
    }
    const site = rows[0];
    const result = await createRemoteCmsDraft({ ownerId, provider, siteId: String(site.site_id), draftId });
    return {
      ...result,
      status: result.alreadyCreated ? "already_created" : "created",
      siteName: String(site.site_name || "Blogger site"),
      siteUrl: String(site.site_url || "")
    };
  }

  async function createCmsDraft(req, res) {
    try {
      const provider = String(req.body?.provider || "").toLowerCase();
      const siteId = String(req.body?.siteId || "");
      const draftId = String(req.params?.id || "");
      const result = await createRemoteCmsDraft({ ownerId: req.ownerUser.id, provider, siteId, draftId });
      return res.status(result.alreadyCreated ? 200 : 201).json(result);
    } catch (error) {
      return res.status(502).json({ success: false, error: error.message });
    }
  }

  return { connectUrl, callback, status, createCmsDraft, createDailyCmsDraft };
}
