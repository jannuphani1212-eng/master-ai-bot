import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createBlogCmsHandlers } from "../lib/blog-cms-integration.js";

const ownerId = "11111111-2222-4333-8444-555555555555";
const draftId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const keyHex = "0123456789abcdef".repeat(4);
const env = {
  SUPABASE_URL: "https://supabase.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  BLOG_CMS_TOKEN_ENCRYPTION_KEY: keyHex,
  WORDPRESS_CLIENT_ID: "wp-client",
  WORDPRESS_CLIENT_SECRET: "wp-secret",
  WORDPRESS_REDIRECT_URI: "https://bot.example.test/api/blog/cms/wordpress/callback"
};

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; },
    redirect(url) { this.redirectUrl = url; return url; }
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
    async json() { return body; }
  };
}

function encryptToken(value) {
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.alloc(12, 7);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

const draft = {
  id: draftId,
  topic: "A useful guide",
  content_json: {
    title: "A Useful Guide",
    slug: "a-useful-guide",
    excerpt: "A short summary",
    articleMarkdown: "# A useful guide\n\n" + "Helpful article text for readers. ".repeat(8)
  },
  status: "draft"
};

test("WordPress.com connection URL requests only site and post access", () => {
  const handlers = createBlogCmsHandlers({ env });
  const res = mockRes();
  handlers.connectUrl({
    params: { provider: "wordpress" },
    ownerUser: { id: ownerId }
  }, res);
  assert.equal(res.body.success, true);
  const url = new URL(res.body.authorizationUrl);
  assert.equal(url.hostname, "public-api.wordpress.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.match(url.searchParams.get("scope"), /posts/);
  assert.match(url.searchParams.get("scope"), /sites/);
  assert.ok(url.searchParams.get("state"));
});

test("WordPress.com save creates a remote draft and never publishes", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, options });
    if (target.includes("/rest/v1/blog_drafts?")) return jsonResponse(200, [draft]);
    if (target.includes("/rest/v1/blog_cms_publications?select=")) return jsonResponse(200, []);
    if (target.includes("/rest/v1/blog_cms_connections?select=")) {
      return jsonResponse(200, [{
        site_id: "123456",
        site_name: "My Free WordPress Site",
        site_url: "https://example.wordpress.com",
        access_token_ciphertext: encryptToken("wp-access-token"),
        refresh_token_ciphertext: null
      }]);
    }
    if (target === "https://public-api.wordpress.com/rest/v1.1/sites/123456/posts/new") {
      const form = new URLSearchParams(options.body);
      assert.equal(form.get("status"), "draft");
      assert.equal(form.get("title"), "A Useful Guide");
      return jsonResponse(200, { ID: 789, URL: "https://example.wordpress.com/?p=789", status: "draft" });
    }
    if (target.includes("/rest/v1/blog_cms_publications")) {
      const row = JSON.parse(options.body)[0];
      assert.equal(row.status, "draft");
      assert.equal(row.remote_post_id, "789");
      return jsonResponse(201, [{ id: "pub-1", ...row }]);
    }
    throw new Error("Unexpected fetch: " + target);
  };

  try {
    const handlers = createBlogCmsHandlers({ env });
    const res = mockRes();
    await handlers.saveDraft({
      params: { id: draftId },
      ownerUser: { id: ownerId },
      body: { providers: ["wordpress"] }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.results[0].success, true);
    assert.match(res.body.message, /Nothing has been published/);
    const createCall = calls.find(call => call.url.endsWith("/posts/new"));
    assert.ok(createCall);
    assert.equal(createCall.options.method, "POST");
    assert.ok(!calls.some(call => call.url.includes("/publish")));
    const draftRead = calls.find(call => call.url.includes("/rest/v1/blog_drafts?"));
    assert.match(draftRead.url, new RegExp("owner_user_id=eq\\." + ownerId));
  } finally {
    global.fetch = originalFetch;
  }
});

test("CMS draft sync refuses unconnected destinations without publishing", async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => {
    const target = String(url);
    if (target.includes("/rest/v1/blog_drafts?")) return jsonResponse(200, [draft]);
    if (target.includes("/rest/v1/blog_cms_publications?select=")) return jsonResponse(200, []);
    if (target.includes("/rest/v1/blog_cms_connections?select=")) return jsonResponse(200, []);
    throw new Error("Unexpected network call: " + target);
  };
  try {
    const handlers = createBlogCmsHandlers({ env });
    const res = mockRes();
    await handlers.saveDraft({
      params: { id: draftId },
      ownerUser: { id: ownerId },
      body: { providers: ["blogger"] }
    }, res);
    assert.equal(res.body.success, true);
    assert.equal(res.body.results[0].success, false);
    assert.match(res.body.results[0].error, /Connect and select/);
  } finally {
    global.fetch = originalFetch;
  }
});
