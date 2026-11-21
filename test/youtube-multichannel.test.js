import test from "node:test";
import assert from "node:assert/strict";
import { createYoutubeIntegrationHandlers } from "../lib/youtube-integration.js";

const env = {
  YOUTUBE_CLIENT_ID: "client-id",
  YOUTUBE_CLIENT_SECRET: "client-secret",
  YOUTUBE_REDIRECT_URI: "https://example.test/api/youtube/oauth/callback",
  YOUTUBE_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test"
};

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
}

test("YouTube status lists multi-channel records and preserves the legacy channel", async () => {
  const fetchImpl = async url => {
    const isMulti = String(url).includes("youtube_channel_connections");
    const rows = isMulti ? [
      { id: "multi-1", owner_user_id: "owner-1", channel_id: "UC_SECOND_12345", channel_title: "Second Rhymes", thumbnail_url: null, updated_at: "2026-11-21T00:00:00Z" },
      { id: "multi-2", owner_user_id: "owner-1", channel_id: "UC_THIRD_12345", channel_title: "Third Rhymes", thumbnail_url: null, updated_at: "2026-11-21T00:00:00Z" }
    ] : [
      { owner_user_id: "owner-1", channel_id: "UC_GLOBAL_12345", channel_title: "Global Rhymes 4U", thumbnail_url: null, updated_at: "2026-11-20T00:00:00Z" }
    ];
    return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
  };
  const handlers = createYoutubeIntegrationHandlers({ env, fetchImpl });
  const res = responseRecorder();
  await handlers.status({ ownerUser: { id: "owner-1" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.connected, true);
  assert.equal(res.payload.maxChannels, 3);
  assert.equal(res.payload.channels.length, 3);
  assert.equal(res.payload.channel.title, "Global Rhymes 4U");
});

test("YouTube OAuth connect URL carries the exact channel title selected by the owner", () => {
  const handlers = createYoutubeIntegrationHandlers({ env });
  const res = responseRecorder();
  handlers.connectUrl({ ownerUser: { id: "owner-1" }, query: { channel_title: "Second Rhymes" } }, res);
  assert.equal(res.payload.success, true);
  const url = new URL(res.payload.authorizationUrl);
  const state = url.searchParams.get("state");
  const encoded = state.split(".")[0];
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.equal(payload.channelTitle, "Second Rhymes");
  assert.equal(url.searchParams.get("prompt"), "select_account consent");
});
