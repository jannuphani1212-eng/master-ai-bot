import test from "node:test";
import assert from "node:assert/strict";
import { runProviderFallback } from "../lib/provider-fallback.js";

test("reports the provider that actually succeeds", async () => {
  const events = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", call: async () => { throw new Error("503"); } },
    { id: "groq", name: "Groq", call: async () => "backup answer" }
  ], {
    onAttempt: provider => events.push("attempt:" + provider.name),
    onFailure: provider => events.push("failed:" + provider.name),
    onSuccess: provider => events.push("success:" + provider.name)
  });

  assert.deepEqual(result, { result: "backup answer", provider: "Groq" });
  assert.deepEqual(events, [
    "attempt:Gemini",
    "failed:Gemini",
    "attempt:Groq",
    "success:Groq"
  ]);
});

test("reports why unavailable and cooling-down providers are skipped", async () => {
  const skipped = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", available: false, call: async () => "wrong" },
    { id: "groq", name: "Groq", call: async () => "wrong" },
    { id: "openrouter", name: "OpenRouter", call: async () => "backup" }
  ], {
    isCoolingDown: id => id === "groq",
    onSkipped: (provider, reason) => skipped.push([provider.name, reason])
  });

  assert.equal(result.provider, "OpenRouter");
  assert.deepEqual(skipped, [
    ["Gemini", "API key not configured"],
    ["Groq", "provider is cooling down"]
  ]);
});

test("continues after empty responses and records the failure", async () => {
  const failures = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", call: async () => "   " },
    { id: "groq", name: "Groq", call: async () => "valid answer" }
  ], {
    onFailure: (provider, error) => failures.push([provider.name, error.message])
  });

  assert.equal(result.provider, "Groq");
  assert.deepEqual(failures, [["Gemini", "Gemini returned no text."]]);
});

test("reports all provider errors if every provider fails", async () => {
  await assert.rejects(
    runProviderFallback([
      { id: "gemini", name: "Gemini", call: async () => { throw new Error("503"); } },
      { id: "groq", name: "Groq", call: async () => { throw new Error("429"); } }
    ]),
    /Gemini: 503 \| Groq: 429/
  );
});
