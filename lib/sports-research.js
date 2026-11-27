const SPORTS_FEEDS = [
  { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml", hosts: [".bbc.co.uk", ".bbci.co.uk"] },
  { name: "ESPNcricinfo", url: "https://www.espncricinfo.com/rss/content/story/feeds/0.xml", hosts: [".espncricinfo.com", ".cricinfo.com"] }
];

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const match = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return match ? decodeXml(match[1]) : "";
}

function safeArticleUrl(raw, hosts) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!hosts.some(host => url.hostname === host.slice(1) || url.hostname.endsWith(host))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseSportsRss(xml, feed, { now = Date.now(), maxAgeHours = 96 } = {}) {
  const items = [];
  const blocks = String(xml || "").match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const title = tag(block, "title");
    const link = safeArticleUrl(tag(block, "link"), feed.hosts);
    const summary = tag(block, "description").slice(0, 240);
    const published = tag(block, "pubDate");
    const publishedAt = published ? Date.parse(published) : NaN;
    if (!title || !link || !Number.isFinite(publishedAt)) continue;
    const ageHours = (now - publishedAt) / 3600000;
    if (ageHours < -3 || ageHours > maxAgeHours) continue;
    items.push({
      sport: feed.name,
      title: title.slice(0, 180),
      summary,
      url: link,
      publishedAt: new Date(publishedAt).toISOString(),
      ageHours: Math.max(0, Math.round(ageHours))
    });
  }
  return items;
}

export async function fetchSportsResearch({ fetchImpl = fetch, now = Date.now(), timeoutMs = 9000 } = {}) {
  const results = await Promise.all(SPORTS_FEEDS.map(async feed => {
    try {
      const response = await fetchImpl(feed.url, {
        headers: { Accept: "application/rss+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error("RSS returned HTTP " + response.status);
      const xml = await response.text();
      return { feed: feed.name, status: "available", items: parseSportsRss(xml, feed, { now }) };
    } catch (error) {
      return { feed: feed.name, status: "unavailable", error: String(error?.message || error).slice(0, 240), items: [] };
    }
  }));
  const feeds = results.map(result => ({
    feed: result.feed,
    status: result.status,
    ...(result.error ? { error: result.error } : {}),
    itemCount: result.items.length
  }));
  const items = results.flatMap(result => result.items)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 6);
  return {
    status: items.length >= 3 ? "rss_headlines_available" : "insufficient_rss_evidence",
    fetchedAt: new Date(now).toISOString(),
    feeds,
    itemCount: items.length,
    items
  };
}

export function formatSportsResearchContext(research) {
  if (!research || !Array.isArray(research.items) || !research.items.length) {
    return "SPORTS RSS RESEARCH: unavailable or no recent items. Do not invent current sports news. Mark unsupported claims NEEDS_VERIFICATION and the article NOT READY.";
  }
  return [
    "FREE SPORTS RSS RESEARCH (HEADLINES AND FEED SUMMARIES ONLY; NOT FULL ARTICLE TEXT):",
    "Fetched at: " + String(research.fetchedAt || "unknown"),
    "Research status: " + String(research.status || "unknown"),
    "Feeds: " + JSON.stringify(research.feeds || []),
    "The entries below are real feed items with exact publisher article URLs and publication timestamps. Treat only the headline and summary as observed. Do not add match scores, statistics, quotes, team changes or details absent from the supplied summary. Use the publisher URL as a source lead and mark any unconfirmed details NEEDS_VERIFICATION.",
    JSON.stringify(research.items)
  ].join("\n");
}
