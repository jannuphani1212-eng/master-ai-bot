import test from "node:test";
import assert from "node:assert/strict";
import { extractAffiliateCampaignTitle } from "../lib/daily-content.js";

test("extracts a bold campaign title label", () => {
  assert.equal(
    extractAffiliateCampaignTitle("**Campaign title:** Smart watches for everyday use"),
    "Smart watches for everyday use"
  );
});

test("extracts an ordinary working title label", () => {
  assert.equal(
    extractAffiliateCampaignTitle("Working title: Budget-friendly fashion picks"),
    "Budget-friendly fashion picks"
  );
});

test("falls back to the first Markdown heading", () => {
  assert.equal(
    extractAffiliateCampaignTitle("## Monsoon fashion affiliate shortlist\nDetails follow."),
    "Monsoon fashion affiliate shortlist"
  );
});

test("uses a dated generic title only when the report has no title", () => {
  assert.equal(
    extractAffiliateCampaignTitle("No title was provided.", "2026-11-23"),
    "Daily affiliate research brief 2026-11-23"
  );
});

test("limits campaign titles to the database-safe length", () => {
  assert.equal(extractAffiliateCampaignTitle("Title: " + "x".repeat(250)).length, 180);
});
