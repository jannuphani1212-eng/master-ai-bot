import test from "node:test";
import assert from "node:assert/strict";
import { createAgentPortfolioHandlers } from "./agent-portfolio.js";

function response(body, total = body.length) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: { get: name => name.toLowerCase() === "content-range" ? "0-0/" + total : null }
  };
}
function recorder() {
  return { statusCode: 200, status(code) { this.statusCode=code; return this; }, json(body) { this.body=body; return this; } };
}

test("portfolio reads use server credentials and the authenticated owner filter", async () => {
  const urls = [];
  const handlers = createAgentPortfolioHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-secret" },
    fetchImpl: async (url, options) => { urls.push({url,options}); return response([]); }
  });
  const res = recorder();
  await handlers.get({ ownerUser: { id: "owner-123" } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(urls[0].url, /owner_user_id=eq.owner-123/);
  assert.equal(urls[0].options.headers.Authorization, "Bearer server-secret");
  assert.equal(res.body.portfolio.youtube.connectedChannels, 0);
  assert.equal(res.body.portfolio["app-development"].projectRegistryConnected, false);
});

test("portfolio reports actual connected channels and campaign totals", async () => {
  const handlers = createAgentPortfolioHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async url => {
      if (url.includes("youtube_connections")) return response([{channel_id:"channel-1",channel_title:"Global Rhymes 4U"}], 1);
      if (url.includes("youtube_channel_connections")) return response([{channel_id:"channel-1",channel_title:"Global Rhymes 4U"}], 1);
      if (url.includes("affiliate_campaigns")) return response([{id:"c1",product_name:"Watch",category:"Fashion",status:"draft"}], 3);
      return response([], 0);
    }
  });
  const res = recorder();
  await handlers.get({ ownerUser: { id: "owner-123" } }, res);
  assert.equal(res.body.portfolio.youtube.connectedChannels, 1);
  assert.equal(res.body.portfolio.affiliate.campaigns, 3);
});

test("portfolio returns a safe configuration error when server credentials are missing", async () => {
  const handlers = createAgentPortfolioHandlers({ env: {}, fetchImpl: async () => response([]) });
  const res = recorder();
  await handlers.get({ ownerUser: { id: "owner-123" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
});

test("portfolio counts only owner-verified commissions as actual income", async () => {
  const handlers = createAgentPortfolioHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async url => {
      if (url.includes("affiliate_commissions")) {
        return response([
          { id: "one", commission_amount: "125.50", currency: "INR", status: "paid", verification_status: "owner_verified" },
          { id: "two", commission_amount: "80.00", currency: "INR", status: "pending", verification_status: "needs_owner_review" }
        ], 2);
      }
      return response([]);
    }
  });
  const res = recorder();
  await handlers.get({ ownerUser: { id: "owner-123" } }, res);
  const affiliate = res.body.portfolio.affiliate;
  assert.deepEqual(affiliate.verifiedCommissionTotalsByCurrency, { INR: 125.5 });
  assert.deepEqual(affiliate.paidCommissionTotalsByCurrency, { INR: 125.5 });
  assert.deepEqual(affiliate.pendingCommissionTotalsByCurrency, {});
  assert.equal(affiliate.verifiedCommissionRecords, 1);
  assert.equal(affiliate.unverifiedCommissionRecords, 1);
  assert.equal(affiliate.commissionTotalsComplete, true);
});

test("portfolio does not report partial commission sums when more than 200 rows exist", async () => {
  const handlers = createAgentPortfolioHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async url => url.includes("affiliate_commissions")
      ? response([{ commission_amount: "10", currency: "INR", status: "paid", verification_status: "owner_verified" }], 201)
      : response([])
  });
  const res = recorder();
  await handlers.get({ ownerUser: { id: "owner-123" } }, res);
  const affiliate = res.body.portfolio.affiliate;
  assert.equal(affiliate.commissionTotalsComplete, false);
  assert.equal(affiliate.verifiedCommissionTotalsByCurrency, null);
});
