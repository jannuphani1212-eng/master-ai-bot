import test from "node:test";
import assert from "node:assert/strict";
import { fallbackAgentSelection, requestsAllSpecialists } from "../lib/routing.js";

const agents = [
  { id: "affiliate" },
  { id: "youtube" },
  { id: "blogging" },
  { id: "app-development" },
  { id: "seo" }
];

test("recognises an explicit request for all five specialists", () => {
  assert.equal(requestsAllSpecialists("Use all five bots to review this plan"), true);
  assert.deepEqual(fallbackAgentSelection("Use all five bots", agents), [
    "affiliate", "youtube", "blogging", "app-development", "seo"
  ]);
});

test("selects relevant specialists without duplicates", () => {
  assert.deepEqual(
    fallbackAgentSelection("Create an Amazon affiliate YouTube Shorts plan", agents),
    ["affiliate", "youtube"]
  );
});

test("limits ordinary fallback plans to three specialists", () => {
  const selected = fallbackAgentSelection(
    "affiliate Amazon YouTube video blog article app code SEO keywords",
    agents
  );
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected).size, selected.length);
});

test("uses a deterministic default when no specialist keyword matches", () => {
  assert.deepEqual(fallbackAgentSelection("Help me with a general task", agents), ["affiliate"]);
});

test("does not mistake an empty request for an all-specialist request", () => {
  assert.equal(requestsAllSpecialists(""), false);
});
