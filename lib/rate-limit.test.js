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
