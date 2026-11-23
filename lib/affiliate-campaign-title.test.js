import test from "node:test";
import assert from "node:assert/strict";
import { extractAffiliateCampaignTitle } from "./affiliate-campaign-title.js";

test("extracts a plain Campaign title label", () => {
  assert.equal(extractAffiliateCampaignTitle("Campaign title: Summer watch shortlist\nDetails", "2026-11-23"), "Summer watch shortlist");
});

test("extracts a bold title label", () => {
  assert.equal(extractAffiliateCampaignTitle("**Campaign title:** Budget fashion picks", "2026-11-23"), "Budget fashion picks");
});

test("falls back to the first Markdown heading", () => {
  assert.equal(extractAffiliateCampaignTitle("# Affordable everyday watches\nMore details", "2026-11-23"), "Affordable everyday watches");
});

test("uses a dated fallback when the report has no title", () => {
  assert.equal(extractAffiliateCampaignTitle("No title was returned.", "2026-11-23"), "Daily affiliate research brief 2026-11-23");
});

test("trims and caps extracted titles", () => {
  const longTitle = "A".repeat(240);
  assert.equal(extractAffiliateCampaignTitle("Title: " + longTitle, "2026-11-23").length, 180);
});
