import test from "node:test";
import assert from "node:assert/strict";
import { getTpmRetryDelayMs, isRetryableTpmRateLimit } from "./rate-limit.js";

test("parses Groq TPM reset windows longer than fifteen seconds", () => {
  const error = new Error("HTTP 429: Rate limit reached on tokens per minute (TPM). Please try again in 24.8325s.");
  assert.equal(isRetryableTpmRateLimit(error), true);
  assert.equal(getTpmRetryDelayMs(error), 24833);
});

test("caps unusually long TPM reset windows at sixty seconds", () => {
  const error = new Error("HTTP 429 TPM rate limit. Please try again in 90s.");
  assert.equal(getTpmRetryDelayMs(error), 60000);
});

import { getProviderQuotaCooldownSeconds } from "./rate-limit.js";

test("uses a full-day cooldown for daily provider quota exhaustion", () => {
  assert.equal(getProviderQuotaCooldownSeconds("Groq rate limit reached on tokens per day (TPD)"), 86400);
  assert.equal(getProviderQuotaCooldownSeconds("Gemini RESOURCE_EXHAUSTED free_tier_requests quota"), 86400);
});

test("keeps a shorter cooldown for non-daily provider rate limits", () => {
  assert.equal(getProviderQuotaCooldownSeconds("HTTP 429 requests per minute"), 3600);
  assert.equal(getProviderQuotaCooldownSeconds("temporary provider overload"), 3600);
});
