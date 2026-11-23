import test from "node:test";
import assert from "node:assert/strict";
import { createInstagramIntegrationHandlers } from "./instagram-integration.js";

function recorder() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
const env = {
  INSTAGRAM_APP_ID: "meta-app-id",
  INSTAGRAM_APP_SECRET: "meta-app-secret",
  INSTAGRAM_REDIRECT_URI: "https://example.com/api/instagram/oauth/callback",
  INSTAGRAM_TOKEN_ENCRYPTION_KEY: "b".repeat(64),
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-secret",
  META_GRAPH_API_VERSION: "v26.0"
};

test("Instagram OAuth uses current professional-account login scopes", async () => {
  const handlers = createInstagramIntegrationHandlers({ env });
  const res = recorder();
  await handlers.connectUrl({ ownerUser: { id: "owner-1" } }, res);
  assert.equal(res.body.success, true);
  const url = new URL(res.body.authorizationUrl);
  assert.equal(url.hostname, "www.instagram.com");
  assert.equal(url.searchParams.get("scope"), "instagram_business_basic");
  assert.equal(url.searchParams.get("client_id"), "meta-app-id");
  assert.ok(url.searchParams.get("state"));
});

test("Instagram OAuth requires a 32-byte encryption key", async () => {
  const handlers = createInstagramIntegrationHandlers({ env: { ...env, INSTAGRAM_TOKEN_ENCRYPTION_KEY: "short" } });
  const res = recorder();
  await handlers.connectUrl({ ownerUser: { id: "owner-1" } }, res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /64 hexadecimal characters/);
});
