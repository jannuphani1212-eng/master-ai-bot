import test from "node:test";
import assert from "node:assert/strict";
import { runProviderFallback } from "./provider-fallback.js";

test("returns the first successful provider", async () => {
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", call: async () => "answer" },
    { id: "groq", name: "Groq", call: async () => "backup" }
  ]);
  assert.deepEqual(result, { result: "answer", provider: "Gemini" });
});

test("continues to the next provider after a failure", async () => {
  const failed = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", call: async () => { throw new Error("503 UNAVAILABLE"); } },
    { id: "groq", name: "Groq", call: async () => "backup answer" }
  ], { onFailure(provider, error) { failed.push([provider.name, error.message]); } });
  assert.deepEqual(result, { result: "backup answer", provider: "Groq" });
  assert.deepEqual(failed, [["Gemini", "503 UNAVAILABLE"]]);
});

test("skips unconfigured and cooling-down providers", async () => {
  const attempts = [];
  const skipped = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", available: false, call: async () => "wrong" },
    { id: "groq", name: "Groq", call: async () => "wrong" },
    { id: "openrouter", name: "OpenRouter", call: async () => "backup" }
  ], {
    isCoolingDown: id => id === "groq",
    onAttempt: provider => attempts.push(provider.name),
    onSkipped: (provider, reason) => skipped.push([provider.name, reason])
  });
  assert.deepEqual(result, { result: "backup", provider: "OpenRouter" });
  assert.deepEqual(attempts, ["OpenRouter"]);
  assert.deepEqual(skipped, [["Gemini", "API key not configured"], ["Groq", "provider is cooling down"]]);
});

test("reports errors when every configured provider fails", async () => {
  await assert.rejects(
    runProviderFallback([
      { id: "gemini", name: "Gemini", call: async () => { throw new Error("503"); } },
      { id: "groq", name: "Groq", call: async () => { throw new Error("429"); } }
    ]),
    /Gemini: 503 \| Groq: 429/
  );
});
