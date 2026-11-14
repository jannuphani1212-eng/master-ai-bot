import test from "node:test";
import assert from "node:assert/strict";
import { createAffiliateCampaignHandlers } from "../lib/affiliate-campaigns.js";

const ownerId = "11111111-2222-4333-8444-555555555555";
const env = {
  SUPABASE_URL: "https://supabase.example.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key"
};

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body === null ? "" : JSON.stringify(body); }
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    redirected: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return value; },
    send(value) { this.body = value; return value; },
    redirect(code, url) { this.statusCode = code; this.redirected = url; return url; }
  };
}

const content = {
  researchStatus: "needs_live_verification",
  productSummary: "A sample product summary",
  claimsToVerify: ["Current price"],
  english: { youtubeShorts: { script: "English short" }, instagramReels: { script: "English reel" } },
  telugu: { youtubeShorts: { script: "Telugu short" }, instagramReels: { script: "Telugu reel" } },
  qualityChecklist: ["Verify product claims"]
};

test("affiliate campaign generation saves a bilingual draft with unverified claims", async () => {
  const originalFetch = global.fetch;
  let savedBody;
  let generatedTask = "";
  global.fetch = async (url, options = {}) => {
    assert.match(String(url), /affiliate_campaigns$/);
    assert.equal(options.method, "POST");
    savedBody = JSON.parse(options.body);
    return response(201, [{ id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", ...savedBody }]);
  };
  try {
    const handlers = createAffiliateCampaignHandlers({
      env,
      generateAI: async (task) => {
        generatedTask = task;
        return { result: JSON.stringify(content), provider: "Groq" };
      }
    });
    const res = mockRes();
    await handlers.generate({
      ownerUser: { id: ownerId },
      body: {
        productName: "Sample Watch",
        category: "Watches",
        merchant: "Example Store",
        productUrl: "https://store.example.test/watch",
        affiliateUrl: "https://affiliate.example.test/track",
        productFacts: "Water resistant; stainless steel",
        commissionRate: "7"
      }
    }, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(savedBody.owner_user_id, ownerId);
    assert.equal(savedBody.status, "draft");
    assert.equal(savedBody.research_status, "needs_live_verification");
    assert.equal(savedBody.commission_status, "owner_supplied_unverified");
    assert.equal(savedBody.commission_rate, 7);
    assert.equal(savedBody.generation_provider, "Groq");
    assert.deepEqual(savedBody.content_json, content);
    assert.match(generatedTask, /Telugu/);
    assert.match(generatedTask, /Do not claim you opened or researched either URL/);
    assert.match(generatedTask, /officially verified above 5%/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("affiliate campaign generation rejects non-HTTPS links before calling AI", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("Database should not be called"); };
  let called = false;
  try {
    const handlers = createAffiliateCampaignHandlers({
      env,
      generateAI: async () => { called = true; return { result: "{}", provider: "Groq" }; }
    });
    const res = mockRes();
    await handlers.generate({
      ownerUser: { id: ownerId },
      body: { productName: "Sample", category: "Fashion", productUrl: "javascript:alert(1)" }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("public affiliate redirect records an approved click and uses the stored HTTPS URL", async () => {
  const originalFetch = global.fetch;
  const writes = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("/affiliate_campaigns?")) {
      return response(200, [{
        id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        owner_user_id: ownerId,
        affiliate_url: "https://merchant.example.test/product?ref=abc",
        status: "approved"
      }]);
    }
    if (target.includes("/affiliate_click_events")) {
      writes.push(JSON.parse(options.body));
      return response(201, null);
    }
    throw new Error("Unexpected request " + target);
  };
  try {
    const handlers = createAffiliateCampaignHandlers({
      env,
      generateAI: async () => ({ result: "{}", provider: "Groq" })
    });
    const res = mockRes();
    await handlers.trackClick({
      params: { campaignId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      query: { src: "instagram_reels" }
    }, res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirected, "https://merchant.example.test/product?ref=abc");
    assert.deepEqual(writes, [{
      campaign_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      owner_user_id: ownerId,
      source: "instagram_reels"
    }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("click count uses the exact PostgREST count for the authenticated owner", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url, options = {}) => {
    requestedUrl = String(url);
    assert.equal(options.headers.Prefer, "count=exact");
    assert.equal(options.headers.Range, "0-0");
    return {
      ok: true,
      status: 200,
      headers: { get(name) { return name.toLowerCase() === "content-range" ? "0-0/42" : null; } },
      async text() { return "[]"; }
    };
  };
  try {
    const handlers = createAffiliateCampaignHandlers({
      env,
      generateAI: async () => ({ result: "{}", provider: "Groq" })
    });
    const res = mockRes();
    await handlers.clicks({
      params: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      ownerUser: { id: ownerId }
    }, res);
    assert.equal(res.body.totalClicks, 42);
    assert.match(requestedUrl, new RegExp("owner_user_id=eq\\." + ownerId));
  } finally {
    global.fetch = originalFetch;
  }
});

test("a campaign without an affiliate URL cannot be approved for click tracking", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    return response(200, [{ id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", affiliate_url: null, status: "draft" }]);
  };
  try {
    const handlers = createAffiliateCampaignHandlers({
      env,
      generateAI: async () => ({ result: "{}", provider: "Groq" })
    });
    const res = mockRes();
    await handlers.approve({
      params: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      ownerUser: { id: ownerId }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Add an approved affiliate tracking URL/);
    assert.equal(calls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("official commission CSV imports as owner-review-only rows", async () => {
  const originalFetch = global.fetch;
  let savedRows = [];
  let requestedUrl = "";
  global.fetch = async (url, options = {}) => {
    requestedUrl = String(url);
    savedRows = JSON.parse(options.body);
    return response(201, savedRows.map((row, index) => ({ id: "commission-" + index, ...row })));
  };
  try {
    const handlers = createAffiliateCampaignHandlers({
      env,
      generateAI: async () => ({ result: "{}", provider: "Groq" })
    });
    const res = mockRes();
    await handlers.importCommissions({
      ownerUser: { id: ownerId },
      body: {
        program: "Amazon Associates",
        sourceReference: "November 2026 official report",
        csvText: "order_id,report_date,commission_amount,currency,status\nORDER-1,2026-11-14,12.50,INR,paid\nORDER-2,2026-11-13,5.00,INR,pending"
      }
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.importedCount, 2);
    assert.ok(requestedUrl.includes("on_conflict=owner_user_id,program,external_order_id"));
    assert.deepEqual(savedRows.map(row => row.external_order_id), ["ORDER-1", "ORDER-2"]);
    assert.ok(savedRows.every(row => row.owner_user_id === ownerId));
    assert.ok(savedRows.every(row => row.verification_status === "needs_owner_review"));
    assert.ok(savedRows.every(row => row.source_type === "official_report_csv"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("commission CSV rejects invalid dates and statuses before writing", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error("Database must not be called"); };
  try {
    const handlers = createAffiliateCampaignHandlers({
      env,
      generateAI: async () => ({ result: "{}", provider: "Groq" })
    });
    const res = mockRes();
    await handlers.importCommissions({
      ownerUser: { id: ownerId },
      body: {
        program: "Affiliate Program",
        sourceReference: "Report",
        csvText: "order_id,report_date,commission_amount,currency,status\nORDER-1,2026-02-30,12.50,INR,paid"
      }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /real date/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("commission summary counts only entries the owner has verified", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response(200, [
    { id: "1", currency: "INR", commission_amount: "20.00", status: "paid", verification_status: "owner_verified" },
    { id: "2", currency: "INR", commission_amount: "10.00", status: "pending", verification_status: "owner_verified" },
    { id: "3", currency: "INR", commission_amount: "500.00", status: "paid", verification_status: "needs_owner_review" }
  ]);
  try {
    const handlers = createAffiliateCampaignHandlers({
      env,
      generateAI: async () => ({ result: "{}", provider: "Groq" })
    });
    const res = mockRes();
    await handlers.listCommissions({ ownerUser: { id: ownerId } }, res);
    assert.equal(res.body.needsReview, 1);
    assert.deepEqual(res.body.summary, [{
      currency: "INR",
      pending: 10,
      approved: 0,
      paid: 20,
      void: 0,
      verifiedTotal: 30
    }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("campaign list query is restricted to the authenticated owner", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async url => {
    requestedUrl = String(url);
    return response(200, []);
  };
  try {
    const handlers = createAffiliateCampaignHandlers({
      env,
      generateAI: async () => ({ result: "{}", provider: "Groq" })
    });
    const res = mockRes();
    await handlers.list({ ownerUser: { id: ownerId } }, res);
    assert.match(requestedUrl, new RegExp("owner_user_id=eq\\." + ownerId));
    assert.deepEqual(res.body.campaigns, []);
  } finally {
    global.fetch = originalFetch;
  }
});
