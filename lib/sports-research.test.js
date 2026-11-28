import test from "node:test";
import assert from "node:assert/strict";
import { parseSportsRss, fetchSportsResearch, formatSportsResearchContext } from "./sports-research.js";

const BBC = { name: "BBC Sport", hosts: [".bbc.co.uk", ".bbci.co.uk"] };

test("RSS parser extracts recent publisher headlines, summaries, and exact article URLs", () => {
  const xml = `<rss><channel><item>
    <title>India win a close cricket contest &amp; advance</title>
    <link>https://www.bbc.co.uk/sport/cricket/123</link>
    <description><![CDATA[India secured a close win in the final over.]]></description>
    <pubDate>Fri, 27 Nov 2026 10:00:00 GMT</pubDate>
  </item></channel></rss>`;
  const items = parseSportsRss(xml, BBC, { now: Date.parse("2026-11-27T11:00:00Z") });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "India win a close cricket contest & advance");
  assert.equal(items[0].summary, "India secured a close win in the final over.");
  assert.equal(items[0].url, "https://www.bbc.co.uk/sport/cricket/123");
});

test("RSS parser rejects unsafe hosts, HTTP links, and stale or future-dated items", () => {
  const xml = `<rss><channel>
    <item><title>Unsafe</title><link>https://evil.example/sport</link><description>x</description><pubDate>Fri, 27 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>HTTP</title><link>http://www.bbc.co.uk/sport/1</link><description>x</description><pubDate>Fri, 27 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><title>Old</title><link>https://www.bbc.co.uk/sport/2</link><description>x</description><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate></item>
    <item><title>Future</title><link>https://www.bbc.co.uk/sport/3</link><description>x</description><pubDate>Sat, 28 Nov 2026 20:00:00 GMT</pubDate></item>
  </channel></rss>`;
  assert.deepEqual(parseSportsRss(xml, BBC, { now: Date.parse("2026-11-27T11:00:00Z") }), []);
});

test("research fetch selects recent items across at least three distinct sports", async () => {
  const now = Date.parse("2026-11-27T11:00:00Z");
  const feedXml = (title, url, sport) => `<rss><channel><item>
    <title>${title}</title><link>${url}</link><description>${sport} update summary.</description>
    <pubDate>Fri, 27 Nov 2026 10:00:00 GMT</pubDate>
  </item></channel></rss>`;
  const fetchImpl = async url => {
    if (url.endsWith("/cricket/rss.xml")) return { ok: true, text: async () => feedXml("Cricket story", "https://www.bbc.co.uk/sport/cricket/1", "Cricket") };
    if (url.endsWith("/football/rss.xml")) return { ok: true, text: async () => feedXml("Football story", "https://www.bbc.co.uk/sport/football/2", "Football") };
    if (url.endsWith("/tennis/rss.xml")) return { ok: true, text: async () => feedXml("Tennis story", "https://www.bbc.co.uk/sport/tennis/3", "Tennis") };
    if (url.includes("espncricinfo")) return { ok: true, text: async () => feedXml("Cricket analysis", "https://www.espncricinfo.com/story/4", "Cricket") };
    throw new Error("feed not available in this test");
  };
  const result = await fetchSportsResearch({ fetchImpl, now });
  assert.equal(result.status, "rss_headlines_available");
  assert.equal(result.itemCount, 4);
  assert.equal(result.sportCount, 3);
  assert.equal(new Set(result.items.map(item => item.sport)).size, 3);
  assert.ok(result.feeds.filter(feed => feed.status === "available").length >= 3);
  const context = formatSportsResearchContext(result);
  assert.match(context, /HEADLINES AND FEED SUMMARIES ONLY/);
  assert.match(context, /https:\/\/www\.espncricinfo\.com\/story\/4/);
  assert.match(context, /Do not add match scores/);
});

test("one sport with many recent headlines is not sufficient multi-sport research", async () => {
  const now = Date.parse("2026-11-27T11:00:00Z");
  const xml = `<rss><channel>${Array.from({length: 5}, (_, index) =>
    `<item><title>Cricket story ${index}</title><link>https://www.bbc.co.uk/sport/cricket/${index}</link><description>Cricket update.</description><pubDate>Fri, 27 Nov 2026 10:00:00 GMT</pubDate></item>`
  ).join("")}</channel></rss>`;
  const result = await fetchSportsResearch({
    fetchImpl: async url => {
      if (url.endsWith("/cricket/rss.xml")) return { ok: true, text: async () => xml };
      throw new Error("feed unavailable in single-sport fixture");
    },
    now
  });
  assert.equal(result.itemCount, 5);
  assert.equal(result.sportCount, 1);
  assert.equal(result.status, "insufficient_rss_evidence");
});

test("unavailable feeds are reported honestly instead of inventing research", async () => {
  const result = await fetchSportsResearch({
    fetchImpl: async () => { throw new Error("network blocked"); },
    now: Date.parse("2026-11-27T11:00:00Z")
  });
  assert.equal(result.status, "insufficient_rss_evidence");
  assert.equal(result.itemCount, 0);
  assert.match(formatSportsResearchContext(result), /unavailable or no recent items/);
});


test("RSS research limits headline count and summary size to protect provider output budget", async () => {
  const now = Date.parse("2026-11-27T11:00:00Z");
  const item = (n) => `<item><title>Story ${n}</title><link>https://www.bbc.co.uk/sport/${n}</link><description>${"summary ".repeat(100)}</description><pubDate>Fri, 27 Nov 2026 10:00:00 GMT</pubDate></item>`;
  const fetchImpl = async url => ({
    ok: true,
    text: async () => `<rss><channel>${Array.from({length: 20}, (_, n) => item(n + 1)).join("")}</channel></rss>`
  });
  const result = await fetchSportsResearch({ fetchImpl, now });
  assert.ok(result.itemCount <= 8);
  assert.ok(result.items.every(entry => entry.summary.length <= 360));
});
