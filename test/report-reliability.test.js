import test from "node:test";
import assert from "node:assert/strict";
import { reviewSpecialistReport } from "../lib/quality-review.js";
import { runProviderFallback } from "../lib/provider-fallback.js";
import { isRetryableTpmRateLimit, getTpmRetryDelayMs } from "../lib/rate-limit.js";
import { extractCompletionText } from "../lib/completion-text.js";
import { mergeMissingReportSections } from "../lib/report-repair.js";

const completeReport = [
  "## 1. Executive summary", "Recommendation.",
  "## 2. Audience and assumptions", "Assumptions are stated.",
  "## 3. Research and evidence", "Commission figures need live verification.",
  "## 4. Recommended strategy", "Implement the plan.",
  "## 5. Concrete deliverables", "Create a draft.",
  "## 6. Measurement and KPIs", "Measure clicks and conversions.",
  "## 7. Risks and quality checks", "Review policy risks.",
  "## 8. Next three actions", "1. Test. 2. Review. 3. Improve."
].join("\n");

test("unverified numeric claims warn separately without lowering structural score", () => {
  const review = reviewSpecialistReport(completeReport + "\nProposed target: 10 sales per month.");
  assert.equal(review.status, "passed");
  assert.equal(review.score, 100);
  assert.equal(review.evidenceReview, "needs_verification");
  assert.equal(review.factualAccuracyScore, null);
  assert.ok(review.warnings.some(item => /numerical.*claims/i.test(item)));
});

test("Blogging report headings and unverified numerical proposals pass structural review", () => {
  const bloggingReport = [
    "## 1. Executive summary", "A focused editorial proposal.",
    "## 2. Audience and assumptions", "Assumption: analytics are not supplied.",
    "## 3. Research and evidence", "Keyword demand needs live verification.",
    "## 4. Recommended strategy", "Build the article outline.",
    "## 5. Concrete deliverables", "Create an outline and fact-check list.",
    "## 6. Measurement plan", "Measure impressions and clicks after publication.",
    "## 7. Risks, policy checks and quality-control steps", "Review sources and licensing.",
    "## 8. Next three actions", "1. Research. 2. Draft. 3. Review.",
    "Proposed target: 10 visits per day, unverified."
  ].join("\\n");
  const review = reviewSpecialistReport(bloggingReport);
  assert.equal(review.status, "passed", JSON.stringify(review));
  assert.equal(review.score, 100);
  assert.equal(review.evidenceReview, "needs_verification");
  assert.equal(review.factualAccuracyScore, null);
});

test("missing report sections remain structural failures", () => {
  const review = reviewSpecialistReport("## 1. Executive summary\nAssumptions need verification. Build a draft.");
  assert.equal(review.status, "needs_review");
  assert.ok(review.missingSections.length > 0);
});

test("Groq TPM rate limit is detected and retry delay is bounded", () => {
  const error = new Error("Groq HTTP 429: Rate limit reached on tokens per minute (TPM). Try again in 2.6775s.");
  assert.equal(isRetryableTpmRateLimit(error), true);
  assert.equal(getTpmRetryDelayMs(error), 2678);
  assert.equal(getTpmRetryDelayMs(new Error("try again in 999s")), 15000);
  assert.equal(isRetryableTpmRateLimit(new Error("HTTP 429 daily request quota")), false);
});

test("provider fallback retries one TPM-limited provider then succeeds", async () => {
  let calls = 0;
  const waits = [];
  const result = await runProviderFallback([
    { id: "groq", name: "Groq", available: true, call: async () => {
      calls += 1;
      if (calls === 1) throw new Error("HTTP 429 tokens per minute (TPM), try again in 1.2s");
      return "Recovered report";
    }},
    { id: "openrouter", name: "OpenRouter", available: true, call: async () => "unused" }
  ], { sleep: async ms => waits.push(ms) });
  assert.deepEqual(result, { result: "Recovered report", provider: "Groq" });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1200]);
});

test("TPM retry uses capped exponential backoff", async () => {
  let calls = 0;
  const waits = [];
  const result = await runProviderFallback([
    { id: "groq", name: "Groq", available: true, call: async () => {
      calls += 1;
      if (calls < 3) throw new Error("HTTP 429 tokens per minute (TPM), try again in 1s");
      return "Recovered after backoff";
    }}
  ], { sleep: async ms => waits.push(ms) });
  assert.equal(result.result, "Recovered after backoff");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test("provider fallback preserves failure details after TPM retry is exhausted", async () => {
  let calls = 0;
  await assert.rejects(
    runProviderFallback([
      { id: "groq", name: "Groq", available: true, call: async () => {
        calls += 1;
        throw new Error("HTTP 429 tokens per minute (TPM), try again in 1s");
      }}
    ], { sleep: async () => {} }),
    /Groq: HTTP 429 tokens per minute/
  );
  assert.equal(calls, 3);
});

test("OpenRouter empty response diagnostics include finish reason and provider error metadata", () => {
  assert.throws(
    () => extractCompletionText({
      id: "resp_123",
      model: "example/model",
      error: { code: "upstream_error", message: "upstream temporarily unavailable" },
      choices: [{ finish_reason: "error", message: { role: "assistant", content: null } }],
      usage: { completion_tokens: 0 }
    }, "OpenRouter"),
    error => /finish_reason=error/.test(error.message) &&
      /model=example\/model/.test(error.message) &&
      /upstream_error/.test(error.message) &&
      /upstream temporarily unavailable/.test(error.message)
  );
});

test("missing-section merge preserves the original report and appends only generated content", () => {
  const original = "## Executive summary\nKeep this useful draft.";
  const merged = mergeMissingReportSections(original, "## Research and evidence\nNeeds live verification.");
  assert.ok(merged.startsWith(original));
  assert.ok(merged.includes("## Research and evidence"));
  assert.equal(mergeMissingReportSections(original, ""), original);
});
