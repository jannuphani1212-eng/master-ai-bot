import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
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

function encryptedInstagramToken(token) {
  const key = Buffer.from(env.INSTAGRAM_TOKEN_ENCRYPTION_KEY, "hex");
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

const igConnection = {
  owner_user_id: ownerId,
  ig_user_id: "178400001",
  username: "affiliate.brand",
  account_type: "BUSINESS",
  access_token_ciphertext: encryptedInstagramToken("long-lived-token"),
  expires_at: new Date(Date.now() + 40 * 86400000).toISOString(),
  updated_at: new Date().toISOString()
};

const approvalRequest = {
  id: "approval-1111",
  owner_id: ownerId,
  created_by: ownerId,
  action_type: "instagram_reel_publish",
  status: "approved",
  payload: {
    platform: "instagram",
    mediaType: "REELS",
    igUserId: "178400001",
    username: "affiliate.brand",
    videoUrl: "https://cdn.example.com/reel.mp4",
    caption: "Sample Reel caption #affiliate",
    shareToFeed: true,
    affiliateDisclosureConfirmed: true,
    mediaRightsConfirmed: true
  }
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
  assert.equal(url.searchParams.get("scope"), "instagram_business_basic,instagram_business_content_publish");
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


test("Instagram Reel approval request stores exact content without publishing", async () => {
  const originalFetch = global.fetch;
  let savedApproval;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_connections?")) {
      return response(200, [igConnection]);
    }
    if (target === "https://supabase.example.test/rest/v1/approval_requests") {
      savedApproval = JSON.parse(options.body);
      return response(201, [{
        id: "approval-new",
        status: "pending",
        title: savedApproval.title,
        ...savedApproval
      }]);
    }
    throw new Error("Unexpected request: " + target);
  };
  try {
    const handlers = createInstagramIntegrationHandlers({ env });
    const res = mockRes();
    await handlers.createPublishRequest({
      ownerUser: { id: ownerId },
      body: {
        igUserId: "178400001",
        videoUrl: "https://cdn.example.com/reel.mp4",
        caption: "Review this Reel #affiliate",
        shareToFeed: true,
        affiliateDisclosureConfirmed: true,
        mediaRightsConfirmed: true
      }
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(savedApproval.owner_id, ownerId);
    assert.equal(savedApproval.created_by, ownerId);
    assert.equal(savedApproval.action_type, "instagram_reel_publish");
    assert.equal(savedApproval.payload.videoUrl, "https://cdn.example.com/reel.mp4");
    assert.equal(savedApproval.payload.caption, "Review this Reel #affiliate");
    assert.equal(res.body.approvalRequest.status, "pending");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Instagram Reel approval request requires affiliate disclosure and media rights confirmation", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("Storage must not be called"); };
  try {
    const handlers = createInstagramIntegrationHandlers({ env });
    const res = mockRes();
    await handlers.createPublishRequest({
      ownerUser: { id: ownerId },
      body: {
        igUserId: "178400001",
        videoUrl: "https://cdn.example.com/reel.mp4",
        caption: "Caption without required confirmation"
      }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /affiliate disclosure/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Instagram Reel approval rejects localhost and reserved media hosts", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("Storage must not be called"); };
  try {
    const handlers = createInstagramIntegrationHandlers({ env });
    const res = mockRes();
    await handlers.createPublishRequest({
      ownerUser: { id: ownerId },
      body: {
        igUserId: "178400001",
        videoUrl: "https://localhost/reel.mp4",
        caption: "Affiliate disclosure #affiliate",
        affiliateDisclosureConfirmed: true,
        mediaRightsConfirmed: true
      }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /public HTTPS URL/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Instagram Reel preparation requires exact owner approval and creates one container", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const job = {
    id: "job-1111",
    approval_request_id: "approval-1111",
    owner_user_id: ownerId,
    ig_user_id: "178400001",
    video_url: "https://cdn.example.com/reel.mp4",
    caption: "Sample Reel caption #affiliate",
    share_to_feed: true,
    status: "preparing"
  };
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, method: options.method || "GET" });
    if (target.startsWith("https://supabase.example.test/rest/v1/approval_requests?")) {
      return response(200, [approvalRequest]);
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_publish_jobs?") && options.method === "PATCH") {
      return response(200, [{ ...job, container_id: "container-123", status: "processing" }]);
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_publish_jobs?")) {
      return response(200, []);
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_connections?")) {
      return response(200, [igConnection]);
    }
    if (target === "https://supabase.example.test/rest/v1/instagram_publish_jobs" && options.method === "POST") {
      return response(201, [job]);
    }
    if (target.startsWith("https://graph.instagram.com/v27.0/178400001/content_publishing_limit?")) {
      return response(200, { data: [{ quota_usage: 2, config: { quota_total: 50 } }] });
    }
    if (target === "https://graph.instagram.com/v27.0/178400001/media" && options.method === "POST") {
      return response(200, { id: "container-123" });
    }
    throw new Error("Unexpected request: " + target + " " + (options.method || "GET"));
  };
  try {
    const handlers = createInstagramIntegrationHandlers({ env });
    const res = mockRes();
    await handlers.prepareApprovedReel({
      ownerUser: { id: ownerId },
      params: { id: "approval-1111" }
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.publishJob.status, "processing");
    assert.equal(res.body.publishJob.container_id, "container-123");
    assert.equal(calls.filter(call => call.target.endsWith("/media")).length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Instagram Reel publishing refuses to publish before container is ready", async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => {
    const target = String(url);
    if (target.startsWith("https://supabase.example.test/rest/v1/approval_requests?")) {
      return response(200, [approvalRequest]);
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_publish_jobs?")) {
      return response(200, [{
        id: "job-1111",
        approval_request_id: "approval-1111",
        status: "processing",
        container_id: "container-123"
      }]);
    }
    throw new Error("Instagram publish API must not be called before readiness.");
  };
  try {
    const handlers = createInstagramIntegrationHandlers({ env });
    const res = mockRes();
    await handlers.publishApprovedReel({
      ownerUser: { id: ownerId },
      params: { id: "approval-1111" }
    }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /not ready/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Instagram Reel publication occurs only after owner approval and ready status", async () => {
  const originalFetch = global.fetch;
  const methods = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    methods.push({ target, method: options.method || "GET" });
    if (target.startsWith("https://supabase.example.test/rest/v1/approval_requests?")) {
      return response(200, [approvalRequest]);
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_publish_jobs?") && !options.method) {
      return response(200, [{
        id: "job-1111",
        approval_request_id: "approval-1111",
        owner_user_id: ownerId,
        ig_user_id: "178400001",
        container_id: "container-123",
        status: "ready"
      }]);
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_publish_jobs?") && options.method === "PATCH") {
      const patch = JSON.parse(options.body);
      return response(200, [{
        id: "job-1111",
        approval_request_id: "approval-1111",
        owner_user_id: ownerId,
        ig_user_id: "178400001",
        container_id: "container-123",
        status: patch.status,
        media_id: patch.media_id
      }]);
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_connections?")) {
      return response(200, [igConnection]);
    }
    if (target.startsWith("https://graph.instagram.com/v27.0/178400001/content_publishing_limit?")) {
      return response(200, { data: [{ quota_usage: 3, config: { quota_total: 50 } }] });
    }
    if (target === "https://graph.instagram.com/v27.0/178400001/media_publish" && options.method === "POST") {
      return response(200, { id: "published-media-123" });
    }
    throw new Error("Unexpected request: " + target + " " + (options.method || "GET"));
  };
  try {
    const handlers = createInstagramIntegrationHandlers({ env });
    const res = mockRes();
    await handlers.publishApprovedReel({
      ownerUser: { id: ownerId },
      params: { id: "approval-1111" }
    }, res);
    assert.equal(res.body.success, true);
    assert.equal(res.body.mediaId, "published-media-123");
    assert.ok(methods.some(call => call.target.endsWith("/media_publish")));
  } finally {
    global.fetch = originalFetch;
  }
});


test("Instagram publishing quota prevents preparing a Reel when the 24-hour limit is reached", async () => {
  const originalFetch = global.fetch;
  let containerCreated = false;
  const job = {
    id: "job-2222",
    approval_request_id: "approval-1111",
    owner_user_id: ownerId,
    ig_user_id: "178400001",
    video_url: "https://cdn.example.com/reel.mp4",
    caption: "Sample Reel caption #affiliate",
    share_to_feed: true,
    status: "preparing"
  };
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith("https://supabase.example.test/rest/v1/approval_requests?")) {
      return response(200, [approvalRequest]);
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_publish_jobs?")) {
      return response(200, []);
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/instagram_connections?")) {
      return response(200, [igConnection]);
    }
    if (target.startsWith("https://graph.instagram.com/v27.0/178400001/content_publishing_limit?")) {
      return response(200, { data: [{ quota_usage: 50, config: { quota_total: 50 } }] });
    }
    if (target === "https://supabase.example.test/rest/v1/instagram_publish_jobs" && options.method === "POST") {
      return response(201, [job]);
    }
    if (target.endsWith("/media") && options.method === "POST") {
      containerCreated = true;
      return response(200, { id: "container-should-not-exist" });
    }
    throw new Error("Unexpected request: " + target);
  };
  try {
    const handlers = createInstagramIntegrationHandlers({ env });
    const res = mockRes();
    await handlers.prepareApprovedReel({
      ownerUser: { id: ownerId },
      params: { id: "approval-1111" }
    }, res);
    assert.equal(res.statusCode, 429);
    assert.equal(containerCreated, false);
  } finally {
    global.fetch = originalFetch;
  }
});
