const TABLES = {
  youtube: [
    ["youtube_connections", "channel_id,channel_title,thumbnail_url,updated_at"],
    ["youtube_channel_connections", "channel_id,channel_title,thumbnail_url,updated_at"]
  ],
  affiliate: [
    ["affiliate_campaigns", "id,product_name,category,merchant,status,research_status,created_at"],
    ["affiliate_click_events", "id,source,clicked_at"],
    ["affiliate_commissions", "id,program,commission_amount,currency,status,verification_status,report_date,created_at"],
    ["instagram_connections", "ig_user_id,username,account_type,expires_at"]
  ],
  blogging: [
    ["blog_cms_connections", "id,provider,site_name,site_url,selected,created_at"],
    ["blog_drafts", "id,topic,language,target_keyword,status,created_at"],
    ["blog_cms_publications", "id,provider,remote_url,status,created_at"]
  ],
  seo: [
    ["search_console_connections", "id,google_email,created_at"]
  ],
  master: [
    ["self_healing_events", "id,agent_id,status,checked_at"]
  ],
  "app-development": []
};

function config(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceKey) throw new Error("Live portfolio data is not configured on the server.");
  return { url, serviceKey };
}

async function readRows(cfg, table, fields, ownerId, fetchImpl) {
  const url = cfg.url + "/rest/v1/" + table +
    "?select=" + fields +
    "&owner_user_id=eq." + encodeURIComponent(ownerId) +
    "&limit=200";
  const response = await fetchImpl(url, {
    headers: {
      apikey: cfg.serviceKey,
      Authorization: "Bearer " + cfg.serviceKey,
      Prefer: "count=exact",
      Range: "0-199"
    }
  });
  let data = [];
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error("Portfolio query failed for " + table + " (" + response.status + ").");
  const contentRange = response.headers?.get?.("content-range") || "";
  const totalText = contentRange.split("/")[1];
  const total = totalText && totalText !== "*" && Number.isFinite(Number(totalText))
    ? Number(totalText)
    : Array.isArray(data) ? data.length : 0;
  return { rows: Array.isArray(data) ? data : [], total };
}

export function createAgentPortfolioHandlers({ env = process.env, fetchImpl = fetch } = {}) {
  async function get(req, res) {
    try {
      const cfg = config(env);
      const ownerId = req.ownerUser.id;
      const result = {};
      for (const [agentId, tables] of Object.entries(TABLES)) {
        const entries = await Promise.all(tables.map(async ([table, fields]) => {
          try { return [table, await readRows(cfg, table, fields, ownerId, fetchImpl)]; }
          catch (error) { return [table, { rows: [], total: null, error: error.message }]; }
        }));
        result[agentId] = Object.fromEntries(entries);
      }

      const youtubeRows = [
        ...(result.youtube.youtube_connections?.rows || []),
        ...(result.youtube.youtube_channel_connections?.rows || [])
      ];
      const channels = [...new Map(youtubeRows.map(row => [row.channel_id, {
        id: row.channel_id,
        title: row.channel_title || "YouTube channel",
        thumbnail: row.thumbnail_url || null
      }])).values()];

      const campaigns = result.affiliate.affiliate_campaigns;
      const clicks = result.affiliate.affiliate_click_events;
      const commissions = result.affiliate.affiliate_commissions;
      const instagram = result.affiliate.instagram_connections;
      const sites = result.blogging.blog_cms_connections;
      const drafts = result.blogging.blog_drafts;
      const publications = result.blogging.blog_cms_publications;
      const searchConsole = result.seo.search_console_connections;
      const healthEvents = result.master.self_healing_events;
      const commissionRows = commissions?.rows || [];
      const commissionRowsComplete = commissions?.total !== null && commissionRows.length >= commissions.total;
      const verifiedCommissionRows = commissionRows.filter(row => row.verification_status === "owner_verified");
      const sumByCurrency = rows => Object.fromEntries(rows.reduce((totals, row) => {
        const currency = String(row.currency || "").toUpperCase();
        const amount = Number(row.commission_amount);
        if (/^[A-Z]{3}$/.test(currency) && Number.isFinite(amount) && amount >= 0) {
          totals.set(currency, (totals.get(currency) || 0) + amount);
        }
        return totals;
      }, new Map()));

      return res.json({
        success: true,
        generatedAt: new Date().toISOString(),
        source: "owner-scoped Supabase records",
        portfolio: {
          master: { registeredSpecialists: 5, healthEvents: healthEvents?.total ?? null },
          youtube: { connectedChannels: channels.length, channels },
          affiliate: {
            campaigns: campaigns?.total ?? null,
            trackedClicks: clicks?.total ?? null,
            commissionRecords: commissions?.total ?? null,
            instagramAccounts: instagram?.total ?? null,
            verifiedCommissionRecords: commissionRowsComplete ? verifiedCommissionRows.length : null,
            unverifiedCommissionRecords: commissionRowsComplete ? commissionRows.length - verifiedCommissionRows.length : null,
            verifiedCommissionTotalsByCurrency: commissionRowsComplete ? sumByCurrency(verifiedCommissionRows) : null,
            paidCommissionTotalsByCurrency: commissionRowsComplete ? sumByCurrency(verifiedCommissionRows.filter(row => row.status === "paid")) : null,
            pendingCommissionTotalsByCurrency: commissionRowsComplete ? sumByCurrency(verifiedCommissionRows.filter(row => row.status === "pending" || row.status === "approved")) : null,
            commissionTotalsComplete: commissionRowsComplete,
            campaignsPreview: (campaigns?.rows || []).map(row => ({
              product: row.product_name,
              category: row.category,
              merchant: row.merchant,
              status: row.status,
              researchStatus: row.research_status
            }))
          },
          blogging: {
            connectedSites: sites?.total ?? null,
            drafts: drafts?.total ?? null,
            cmsPublicationRecords: publications?.total ?? null,
            sitesPreview: (sites?.rows || []).map(row => ({
              provider: row.provider,
              name: row.site_name,
              url: row.site_url,
              selected: row.selected
            })),
            draftsPreview: (drafts?.rows || []).slice(0, 5).map(row => ({
              topic: row.topic,
              language: row.language,
              status: row.status
            }))
          },
          "app-development": {
            projectRegistryConnected: false,
            note: "No dedicated app project registry is connected yet. Completed app-development tasks appear in permanent agent history."
          },
          seo: {
            searchConsoleAccounts: searchConsole?.total ?? null,
            accountsPreview: (searchConsole?.rows || []).map(row => ({ googleEmail: row.google_email }))
          }
        },
        diagnostics: Object.fromEntries(Object.entries(result).map(([agentId, tables]) => [
          agentId,
          Object.fromEntries(Object.entries(tables).map(([table, value]) => [table, value.error || null]))
        ]))
      });
    } catch (error) {
      return res.status(503).json({ success: false, error: error.message || "Live portfolio data is unavailable." });
    }
  }
  return { get };
}
