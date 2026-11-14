import test from "node:test";
import assert from "node:assert/strict";
import { createSearchConsoleHandlers } from "../lib/search-console-integration.js";

const ownerId = "11111111-2222-4333-8444-555555555555";
const env = {
  GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "search-console-client-id",
  GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "search-console-client-secret",
  GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: "https://example.test/api/seo/search-console/oauth/callback",
  SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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

test("Search Console OAuth requests offline read-only access", () => {
  const handlers = createSearchConsoleHandlers({ env });
  const res = mockRes();
  handlers.connectUrl({ ownerUser: { id: ownerId } }, res);
  assert.equal(res.body.success, true);
  const url = new URL(res.body.authorizationUrl);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.match(url.searchParams.get("scope"), /webmasters.readonly/);
  assert.ok(url.searchParams.get("state"));
});

test("Search Console callback stores encrypted refresh token for the owner", async () => {
  const originalFetch = global.fetch;
  const writes = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target === "https://oauth2.googleapis.com/token") {
      return response(200, { access_token: "access-token", refresh_token: "refresh-token" });
    }
    if (target === "https://www.googleapis.com/oauth2/v2/userinfo") {
      return response(200, { email: "owner@example.com" });
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/search_console_connections")) {
      writes.push({ url: target, options });
      return response(201, null);
    }
    throw new Error("Unexpected mocked request: " + target);
  };
  try {
    const handlers = createSearchConsoleHandlers({ env });
    const connectRes = mockRes();
    handlers.connectUrl({ ownerUser: { id: ownerId } }, connectRes);
    const state = new URL(connectRes.body.authorizationUrl).searchParams.get("state");
    const callbackRes = mockRes();
    await handlers.callback({ query: { state, code: "oauth-code" } }, callbackRes);
    assert.equal(callbackRes.redirectTo, "/?searchConsole=connected");
    assert.equal(writes.length, 1);
    const saved = JSON.parse(writes[0].options.body);
    assert.equal(saved.owner_user_id, ownerId);
    assert.equal(saved.google_email, "owner@example.com");
    assert.notEqual(saved.refresh_token_ciphertext, "refresh-token");
    assert.match(saved.refresh_token_ciphertext, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(writes[0].url.includes("on_conflict=owner_user_id,google_email"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("Search Console site list and query are restricted to connected owner properties", async () => {
  const originalFetch = global.fetch;
  const ownerConnection = {
    owner_user_id: ownerId,
    google_email: "owner@example.com",
    refresh_token_ciphertext: "token-ciphertext",
    updated_at: new Date().toISOString()
  };
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.startsWith("https://supabase.example.test/rest/v1/search_console_connections")) {
      return response(200, [ownerConnection]);
    }
    if (target === "https://oauth2.googleapis.com/token") {
      return response(200, { access_token: "fresh-access-token" });
    }
    if (target === "https://www.googleapis.com/webmasters/v3/sites") {
      return response(200, { siteEntry: [{ siteUrl: "https://example.com/", permissionLevel: "siteOwner" }] });
    }
    if (target.startsWith("https://www.googleapis.com/webmasters/v3/sites/")) {
      return response(200, {
        responseAggregationType: "byPage",
        rows: [{ keys: ["https://example.com/page"], clicks: 25, impressions: 500, ctr: 0.05, position: 7.2 }]
      });
    }
    throw new Error("Unexpected mocked request: " + target);
  };
  try {
    const handlers = createSearchConsoleHandlers({ env });
    const res = mockRes();
    await handlers.query({
      ownerUser: { id: ownerId },
      body: {
        googleEmail: "owner@example.com",
        siteUrl: "https://example.com/",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        dimension: "page",
        rowLimit: 100
      }
    }, res);
    assert.equal(res.body.success, true);
    assert.equal(res.body.rows[0].clicks, 25);
    assert.equal(res.body.rows[0].impressions, 500);
    assert.ok(calls.some(call => call.target.includes("owner_user_id=eq." + ownerId)));
    const queryCall = calls.find(call => call.target.startsWith("https://www.googleapis.com/webmasters/v3/sites/"));
    assert.equal(JSON.parse(queryCall.options.body).dimensions[0], "page");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Search Console query refuses properties outside the connected account", async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => {
    const target = String(url);
    if (target.startsWith("https://supabase.example.test/rest/v1/search_console_connections")) {
      return response(200, [{
        owner_user_id: ownerId,
        google_email: "owner@example.com",
        refresh_token_ciphertext: "token-ciphertext"
      }]);
    }
    if (target === "https://oauth2.googleapis.com/token") {
      return response(200, { access_token: "fresh-access-token" });
    }
    if (target === "https://www.googleapis.com/webmasters/v3/sites") {
      return response(200, { siteEntry: [] });
    }
    throw new Error("Search analytics query must not be called for an unlisted site.");
  };
  try {
    const handlers = createSearchConsoleHandlers({ env });
    const res = mockRes();
    await handlers.query({
      ownerUser: { id: ownerId },
      body: {
        googleEmail: "owner@example.com",
        siteUrl: "https://not-connected.example/",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        dimension: "query"
      }
    }, res);
    assert.equal(res.statusCode, 403);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Search Console query rejects invalid date ranges before making API requests", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("Google API must not be called."); };
  try {
    const handlers = createSearchConsoleHandlers({ env });
    const res = mockRes();
    await handlers.query({
      ownerUser: { id: ownerId },
      body: {
        googleEmail: "owner@example.com",
        siteUrl: "https://example.com/",
        startDate: "2026-02-30",
        endDate: "2026-02-01",
        dimension: "query"
      }
    }, res);
    assert.equal(res.statusCode, 400);
  } finally {
    global.fetch = originalFetch;
  }
});
