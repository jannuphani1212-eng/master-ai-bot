const TABLE = "affiliate_campaigns";
const CLICKS = "affiliate_click_events";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MERCHANTS = [
  { name: "Amazon", hosts: ["amazon.in", "amazon.com", "amzn.to"] },
  { name: "Flipkart", hosts: ["flipkart.com", "dl.flipkart.com"] },
  { name: "Meesho", hosts: ["meesho.com"] },
  { name: "Myntra", hosts: ["myntra.com"] },
  { name: "AJIO", hosts: ["ajio.com"] },
  { name: "Nykaa", hosts: ["nykaa.com"] },
  { name: "Croma", hosts: ["croma.com"] },
  { name: "Reliance Digital", hosts: ["reliancedigital.in"] }
];

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(key + " is not configured on the server.");
  return value;
}

function config(env) {
  return {
    supabaseUrl: required(env, "SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    baseUrl: String(env.PUBLIC_APP_URL || env.RENDER_EXTERNAL_URL || "https://master-ai-bot-iskj.onrender.com").replace(/\/+$/, "")
  };
}

function merchantForHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return MERCHANTS.find(merchant => merchant.hosts.some(domain => host === domain || host.endsWith("." + domain))) || null;
}

export function validateAffiliateDestination(value, expectedMerchant = null) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new Error("Enter a valid merchant URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Affiliate and product links must use HTTPS without credentials or custom ports.");
  }
  const merchant = merchantForHost(url.hostname);
  if (!merchant) throw new Error("This merchant domain is not on the supported safe-redirect list.");
  if (expectedMerchant && merchant.name !== expectedMerchant) {
    throw new Error("Product and affiliate URLs must belong to the same supported merchant.");
  }
  return { url: url.toString(), merchant: merchant.name };
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

async function supabaseRequest(cfg, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(cfg.supabaseUrl + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: cfg.serviceKey,
      Authorization: "Bearer " + cfg.serviceKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(20000)
  });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error("Affiliate storage request failed (" + response.status + "): " +
      String(data?.message || data?.error || response.status).slice(0, 200));
  }
  return data;
}

function safeSource(value) {
  const source = String(value || "direct").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 80);
  return source || "direct";
}

export function createAffiliateHandlers({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  async function list(req, res) {
    try {
      const cfg = config(env);
      const ownerId = req.ownerUser?.id;
      if (!UUID.test(String(ownerId || ""))) return res.status(401).json({ success: false, error: "Owner sign-in is required." });
      const campaigns = await supabaseRequest(cfg,
        TABLE + "?select=id,product_name,category,merchant,product_url,affiliate_url,commission_rate,commission_status,research_status,status,content_json,created_at,updated_at&owner_user_id=eq." +
        encodeURIComponent(ownerId) + "&order=created_at.desc&limit=100", {}, fetchImpl);
      const clicks = Array.isArray(campaigns) && campaigns.length ? await supabaseRequest(cfg,
        CLICKS + "?select=campaign_id&owner_user_id=eq." + encodeURIComponent(ownerId) + "&limit=10000", {}, fetchImpl) : [];
      const counts = new Map();
      for (const click of Array.isArray(clicks) ? clicks : []) counts.set(click.campaign_id, (counts.get(click.campaign_id) || 0) + 1);
      const items = (Array.isArray(campaigns) ? campaigns : []).map(campaign => {
        let trackingUrl = null;
        const approvedForExternalUse = campaign.status === "active" &&
          campaign.content_json?.externalPublishingApproved === true;
        if (approvedForExternalUse && campaign.affiliate_url) {
          try {
            validateAffiliateDestination(campaign.affiliate_url);
            trackingUrl = cfg.baseUrl + "/go/" + campaign.id;
          } catch {}
        }
        return { ...campaign, clickCount: counts.get(campaign.id) || 0, trackingUrl };
      });
      return res.json({ success: true, campaigns: items });
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message });
    }
  }

  async function saveLink(req, res) {
    try {
      const cfg = config(env);
      const ownerId = req.ownerUser?.id;
      const id = String(req.params?.id || "");
      if (!UUID.test(String(ownerId || ""))) return res.status(401).json({ success: false, error: "Owner sign-in is required." });
      if (!UUID.test(id)) return res.status(400).json({ success: false, error: "Invalid campaign ID." });
      const product = validateAffiliateDestination(req.body?.productUrl);
      const affiliate = validateAffiliateDestination(req.body?.affiliateUrl, product.merchant);
      const existing = await supabaseRequest(cfg,
        TABLE + "?select=id,content_json&owner_user_id=eq." + encodeURIComponent(ownerId) +
        "&id=eq." + encodeURIComponent(id) + "&limit=1", {}, fetchImpl);
      if (!Array.isArray(existing) || !existing[0]) return res.status(404).json({ success: false, error: "Campaign not found in your owner workspace." });
      const content = existing[0].content_json && typeof existing[0].content_json === "object" ? existing[0].content_json : {};
      const body = {
        product_url: product.url,
        affiliate_url: affiliate.url,
        merchant: product.merchant,
        status: "draft",
        research_status: "needs_live_verification",
        commission_status: "not_provided",
        content_json: {
          ...content,
          affiliateLinkProvidedByOwner: true,
          affiliateLinkProvidedAt: new Date(now()).toISOString(),
          productFactsVerified: false,
          commissionVerified: false,
          externalPublishingApproved: false
        },
        updated_at: new Date(now()).toISOString()
      };
      const updated = await supabaseRequest(cfg,
        TABLE + "?id=eq." + encodeURIComponent(id) + "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&select=id,product_url,affiliate_url,merchant,status",
        { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) }, fetchImpl);
      if (!Array.isArray(updated) || !updated[0]) throw new Error("Affiliate link details were not saved.");
      return res.json({
        success: true,
        campaign: updated[0],
        trackingUrl: null,
        notice: "Link saved as an owner-provided draft. Tracking stays disabled until the campaign is explicitly activated and external use is owner-approved. Product facts and commission remain unverified."
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  async function activate(req, res) {
    try {
      const cfg = config(env);
      const ownerId = req.ownerUser?.id;
      const campaignId = String(req.params?.id || "");
      const approvalId = String(req.body?.approvalId || "");
      if (!UUID.test(String(ownerId || ""))) return res.status(401).json({ success: false, error: "Owner sign-in is required." });
      if (!UUID.test(campaignId) || !UUID.test(approvalId)) return res.status(400).json({ success: false, error: "Valid campaign and approval IDs are required." });

      const campaigns = await supabaseRequest(cfg,
        TABLE + "?select=id,owner_user_id,product_url,affiliate_url,merchant,status,content_json&id=eq." +
        encodeURIComponent(campaignId) + "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&limit=1", {}, fetchImpl);
      const campaign = Array.isArray(campaigns) ? campaigns[0] : null;
      if (!campaign) return res.status(404).json({ success: false, error: "Campaign not found in your owner workspace." });

      const approvals = await supabaseRequest(cfg,
        "approval_requests?select=id,owner_id,created_by,action_type,payload,status,decided_by,decided_at&id=eq." +
        encodeURIComponent(approvalId) + "&owner_id=eq." + encodeURIComponent(ownerId) + "&limit=1", {}, fetchImpl);
      const approval = Array.isArray(approvals) ? approvals[0] : null;
      const proposal = approval?.payload && typeof approval.payload === "object" ? approval.payload : {};
      if (!approval || approval.owner_id !== ownerId || approval.created_by !== ownerId ||
          approval.decided_by !== ownerId || approval.status !== "approved" ||
          approval.action_type !== "publish" || proposal.operation !== "affiliate_campaign_activate" ||
          proposal.campaignId !== campaignId) {
        return res.status(403).json({ success: false, error: "A matching, owner-approved affiliate activation proposal is required." });
      }

      if (campaign.status !== "draft" || campaign.content_json?.externalPublishingApproved === true) {
        return res.status(409).json({ success: false, error: "This campaign is not an eligible draft. Activation can be used only once." });
      }
      if (campaign.content_json?.affiliateLinkProvidedByOwner !== true) {
        return res.status(409).json({ success: false, error: "Save an owner-provided affiliate link before requesting activation." });
      }

      const product = validateAffiliateDestination(campaign.product_url, campaign.merchant);
      const affiliate = validateAffiliateDestination(campaign.affiliate_url, campaign.merchant);
      if (proposal.merchant !== campaign.merchant || proposal.productUrl !== product.url ||
          proposal.affiliateUrl !== affiliate.url) {
        return res.status(409).json({ success: false, error: "Campaign links or merchant changed after approval. Create a new proposal for the current details." });
      }

      const content = campaign.content_json && typeof campaign.content_json === "object" ? campaign.content_json : {};
      const activatedAt = new Date(now()).toISOString();
      const updated = await supabaseRequest(cfg,
        TABLE + "?id=eq." + encodeURIComponent(campaignId) +
        "&owner_user_id=eq." + encodeURIComponent(ownerId) +
        "&status=eq.draft&product_url=eq." + encodeURIComponent(campaign.product_url) +
        "&affiliate_url=eq." + encodeURIComponent(campaign.affiliate_url) +
        "&select=id,status,product_url,affiliate_url,merchant,content_json",
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            status: "active",
            content_json: {
              ...content,
              externalPublishingApproved: true,
              externalPublishingApprovedAt: activatedAt,
              externalPublishingApprovedBy: ownerId,
              externalPublishingApprovalRequestId: approvalId
            },
            updated_at: activatedAt
          })
        }, fetchImpl);
      if (!Array.isArray(updated) || !updated[0]) {
        return res.status(409).json({ success: false, error: "Campaign changed during activation. Refresh and create a new approval if needed." });
      }
      return res.json({
        success: true,
        campaign: updated[0],
        trackingUrl: cfg.baseUrl + "/go/" + campaignId,
        message: "Owner-approved tracking is now active. This does not publish content or verify commissions."
      });
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message });
    }
  }

  async function redirect(req, res) {
    try {
      const cfg = config(env);
      const id = String(req.params?.id || "");
      if (!UUID.test(id)) return res.status(404).send("Campaign link not found.");
      const rows = await supabaseRequest(cfg,
        TABLE + "?select=id,owner_user_id,affiliate_url,status,content_json&id=eq." + encodeURIComponent(id) + "&limit=1", {}, fetchImpl);
      const campaign = Array.isArray(rows) ? rows[0] : null;
      if (!campaign?.affiliate_url) return res.status(404).send("Campaign link is not ready.");
      if (campaign.status !== "active" || campaign.content_json?.externalPublishingApproved !== true) {
        return res.status(404).send("Campaign link is not approved for external use.");
      }
      const destination = validateAffiliateDestination(campaign.affiliate_url);
      const clickedAt = new Date(now()).toISOString();
      await supabaseRequest(cfg, CLICKS, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          campaign_id: campaign.id,
          owner_user_id: campaign.owner_user_id,
          source: safeSource(req.query?.source),
          clicked_at: clickedAt
        })
      }, fetchImpl);
      if (typeof res.set === "function") res.set("Cache-Control", "no-store");
      return res.redirect(302, destination.url);
    } catch (error) {
      console.error("Affiliate redirect could not be completed:", error.message);
      return res.status(503).send("Tracked link is temporarily unavailable. Please try again later.");
    }
  }

  return { list, saveLink, activate, redirect };
}
