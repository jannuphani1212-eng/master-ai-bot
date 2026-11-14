import test from "node:test";
import assert from "node:assert/strict";
import { resolveProviderOrder } from "../lib/provider-order.js";

test("uses Groq then OpenRouter then Gemini by default", () => {
  assert.deepEqual(resolveProviderOrder(undefined), ["groq", "openrouter", "gemini"]);
});

test("honours a configured order and appends remaining providers", () => {
  assert.deepEqual(
    resolveProviderOrder("openrouter,groq", ["groq", "openrouter", "gemini"]),
    ["openrouter", "groq", "gemini"]
  );
});

test("removes duplicates and ignores unknown provider names", () => {
  assert.deepEqual(
    resolveProviderOrder("mystery,gemini,gemini,groq", ["groq", "openrouter", "gemini"]),
    ["gemini", "groq", "openrouter"]
  );
});

test("falls back to the default order when configuration is blank", () => {
  assert.deepEqual(resolveProviderOrder("   "), ["groq", "openrouter", "gemini"]);
});
