import test from "node:test";
import assert from "node:assert/strict";
import { getOpenRouterMaxTokens } from "../lib/openrouter-request.js";

test("OpenRouter always has enough output budget for a usable final answer", () => {
  assert.equal(getOpenRouterMaxTokens(350), 4096);
  assert.equal(getOpenRouterMaxTokens(900), 4096);
  assert.equal(getOpenRouterMaxTokens(1200), 4096);
});

test("OpenRouter preserves larger requested budgets up to a safe cap", () => {
  assert.equal(getOpenRouterMaxTokens(5000), 5000);
  assert.equal(getOpenRouterMaxTokens(9000), 8192);
});

test("OpenRouter uses a safe default for invalid token requests", () => {
  assert.equal(getOpenRouterMaxTokens(undefined), 4096);
  assert.equal(getOpenRouterMaxTokens("invalid"), 4096);
});
