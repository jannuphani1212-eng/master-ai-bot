import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createSearchConsoleHandlers } from "./search-console-integration.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const key = "a".repeat(64);
const env = {
  YOUTUBE_CLIENT_ID: "google-client-id",
  YOUTUBE_CLIENT_SECRET: "google-client-secret",
  SEARCH_CONSOLE_REDIRECT_URI: "https://example.test/api/search-console/oauth/callback",
  SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY: key,
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret"
};

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function encrypt(value) {
  const iv = Buffer.alloc(12, 7);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString("base64url")).join(".");
}

test("connect URL requests read-only Search Console scope and signed owner state", async () => {
  const handlers = createSearchConsoleHandlers({ env, now: () => 1_800_000_000_000 });
  let payload;
  const res = { json(value) { payload = value; return this; }, status() { return this; } };
  await handlers.connectUrl({ ownerUser: { id: ownerId } }, res);
  assert.equal(payload.success, true);
  const url = new URL(payload.url);
  assert.equal(url.searchParams.get("redirect_uri"), env.SEARCH_CONSOLE_REDIRECT_URI);
  assert.ok(url.searchParams.get("scope").includes("https://www.googleapis.com/auth/webmasters.readonly"));
  assert.ok(!url.searchParams.get("scope").includes("https://www.googleapis.com/auth/webmasters "));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.ok(url.searchParams.get("state"));
});

test("OAuth callback stores an encrypted refresh token and redirects to the dashboard", async () => {
  const handlers = createSearchConsoleHandlers({ env, now: () => 1_800_000_000_000, fetchImpl: async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token", refresh_token: "refresh-token" });
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") return response({ email: "owner@example.com" });
    if (String(url).includes("/rest/v1/search_console_connections?select=id")) return response([]);
    if (String(url).endsWith("/rest/v1/search_console_connections")) {
      const body = JSON.parse(options.body);
      assert.equal(body.owner_user_id, ownerId);
      assert.equal(body.google_email, "owner@example.com");
      assert.notEqual(body.refresh_token_ciphertext, "refresh-token");
      return response([]);
    }
    throw new Error("Unexpected request " + url);
  }});
  let connectPayload;
  await handlers.connectUrl({ ownerUser: { id: ownerId } }, { json(value) { connectPayload = value; return this; } });
  const state = new URL(connectPayload.url).searchParams.get("state");
  let redirect;
  await handlers.callback({ query: { state, code: "authorization-code" } }, {
    redirect(value) { redirect = value; return this; }
  });
  assert.equal(redirect, "/?searchConsole=connected");
});

test("status lists only properties returned by the connected Google account", async () => {
  const handlers = createSearchConsoleHandlers({ env, fetchImpl: async url => {
    if (String(url).includes("/rest/v1/search_console_connections")) {
      return response([{ owner_user_id: ownerId, google_email: "owner@example.com", refresh_token_ciphertext: encrypt("refresh-token") }]);
    }
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url === "https://www.googleapis.com/webmasters/v3/sites") {
      return response({ siteEntry: [{ siteUrl: "https://sportsking18.blogspot.com/", permissionLevel: "siteOwner" }] });
    }
    throw new Error("Unexpected request " + url);
  }});
  let payload;
  await handlers.status({ ownerUser: { id: ownerId } }, { json(value) { payload = value; return this; }, status() { return this; } });
  assert.equal(payload.connected, true);
  assert.equal(payload.googleEmail, "owner@example.com");
  assert.equal(payload.properties[0].siteUrl, "https://sportsking18.blogspot.com/");
});

test("analytics rejects properties not granted to the connected Google account", async () => {
  let analyticsCalled = false;
  const handlers = createSearchConsoleHandlers({ env, fetchImpl: async url => {
    if (String(url).includes("/rest/v1/search_console_connections")) {
      return response([{ owner_user_id: ownerId, google_email: "owner@example.com", refresh_token_ciphertext: encrypt("refresh-token") }]);
    }
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url === "https://www.googleapis.com/webmasters/v3/sites") {
      return response({ siteEntry: [{ siteUrl: "https://sportsking18.blogspot.com/", permissionLevel: "siteOwner" }] });
    }
    if (String(url).includes("/searchAnalytics/query")) analyticsCalled = true;
    throw new Error("Unexpected request " + url);
  }});
  let statusCode = 200;
  let payload;
  await handlers.analytics({ ownerUser: { id: ownerId }, body: {
    siteUrl: "https://other.example/",
    startDate: "2026-10-01",
    endDate: "2026-10-28"
  }}, {
    json(value) { payload = value; return this; },
    status(code) { statusCode = code; return this; }
  });
  assert.equal(statusCode, 403);
  assert.equal(analyticsCalled, false);
  assert.equal(payload.verified, undefined);
});

test("analytics queries read-only Search Console data for an authorized property", async () => {
  let requestBody;
  const handlers = createSearchConsoleHandlers({ env, fetchImpl: async (url, options = {}) => {
    if (String(url).includes("/rest/v1/search_console_connections")) {
      return response([{ owner_user_id: ownerId, google_email: "owner@example.com", refresh_token_ciphertext: encrypt("refresh-token") }]);
    }
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url === "https://www.googleapis.com/webmasters/v3/sites") {
      return response({ siteEntry: [{ siteUrl: "https://sportsking18.blogspot.com/", permissionLevel: "siteOwner" }] });
    }
    if (String(url).includes("/searchAnalytics/query")) {
      requestBody = JSON.parse(options.body);
      return response({ rows: [{ keys: ["sports news", "https://sportsking18.blogspot.com/", "ind", "mobile"], clicks: 12, impressions: 120, ctr: 0.1, position: 5.2 }] });
    }
    throw new Error("Unexpected request " + url);
  }});
  let payload;
  await handlers.analytics({ ownerUser: { id: ownerId }, body: {
    siteUrl: "https://sportsking18.blogspot.com/",
    startDate: "2026-10-01",
    endDate: "2026-10-28"
  }}, { json(value) { payload = value; return this; }, status() { return this; } });
  assert.equal(payload.success, true);
  assert.equal(payload.verified, true);
  assert.equal(payload.rows[0].clicks, 12);
  assert.equal(requestBody.dataState, "final");
  assert.deepEqual(requestBody.dimensions, ["query", "page", "country", "device"]);
});
