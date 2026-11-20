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
  const liveStatus = await page.evaluate(async () => {
    const response = await fetch("/api/status", { cache: "no-store" });
    return response.json();
  });
  console.log("Persistent history storage configured:", Boolean(liveStatus.agentHistoryStorage?.configured));
  console.log("YouTube OAuth configured:", Boolean(liveStatus.integrations?.youtube?.oauthConfigured));
  console.log("Affiliate campaign storage configured:", Boolean(liveStatus.integrations?.affiliate?.campaignTrackingStorage));
  console.log("Blog draft storage configured:", Boolean(liveStatus.integrations?.blogging?.draftStorage));
  console.log("Search Console OAuth configured:", Boolean(liveStatus.integrations?.seo?.searchConsoleOAuth));
  console.log("App repository automation configured:", Boolean(liveStatus.integrations?.["app-development"]?.repositoryAutomation));

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
  const incomePanel = page.locator("#incomeCentre");
  assert.equal(await incomePanel.count(), 1, "Income Centre section should exist.");
  assert.equal(await incomePanel.isVisible(), true, "Income Centre should be visible on the dashboard.");
  assert.equal(await page.locator(".income-stream-card").count(), 5, "Income Centre should show all five specialist income pathways.");
  await page.locator("#incomeCentreNav").click();
  await page.waitForFunction(() => document.querySelector("#incomeCentre")?.getBoundingClientRect().top < window.innerHeight);
  for (const agentId of ["affiliate","youtube","blogging","app-development","seo"]) {
    const button = page.locator('.income-plan-button[data-agent="' + agentId + '"]');
    assert.equal(await button.isVisible(), true, "Income plan button should exist for " + agentId);
  }
  console.log("PASS: Income Centre navigation and five income pathways.");
} finally {
  await browser.close();
}
