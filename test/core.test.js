import test from "node:test";
import assert from "node:assert/strict";
import { requestsAllSpecialists, fallbackAgentSelection } from "../lib/routing.js";
import { runProviderFallback } from "../lib/provider-fallback.js";
import { extractCompletionText } from "../lib/completion-text.js";
import { reviewSpecialistReport } from "../lib/quality-review.js";

const specialists = [
  { id: "affiliate" },
  { id: "youtube" },
  { id: "blogging" },
  { id: "app-development" },
  { id: "seo" }
];

test("explicit all-five request selects every specialist exactly once", () => {
  assert.equal(requestsAllSpecialists("Ask all five agents to review this plan"), true);
  assert.deepEqual(fallbackAgentSelection("Ask all five agents to review this plan", specialists), [
    "affiliate", "youtube", "blogging", "app-development", "seo"
  ]);
});

test("ordinary task selects only relevant specialists and caps at three", () => {
  assert.deepEqual(
    fallbackAgentSelection("Create YouTube shorts and SEO keywords for my affiliate blog", specialists),
    ["affiliate", "youtube", "blogging"]
  );
});

test("unknown task still has a deterministic safe specialist fallback", () => {
  assert.deepEqual(fallbackAgentSelection("Help me think through a new project", specialists), ["affiliate"]);
});

test("provider fallback skips unavailable and cooling providers, then returns first success", async () => {
  const attempts = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", available: false, call: async () => "unused" },
    { id: "groq", name: "Groq", available: true, call: async () => { attempts.push("groq"); throw new Error("quota"); } },
    { id: "openrouter", name: "OpenRouter", available: true, call: async () => { attempts.push("openrouter"); return "usable answer"; } }
  ], {
    isCoolingDown: id => id === "gemini",
    onFailure: () => {}
  });
  assert.deepEqual(attempts, ["groq", "openrouter"]);
  assert.deepEqual(result, { result: "usable answer", provider: "OpenRouter" });
});

test("provider fallback rejects empty completion text", async () => {
  await assert.rejects(
    runProviderFallback([
      { id: "openrouter", name: "OpenRouter", available: true, call: async () => "   " }
    ]),
    /returned no text/
  );
});

test("completion extraction handles string and multipart response content", () => {
  assert.equal(extractCompletionText({ choices: [{ message: { content: "Hello" } }] }, "Test"), "Hello");
  assert.equal(extractCompletionText({ choices: [{ message: { content: [{ text: "Hello" }, { content: "world" }] } }] }, "Test"), "Hello\nworld");
});

test("completion extraction reports unusable provider output", () => {
  assert.throws(
    () => extractCompletionText({ choices: [{ finish_reason: "length", message: { reasoning: "hidden" } }] }, "Test"),
    /returned no usable text/
  );
});

test("quality review flags a report missing required sections", () => {
  const review = reviewSpecialistReport("A short recommendation. Needs verification. Next action: test it.");
  assert.equal(review.status, "needs_review");
  assert.ok(review.missingSections.length > 0);
});

test("quality review passes a structurally complete, evidence-aware report", () => {
  const report = [
    "## 1. Executive summary", "Recommendation.",
    "## 2. Audience and assumptions", "Assumptions are stated.",
    "## 3. Research and evidence", "Evidence is verified where available; other items need verification.",
    "## 4. Recommended strategy", "Implement the plan.",
    "## 5. Concrete deliverables", "Create a draft.",
    "## 6. Measurement and KPIs", "Measure results.",
    "## 7. Risks and quality checks", "Review risks.",
    "## 8. Next three actions", "1. Test. 2. Review. 3. Improve."
  ].join("\n");
  assert.equal(reviewSpecialistReport(report).status, "passed");
});
