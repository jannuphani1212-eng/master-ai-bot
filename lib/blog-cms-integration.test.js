import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createBlogCmsHandlers } from "./blog-cms-integration.js";

function recorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(url) { this.redirected = url; return this; }
  };
}
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-secret",
  BLOG_CMS_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  BLOGGER_CLIENT_ID: "blogger-client",
  BLOGGER_CLIENT_SECRET: "blogger-secret",
  BLOGGER_REDIRECT_URI: "https://example.com/api/blog/oauth/callback",
  WORDPRESS_CLIENT_ID: "wordpress-client",
  WORDPRESS_CLIENT_SECRET: "wordpress-secret",
  WORDPRESS_REDIRECT_URI: "https://example.com/api/blog/oauth/callback"
};

test("Blogger connection URL requests Blogger OAuth and offline access", async () => {
  const handlers = createBlogCmsHandlers({ env });
  const res = recorder();
  await handlers.connectUrl({ ownerUser: { id: "owner-1" }, query: { provider: "blogger" } }, res);
  assert.equal(res.body.success, true);
  const url = new URL(res.body.authorizationUrl);
  assert.equal(url.hostname, "accounts.google.com");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/blogger");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("client_id"), "blogger-client");
  assert.ok(url.searchParams.get("state"));
});

test("WordPress.com connection URL requests explicit read and write scopes", async () => {
  const handlers = createBlogCmsHandlers({ env });
  const res = recorder();
  await handlers.connectUrl({ ownerUser: { id: "owner-1" }, query: { provider: "wordpress" } }, res);
  assert.equal(res.body.success, true);
  const url = new URL(res.body.authorizationUrl);
  assert.equal(url.hostname, "public-api.wordpress.com");
  assert.equal(url.searchParams.get("scope"), "sites,posts");
  assert.equal(url.searchParams.get("client_id"), "wordpress-client");
  assert.ok(url.searchParams.get("state"));
  assert.equal(url.searchParams.get("access_type"), null);
});

test("CMS connection rejects unknown providers", async () => {
  const handlers = createBlogCmsHandlers({ env });
  const res = recorder();
  await handlers.connectUrl({ ownerUser: { id: "owner-1" }, query: { provider: "unknown" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
});


test("CMS handoff reads the canonical daily article field", async () => {
  const { getBlogDraftContent } = await import("./blog-cms-integration.js");
  const draft = getBlogDraftContent({
    topic: "Daily sports article",
    content_json: {
      title: "Verified Article Title",
      article: "# Article body\n\nThe exact owner-reviewed article body."
    }
  });
  assert.equal(draft.title, "Verified Article Title");
  assert.match(draft.html, /<h1>Article body<\/h1>/);
  assert.match(draft.html, /The exact owner-reviewed article body\./);
});

test("CMS handoff can use the saved full editorial report as a fallback", async () => {
  const { getBlogDraftContent } = await import("./blog-cms-integration.js");
  const draft = getBlogDraftContent({
    topic: "Fallback article",
    content_json: { fullReport: "## Full report\n\nSaved editorial content." }
  });
  assert.equal(draft.title, "Fallback article");
  assert.match(draft.html, /<h2>Full report<\/h2>/);
  assert.match(draft.html, /Saved editorial content\./);
});


test("daily Blogger delivery stays private and reports when no site is connected", async () => {
  const calls = [];
  const handlers = createBlogCmsHandlers({
    env,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET" });
      return { ok: true, status: 200, async json() { return []; } };
    }
  });
  const result = await handlers.createDailyCmsDraft({ ownerId: "owner-1", draftId: "draft-1" });
  assert.equal(result.success, false);
  assert.equal(result.status, "not_connected");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /blog_cms_connections/);
});

test("malformed Blogger OAuth callback state is handled as a safe redirect", async () => {
  const handlers = createBlogCmsHandlers({ env, fetchImpl: async () => { throw new Error("Network should not be called"); } });
  const res = recorder();
  await handlers.callback({ query: { state: "", code: "not-used" } }, res);
  assert.equal(res.redirected, "/?blogConnection=error");
});


test("daily Blogger delivery creates a private remote draft without a publish approval", async () => {
  const key = Buffer.from(env.BLOG_CMS_TOKEN_ENCRYPTION_KEY, "hex");
  const iv = Buffer.alloc(12, 7);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update("test-access-token", "utf8"), cipher.final()]);
  const ciphertext = [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
  const calls = [];
  const handlers = createBlogCmsHandlers({
    env,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      calls.push({ url: target, method: options.method || "GET", body: options.body });
      if (target.includes("blog_cms_connections?select=site_id")) {
        return { ok: true, status: 200, async json() { return [{ site_id: "sports-blog-id", site_name: "Sports King 18", site_url: "https://sportsking18.blogspot.com/" }]; } };
      }
      if (target.includes("blog_cms_publications?select=")) {
        return { ok: true, status: 200, async json() { return []; } };
      }
      if (target.includes("blog_cms_connections?select=id,site_id")) {
        return { ok: true, status: 200, async json() { return [{ id: "connection-1", site_id: "sports-blog-id", access_token_ciphertext: ciphertext, refresh_token_ciphertext: null }]; } };
      }
      if (target.includes("blog_drafts?select=")) {
        return { ok: true, status: 200, async json() { return [{ id: "draft-1", topic: "Sports Roundup", content_json: { title: "Sports Roundup", article: "## Sports Update\nVerified results\n\n## Featured Player Biography\nPlayer profile" } }]; } };
      }
      if (target.startsWith("https://www.googleapis.com/blogger/v3/blogs/")) {
        assert.equal(options.method, "POST");
        assert.match(target, /isDraft=true/);
        const payload = JSON.parse(options.body);
        assert.equal(payload.title, "Sports Roundup");
        assert.match(payload.content, /Featured Player Biography/);
        return { ok: true, status: 200, async json() { return { id: "remote-post-1", url: "https://draft.example/post" }; } };
      }
      if (target.includes("blog_cms_publications?on_conflict=")) {
        assert.equal(options.method, "POST");
        return { ok: true, status: 201, async json() { return [{ id: "publication-1", remote_post_id: "remote-post-1", status: "draft" }]; } };
      }
      throw new Error("Unexpected mocked request: " + target);
    }
  });
  const result = await handlers.createDailyCmsDraft({ ownerId: "owner-1", draftId: "draft-1" });
  assert.equal(result.success, true);
  assert.equal(result.status, "created");
  assert.equal(result.siteName, "Sports King 18");
  assert.equal(calls.some(call => call.url.includes("approval_requests")), false);
  assert.equal(calls.some(call => call.url.includes("posts/") && call.method === "POST"), true);
});


function signedState(payload) {
  const key = Buffer.from(env.BLOG_CMS_TOKEN_ENCRYPTION_KEY, "hex");
  const secret = crypto.createHmac("sha256", key).update("master-ai-blog-cms-oauth-state").digest();
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return encoded + "." + signature;
}

test("Blogger OAuth callback accepts a consent flow that takes 15 minutes", async () => {
  const state = signedState({
    ownerId: "owner-1",
    provider: "blogger",
    issuedAt: Date.now() - 15 * 60 * 1000,
    nonce: "test-nonce"
  });
  const calls = [];
  const handlers = createBlogCmsHandlers({
    env,
    fetchImpl: async url => {
      calls.push(String(url));
      return { ok: false, status: 400, async json() { return { error_description: "expected test stop after state validation" }; } };
    }
  });
  const res = recorder();
  await handlers.callback({ query: { state, code: "test-code" } }, res);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /oauth2\\.googleapis\\.com\\/token/);
  assert.equal(res.redirected, "/?blogConnection=error");
});

test("Blogger OAuth callback rejects state older than 30 minutes", async () => {
  const state = signedState({
    ownerId: "owner-1",
    provider: "blogger",
    issuedAt: Date.now() - 31 * 60 * 1000,
    nonce: "test-nonce"
  });
  let networkCalled = false;
  const handlers = createBlogCmsHandlers({
    env,
    fetchImpl: async () => { networkCalled = true; throw new Error("Network should not be called"); }
  });
  const res = recorder();
  await handlers.callback({ query: { state, code: "test-code" } }, res);
  assert.equal(networkCalled, false);
  assert.equal(res.redirected, "/?blogConnection=error");
});
