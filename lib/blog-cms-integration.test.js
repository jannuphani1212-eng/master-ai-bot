import test from "node:test";
import assert from "node:assert/strict";
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
