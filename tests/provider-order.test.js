import test from "node:test";
import assert from "node:assert/strict";
import { resolveProviderOrder } from "../lib/provider-order.js";

test("uses Gemini then Groq then OpenRouter by default", () => {
  assert.deepEqual(resolveProviderOrder(undefined), ["gemini", "groq", "openrouter"]);
});

test("honours a configured order and appends remaining providers", () => {
  assert.deepEqual(
    resolveProviderOrder("openrouter,groq", ["gemini", "groq", "openrouter"]),
    ["openrouter", "groq", "gemini"]
  );
});

test("removes duplicates and ignores unknown provider names", () => {
  assert.deepEqual(
    resolveProviderOrder("mystery,gemini,gemini,groq", ["gemini", "groq", "openrouter"]),
    ["gemini", "groq", "openrouter"]
  );
});

test("falls back to the default order when configuration is blank", () => {
  assert.deepEqual(resolveProviderOrder("   "), ["gemini", "groq", "openrouter"]);
});
