import test from "node:test";
import assert from "node:assert/strict";
import { createInstagramIntegrationHandlers } from "../lib/instagram-integration.js";

const ownerId = "11111111-2222-4333-8444-555555555555";
const env = {
  INSTAGRAM_APP_ID: "meta-app-id",
  INSTAGRAM_APP_SECRET: "meta-app-secret",
  INSTAGRAM_REDIRECT_URI: "https://example.test/api/instagram/oauth/callback",
  INSTAGRAM_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  SUPABASE_URL: "https://supabase.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key"
};

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return body === null ? "" : JSON.stringify(body); }
  };
}

function mockRes() {
  return {
    body: null,
    statusCode: 200,
    redirectTo: null,
    json(value) { this.body = value; return value; },
    status(code) { this.statusCode = code; return this; },
    redirect(value) { this.redirectTo = value; return value; }
  };
}

test("Instagram Business Login requests professional-account and publishing scopes", () => {
  const handlers = createInstagramIntegrationHandlers({ env });
  const res = mockRes();
  handlers.connectUrl({ ownerUser: { id: ownerId } }, res);
  assert.equal(res.body.success, true);
  const url = new URL(res.body.authorizationUrl);
  assert.equal(url.origin, "https://www.instagram.com");
  assert.equal(url.searchParams.get("client_id"), env.INSTAGRAM_APP_ID);
  assert.equal(url.searchParams.get("redirect_uri"), env.INSTAGRAM_REDIRECT_URI);
  assert.match(url.searchParams.get("scope"), /instagram_business_basic/);
  assert.match(url.searchParams.get("scope"), /instagram_business_content_publish/);
  assert.doesNotMatch(url.searchParams.get("scope"), /instagram_business_content_publishing/);
  assert.ok(url.searchParams.get("state"));
});

test("OAuth callback exchanges and encrypts the long-lived token for the owner", async () => {
  const originalFetch = global.fetch;
  const writes = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target === "https://api.instagram.com/oauth/access_token") {
      assert.equal(options.method, "POST");
      return response(200, { access_token: "short-lived-token", user_id: "178400001" });
    }
    if (target.startsWith("https://graph.instagram.com/access_token?")) {
      assert.match(target, /grant_type=ig_exchange_token/);
      return response(200, { access_token: "long-lived-secret-token", expires_in: 5184000 });
    }
    if (target.startsWith("https://graph.instagram.com/v27.0/me?")) {
      assert.match(target, /fields=user_id%2Cusername%2Caccount_type/);
      return response(200, { user_id: "178400001", username: "affiliate.brand", account_type: "BUSINESS" });
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_connections")) {
      writes.push({ url: target, options });
      return response(201, null);
    }
    throw new Error("Unexpected mocked request: " + target);
  };

  try {
    const handlers = createInstagramIntegrationHandlers({ env });
    const connectRes = mockRes();
    handlers.connectUrl({ ownerUser: { id: ownerId } }, connectRes);
    const state = new URL(connectRes.body.authorizationUrl).searchParams.get("state");
    const callbackRes = mockRes();
    await handlers.callback({ query: { state, code: "single-use-code" } }, callbackRes);

    assert.equal(callbackRes.redirectTo, "/?instagram=connected");
    assert.equal(writes.length, 1);
    const saved = JSON.parse(writes[0].options.body);
    assert.equal(saved.owner_user_id, ownerId);
    assert.equal(saved.ig_user_id, "178400001");
    assert.equal(saved.username, "affiliate.brand");
    assert.equal(saved.account_type, "BUSINESS");
    assert.notEqual(saved.access_token_ciphertext, "long-lived-secret-token");
    assert.match(saved.access_token_ciphertext, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(new Date(saved.expires_at).getTime() > Date.now());
    assert.ok(writes[0].url.includes("on_conflict=owner_user_id,ig_user_id"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("personal Instagram accounts are not stored as professional connections", async () => {
  const originalFetch = global.fetch;
  let saved = false;
  global.fetch = async url => {
    const target = String(url);
    if (target === "https://api.instagram.com/oauth/access_token") {
      return response(200, { access_token: "short", user_id: "178400002" });
    }
    if (target.startsWith("https://graph.instagram.com/access_token?")) {
      return response(200, { access_token: "long", expires_in: 5184000 });
    }
    if (target.startsWith("https://graph.instagram.com/v27.0/me?")) {
      return response(200, { user_id: "178400002", username: "personal.user", account_type: "PERSONAL" });
    }
    if (target.includes("/instagram_connections")) {
      saved = true;
      return response(201, null);
    }
    throw new Error("Unexpected mocked request: " + target);
  };
  try {
    const handlers = createInstagramIntegrationHandlers({ env });
    const connectRes = mockRes();
    handlers.connectUrl({ ownerUser: { id: ownerId } }, connectRes);
    const state = new URL(connectRes.body.authorizationUrl).searchParams.get("state");
    const callbackRes = mockRes();
    await handlers.callback({ query: { state, code: "single-use-code" } }, callbackRes);
    assert.equal(callbackRes.redirectTo, "/?instagram=professional-required");
    assert.equal(saved, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Instagram status is owner-scoped and returns account metadata only", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async url => {
    requestedUrl = String(url);
    return response(200, [{
      owner_user_id: ownerId,
      ig_user_id: "178400003",
      username: "affiliate.brand",
      account_type: "CREATOR",
      access_token_ciphertext: "not-used-because-expiry-is-far",
      expires_at: new Date(Date.now() + 40 * 86400000).toISOString(),
      updated_at: new Date().toISOString()
    }]);
  };
  try {
    const handlers = createInstagramIntegrationHandlers({ env });
    const res = mockRes();
    await handlers.status({ ownerUser: { id: ownerId } }, res);
    assert.match(requestedUrl, new RegExp("owner_user_id=eq\\." + ownerId));
    assert.equal(res.body.connected, true);
    assert.equal(res.body.accounts[0].username, "affiliate.brand");
    assert.equal(res.body.accounts[0].accountType, "CREATOR");
    assert.equal(res.body.accounts[0].access_token, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});
