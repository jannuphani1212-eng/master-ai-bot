import test from "node:test";
import assert from "node:assert/strict";
import { createAffiliateHandlers, validateAffiliateDestination } from "./affiliate-integration.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const campaignId = "22222222-2222-4222-8222-222222222222";
const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  PUBLIC_APP_URL: "https://master-ai-bot-iskj.onrender.com"
};

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

test("affiliate destination validator allows supported HTTPS merchant links only", () => {
  assert.equal(validateAffiliateDestination("https://www.amazon.in/dp/B012345678").merchant, "Amazon");
  assert.equal(validateAffiliateDestination("https://dl.flipkart.com/dl/item").merchant, "Flipkart");
  assert.throws(() => validateAffiliateDestination("http://amazon.in/dp/item"), /HTTPS/);
  assert.throws(() => validateAffiliateDestination("https://evil.example/redirect"), /safe-redirect list/);
  assert.throws(() => validateAffiliateDestination("https://amzn.to/abc", "Flipkart"), /same supported merchant/);
});

test("campaign list returns click counts and tracked links only for safe saved URLs", async () => {
  const handlers = createAffiliateHandlers({ env, fetchImpl: async url => {
    if (String(url).includes("/rest/v1/affiliate_campaigns")) {
      return response([
        { id: campaignId, product_name: "Watch research brief", category: "Research brief", affiliate_url: "https://amzn.to/abc", status: "draft" },
        { id: "33333333-3333-4333-8333-333333333333", product_name: "Unverified", affiliate_url: "https://evil.example/x", status: "draft" }
      ]);
    }
    if (String(url).includes("/rest/v1/affiliate_click_events")) {
      return response([{ campaign_id: campaignId }, { campaign_id: campaignId }]);
    }
    throw new Error("Unexpected request " + url);
  }});
  let payload;
  await handlers.list({ ownerUser: { id: ownerId } }, { json(value) { payload = value; return this; }, status() { return this; } });
  assert.equal(payload.campaigns[0].clickCount, 2);
  assert.equal(payload.campaigns[0].trackingUrl, env.PUBLIC_APP_URL + "/go/" + campaignId);
  assert.equal(payload.campaigns[1].trackingUrl, null);
});

test("owner can save a merchant-matched affiliate link without falsely verifying commission", async () => {
  let updateBody;
  const handlers = createAffiliateHandlers({ env, fetchImpl: async (url, options = {}) => {
    if (String(url).includes("/rest/v1/affiliate_campaigns?select=id,content_json")) {
      return response([{ id: campaignId, content_json: { report: "Research draft" } }]);
    }
    if (String(url).includes("/rest/v1/affiliate_campaigns?id=eq.")) {
      updateBody = JSON.parse(options.body);
      return response([{ id: campaignId, product_url: updateBody.product_url, affiliate_url: updateBody.affiliate_url, merchant: updateBody.merchant, status: updateBody.status }]);
    }
    throw new Error("Unexpected request " + url);
  }});
  let payload;
  await handlers.saveLink({
    ownerUser: { id: ownerId },
    params: { id: campaignId },
    body: { productUrl: "https://www.amazon.in/dp/B012345678", affiliateUrl: "https://www.amazon.in/dp/B012345678?tag=owner-21" }
  }, { json(value) { payload = value; return this; }, status() { return this; } });
  assert.equal(payload.success, true);
  assert.equal(payload.trackingUrl, env.PUBLIC_APP_URL + "/go/" + campaignId);
  assert.equal(updateBody.commission_status, "not_provided");
  assert.equal(updateBody.research_status, "needs_live_verification");
  assert.equal(updateBody.content_json.affiliateLinkProvidedByOwner, true);
  assert.equal(updateBody.content_json.commissionVerified, false);
});

test("public tracking redirect records the click before redirecting", async () => {
  const calls = [];
  const handlers = createAffiliateHandlers({ env, now: () => Date.parse("2026-11-27T12:00:00Z"), fetchImpl: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/rest/v1/affiliate_campaigns")) {
      return response([{ id: campaignId, owner_user_id: ownerId, affiliate_url: "https://amzn.to/abc" }]);
    }
    if (String(url).includes("/rest/v1/affiliate_click_events")) return response([]);
    throw new Error("Unexpected request " + url);
  }});
  let redirect;
  let redirectStatus;
  await handlers.redirect({ params: { id: campaignId }, query: { source: "blog post 1" } }, {
    redirect(status, url) { redirectStatus = status; redirect = url; return this; },
    set() { return this; },
    status() { return this; },
    send() { return this; }
  });
  const insert = calls.find(call => call.url.includes("/rest/v1/affiliate_click_events"));
  const body = JSON.parse(insert.options.body);
  assert.equal(body.campaign_id, campaignId);
  assert.equal(body.owner_user_id, ownerId);
  assert.equal(body.source, "blog-post-1");
  assert.equal(redirectStatus, 302);
  assert.equal(redirect, "https://amzn.to/abc");
});

test("public tracking redirect refuses a missing campaign", async () => {
  const handlers = createAffiliateHandlers({ env, fetchImpl: async () => response([]) });
  let statusCode;
  let message;
  await handlers.redirect({ params: { id: campaignId }, query: {} }, {
    status(code) { statusCode = code; return this; },
    send(value) { message = value; return this; }
  });
  assert.equal(statusCode, 404);
  assert.match(message, /not ready|not found/);
});
