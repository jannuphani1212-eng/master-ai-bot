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

test("research fetch returns bounded RSS evidence and explicit feed failures", async () => {
  const now = Date.parse("2026-11-27T11:00:00Z");
  const feedXml = (title, url, sport) => `<rss><channel><item>
    <title>${title}</title><link>${url}</link><description>${sport} update summary.</description>
    <pubDate>Fri, 27 Nov 2026 10:00:00 GMT</pubDate>
  </item></channel></rss>`;
  const fetchImpl = async url => {
    if (url.includes("espncricinfo")) return { ok: true, text: async () => feedXml("Cricket story", "https://www.espncricinfo.com/story/1", "Cricket") };
    if (url.includes("feeds.bbci.co.uk")) return { ok: true, text: async () => [
      feedXml("Football story", "https://www.bbc.co.uk/sport/football/1", "Football"),
      feedXml("Tennis story", "https://www.bbc.co.uk/sport/tennis/2", "Tennis")
    ].join("") };
    throw new Error("unexpected feed");
  };
  const result = await fetchSportsResearch({ fetchImpl, now });
  assert.equal(result.status, "rss_headlines_available");
  assert.equal(result.itemCount, 3);
  assert.equal(result.feeds.every(feed => feed.status === "available"), true);
  const context = formatSportsResearchContext(result);
  assert.match(context, /HEADLINES AND FEED SUMMARIES ONLY/);
  assert.match(context, /https:\/\/www\.espncricinfo\.com\/story\/1/);
  assert.match(context, /Do not add match scores/);
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
