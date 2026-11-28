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
  assert.equal(payload.campaigns[0].trackingUrl, null);
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
  assert.equal(payload.trackingUrl, null);
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
      return response([{ id: campaignId, owner_user_id: ownerId, affiliate_url: "https://amzn.to/abc", status: "active", content_json: { externalPublishingApproved: true } }]);
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

test("public tracking redirect refuses a draft even when it has an affiliate URL", async () => {
  const handlers = createAffiliateHandlers({ env, fetchImpl: async () =>
    response([{ id: campaignId, owner_user_id: ownerId, affiliate_url: "https://amzn.to/abc", status: "draft", content_json: { externalPublishingApproved: false } }])
  });
  let statusCode;
  let message;
  let redirected = false;
  await handlers.redirect({ params: { id: campaignId }, query: {} }, {
    status(code) { statusCode = code; return this; },
    send(value) { message = value; return this; },
    redirect() { redirected = true; return this; }
  });
  assert.equal(statusCode, 404);
  assert.match(message, /not approved for external use/);
  assert.equal(redirected, false);
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


test("affiliate activation requires the matching approved owner proposal and exact saved links", async () => {
  const approvalId = "44444444-4444-4444-8444-444444444444";
  const productUrl = "https://www.amazon.in/dp/B012345678";
  const affiliateUrl = "https://www.amazon.in/dp/B012345678?tag=owner-21";
  const campaign = {
    id: campaignId, owner_user_id: ownerId, product_url: productUrl,
    affiliate_url: affiliateUrl, merchant: "Amazon", status: "draft",
    content_json: { affiliateLinkProvidedByOwner: true, commissionVerified: false }
  };
  const approval = {
    id: approvalId, owner_id: ownerId, created_by: ownerId, decided_by: ownerId,
    action_type: "publish", status: "approved",
    payload: { operation: "affiliate_campaign_activate", campaignId, productUrl, affiliateUrl, merchant: "Amazon" }
  };
  const calls = [];
  const handlers = createAffiliateHandlers({
    env, now: () => Date.parse("2026-11-28T12:00:00Z"),
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/rest/v1/affiliate_campaigns?select=id,owner_user_id")) return response([campaign]);
      if (String(url).includes("/rest/v1/approval_requests?select=id,owner_id")) return response([approval]);
      if (String(url).includes("/rest/v1/affiliate_campaigns?id=eq.")) {
        const body = JSON.parse(options.body);
        return response([{ id: campaignId, status: body.status, content_json: body.content_json }]);
      }
      throw new Error("Unexpected request " + url);
    }
  });
  let payload;
  let statusCode = 200;
  await handlers.activate({ ownerUser: { id: ownerId }, params: { id: campaignId }, body: { approvalId } }, {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; }
  });
  const update = calls.find(call => call.options.method === "PATCH");
  assert.equal(statusCode, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.campaign.status, "active");
  assert.equal(payload.trackingUrl, env.PUBLIC_APP_URL + "/go/" + campaignId);
  assert.equal(JSON.parse(update.options.body).content_json.externalPublishingApproved, true);
  assert.equal(JSON.parse(update.options.body).content_json.externalPublishingApprovalRequestId, approvalId);
  assert.match(update.url, /status=eq\.draft/);
});

test("affiliate activation refuses pending, rejected, or non-owner-approved proposals", async () => {
  for (const changes of [
    { status: "pending", decided_by: null },
    { status: "rejected" },
    { decided_by: "55555555-5555-4555-8555-555555555555" }
  ]) {
    const approvalId = "44444444-4444-4444-8444-444444444444";
    const campaign = {
      id: campaignId, owner_user_id: ownerId, product_url: "https://www.amazon.in/dp/B012345678",
      affiliate_url: "https://www.amazon.in/dp/B012345678?tag=owner-21", merchant: "Amazon",
      status: "draft", content_json: { affiliateLinkProvidedByOwner: true }
    };
    const approval = {
      id: approvalId, owner_id: ownerId, created_by: ownerId, decided_by: ownerId,
      action_type: "publish", status: "approved",
      payload: { operation: "affiliate_campaign_activate", campaignId, productUrl: campaign.product_url, affiliateUrl: campaign.affiliate_url, merchant: "Amazon" },
      ...changes
    };
    let patched = false;
    const handlers = createAffiliateHandlers({ env, fetchImpl: async (url, options = {}) => {
      if (String(url).includes("/rest/v1/affiliate_campaigns?select=id,owner_user_id")) return response([campaign]);
      if (String(url).includes("/rest/v1/approval_requests?select=id,owner_id")) return response([approval]);
      if (options.method === "PATCH") patched = true;
      return response([]);
    }});
    let payload;
    let statusCode = 200;
    await handlers.activate({ ownerUser: { id: ownerId }, params: { id: campaignId }, body: { approvalId } }, {
      status(code) { statusCode = code; return this; },
      json(value) { payload = value; return this; }
    });
    assert.equal(statusCode, 403);
    assert.equal(payload.success, false);
    assert.equal(patched, false);
  }
});

test("affiliate activation refuses changed links and already-active campaigns", async () => {
  const approvalId = "44444444-4444-4444-8444-444444444444";
  const productUrl = "https://www.amazon.in/dp/B012345678";
  const affiliateUrl = "https://www.amazon.in/dp/B012345678?tag=owner-21";
  const approval = {
    id: approvalId, owner_id: ownerId, created_by: ownerId, decided_by: ownerId,
    action_type: "publish", status: "approved",
    payload: { operation: "affiliate_campaign_activate", campaignId, productUrl, affiliateUrl, merchant: "Amazon" }
  };
  for (const campaign of [
    { id: campaignId, owner_user_id: ownerId, product_url: productUrl, affiliate_url: "https://www.amazon.in/dp/CHANGED?tag=owner-21", merchant: "Amazon", status: "draft", content_json: { affiliateLinkProvidedByOwner: true } },
    { id: campaignId, owner_user_id: ownerId, product_url: productUrl, affiliate_url: affiliateUrl, merchant: "Amazon", status: "active", content_json: { affiliateLinkProvidedByOwner: true, externalPublishingApproved: true } }
  ]) {
    let patched = false;
    const handlers = createAffiliateHandlers({ env, fetchImpl: async (url, options = {}) => {
      if (String(url).includes("/rest/v1/affiliate_campaigns?select=id,owner_user_id")) return response([campaign]);
      if (String(url).includes("/rest/v1/approval_requests?select=id,owner_id")) return response([approval]);
      if (options.method === "PATCH") patched = true;
      return response([]);
    }});
    let payload;
    let statusCode = 200;
    await handlers.activate({ ownerUser: { id: ownerId }, params: { id: campaignId }, body: { approvalId } }, {
      status(code) { statusCode = code; return this; },
      json(value) { payload = value; return this; }
    });
    assert.equal(statusCode, 409);
    assert.equal(payload.success, false);
    assert.equal(patched, false);
  }
});
