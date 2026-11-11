import test from "node:test";
import assert from "node:assert/strict";
import { fallbackAgentSelection, requestsAllSpecialists } from "../lib/routing.js";

const specialists = [
  { id: "affiliate" },
  { id: "youtube" },
  { id: "blogging" },
  { id: "app-development" },
  { id: "seo" }
];

test("recognizes common all-specialist request wording", () => {
  for (const phrase of [
    "use all five specialists",
    "use all 5 bots",
    "ask all specialists",
    "ask all agents",
    "ask every specialist",
    "ask every bot",
    "send this to all the agents"
  ]) {
    assert.equal(requestsAllSpecialists(phrase), true, phrase);
  }
});

test("does not classify a single-specialist request as all-specialists", () => {
  assert.equal(requestsAllSpecialists("Ask the SEO specialist"), false);
});

test("all-specialist fallback returns each specialist exactly once", () => {
  assert.deepEqual(
    fallbackAgentSelection("Use all five bots", specialists),
    specialists.map((agent) => agent.id)
  );
});

test("topic fallback selects the relevant specialist", () => {
  assert.deepEqual(
    fallbackAgentSelection("Create an SEO keyword plan", specialists),
    ["seo"]
  );
});

test("topic fallback limits selection to three unique specialists", () => {
  const selected = fallbackAgentSelection(
    "Create an affiliate YouTube blog app SEO plan",
    specialists
  );
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected).size, 3);
});
