import test from "node:test";
import assert from "node:assert/strict";
import { extractAffiliateCampaignTitle } from "../lib/daily-artifact-title.js";

test("extracts a plain affiliate campaign title", () => {
  assert.equal(extractAffiliateCampaignTitle("Campaign title: Summer Watch Guide", "2026-11-23"), "Summer Watch Guide");
});

test("extracts a bold affiliate campaign title", () => {
  assert.equal(extractAffiliateCampaignTitle("**Campaign title**: Summer Watch Guide", "2026-11-23"), "Summer Watch Guide");
});

test("extracts a Markdown heading when no labelled title is present", () => {
  assert.equal(extractAffiliateCampaignTitle("## Summer Watch Guide\nDetails follow.", "2026-11-23"), "Summer Watch Guide");
});

test("uses a safe daily fallback and limits title length", () => {
  assert.equal(extractAffiliateCampaignTitle("", "2026-11-23"), "Daily affiliate research brief 2026-11-23");
  assert.equal(extractAffiliateCampaignTitle("Title: " + "x".repeat(250), "2026-11-23").length, 180);
});
