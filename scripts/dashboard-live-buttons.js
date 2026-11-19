import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.MASTER_AI_BASE_URL || "https://master-ai-bot-iskj.onrender.com";
const agents = [
  ["master", "Master AI Brain"],
  ["youtube", "YouTube"],
  ["affiliate", "Affiliate Marketing"],
  ["blogging", "Blogging"],
  ["app-development", "App Development"],
  ["seo", "SEO"]
];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector('.agent-card[data-agent-id="master"]', { timeout: 90000 });

  const cards = page.locator(".agent-card[data-agent-id]");
  assert.equal(await cards.count(), 6, "The live dashboard must show exactly six agent buttons.");

  for (const [id, title] of agents) {
    const card = page.locator('.agent-card[data-agent-id="' + id + '"]');
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForFunction(
      expected => {
        const panel = document.querySelector("#agentWorkspace");
        const heading = document.querySelector("#workspaceTitle");
        return panel && !panel.hidden && heading && heading.textContent === expected;
      },
      title,
      { timeout: 10000 }
    );
    assert.equal(await page.locator("#workspaceRunButton").isVisible(), true, id + " workspace task button should be visible.");
    await page.locator("#workspaceBackButton").click();
    await page.waitForFunction(() => {
      const panel = document.querySelector("#agentWorkspace");
      return panel && panel.hidden;
    }, { timeout: 10000 });
    console.log("PASS live dashboard button:", id);
  }
  console.log("PASS: all six live dashboard buttons opened their own workspaces.");
} finally {
  await browser.close();
}
