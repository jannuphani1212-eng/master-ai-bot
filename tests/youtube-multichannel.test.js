import test from "node:test";
import assert from "node:assert/strict";
import { createYoutubeIntegrationHandlers, getYoutubeAgentContext } from "../lib/youtube-integration.js";

const ownerId = "11111111-2222-4333-8444-555555555555";
const env = {
  YOUTUBE_CLIENT_ID: "test-client-id",
  YOUTUBE_CLIENT_SECRET: "test-client-secret",
  YOUTUBE_REDIRECT_URI: "https://example.test/api/youtube/oauth/callback",
  SUPABASE_URL: "https://supabase.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  YOUTUBE_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
};

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return body === null ? "" : JSON.stringify(body); }
  };
}

test("OAuth callback stores every returned channel with an encrypted token", async () => {
  const originalFetch = global.fetch;
  const writes = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target === "https://oauth2.googleapis.com/token") {
      return response(200, { access_token: "access-token", refresh_token: "refresh-token" });
    }
    if (target.startsWith("https://www.googleapis.com/youtube/v3/channels?")) {
      return response(200, {
        items: [
          { id: "UCCHANNELONE", snippet: { title: "Global Rhymes 4U", thumbnails: { default: { url: "https://img.test/one.jpg" } } } },
          { id: "UCHANNELTWO", snippet: { title: "Affiliate Telugu English", thumbnails: { default: { url: "https://img.test/two.jpg" } } } }
        ]
      });
    }
    if (target.startsWith("https://supabase.example.test/rest/v1/youtube_channel_connections")) {
      writes.push({ url: target, options });
      return response(201, null);
    }
    throw new Error("Unexpected mocked request: " + target);
  };

  try {
    const handlers = createYoutubeIntegrationHandlers({ env });
    let authorization;
    handlers.connectUrl({ ownerUser: { id: ownerId } }, {
      json(value) { authorization = value; return value; },
      status(code) { throw new Error("Unexpected status " + code); }
    });
    assert.equal(authorization.success, true);
    const authUrl = new URL(authorization.authorizationUrl);
    assert.equal(authUrl.searchParams.get("prompt"), "select_account consent");

    let redirect;
    await handlers.callback({
      query: { state: authUrl.searchParams.get("state"), code: "single-use-code" }
    }, {
      redirect(value) { redirect = value; return value; }
    });

    assert.equal(redirect, "/?youtube=connected&count=2");
    assert.equal(writes.length, 2);
    const stored = writes.map(item => JSON.parse(item.options.body));
    assert.deepEqual(stored.map(item => item.channel_id), ["UCCHANNELONE", "UCHANNELTWO"]);
    for (const row of stored) {
      assert.equal(row.owner_user_id, ownerId);
      assert.notEqual(row.refresh_token_ciphertext, "refresh-token");
      assert.match(row.refresh_token_ciphertext, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      assert.equal(row.id, undefined);
    }
    assert.ok(writes.every(item => item.url.includes("on_conflict=owner_user_id,channel_id")));
  } finally {
    global.fetch = originalFetch;
  }
});

test("agent context stays channel-neutral for multiple unrelated YouTube channels", async () => {
  const originalFetch = global.fetch;
  try {
    for (const channel of [
      { id: "UC_RHYMES", title: "Global Rhymes 4U" },
      { id: "UC_AFFILIATE", title: "Affiliate Telugu English" }
    ]) {
      global.fetch = async url => {
        const target = String(url);
        if (target.startsWith("https://supabase.example.test/rest/v1/youtube_channel_connections")) {
          return response(200, [{
            channel_id: channel.id,
            channel_title: channel.title,
            refresh_token_ciphertext: "AA.AA.AA"
          }]);
        }
        if (target === "https://oauth2.googleapis.com/token") {
          return response(200, { access_token: "access-token" });
        }
        if (target.startsWith("https://www.googleapis.com/youtube/v3/channels?")) {
          return response(200, {
            items: [{
              id: channel.id,
              snippet: { title: channel.title },
              statistics: {},
              contentDetails: {}
            }]
          });
        }
        if (target.startsWith("https://youtubeanalytics.googleapis.com/")) {
          return response(403, { error: { message: "Analytics not enabled in test" } });
        }
        throw new Error("Unexpected mocked request: " + target);
      };

      const context = await getYoutubeAgentContext({ env, ownerId, channelId: channel.id });
      assert.match(context, new RegExp("Channel: " + channel.title));
      assert.match(context, /never assume this is Global Rhymes 4U or a children's channel/);
      assert.doesNotMatch(context, /age-appropriate original English 3D children's rhymes for the Global Rhymes 4U audience/);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test("status lists only the signed-in owner's channel connections", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async url => {
    requestedUrl = String(url);
    return response(200, [
      { channel_id: "UCONE", channel_title: "Channel One", thumbnail_url: null, updated_at: "2026-11-14T00:00:00Z" },
      { channel_id: "UCTWO", channel_title: "Channel Two", thumbnail_url: null, updated_at: "2026-11-14T00:00:00Z" }
    ]);
  };
  try {
    const handlers = createYoutubeIntegrationHandlers({ env });
    let result;
    await handlers.status({ ownerUser: { id: ownerId } }, {
      json(value) { result = value; return value; },
      status(code) { throw new Error("Unexpected status " + code); }
    });
    assert.match(requestedUrl, new RegExp("owner_user_id=eq\\." + ownerId));
    assert.equal(result.connected, true);
    assert.deepEqual(result.channels.map(item => item.id), ["UCONE", "UCTWO"]);
    assert.equal(result.channel.id, "UCONE");
  } finally {
    global.fetch = originalFetch;
  }
});
