import test from "node:test";
import assert from "node:assert/strict";
import { runProviderFallback } from "../lib/provider-fallback.js";

test("uses Groq, OpenRouter, Mistral in order and stops after first success", async () => {
  const calls = [];
  const result = await runProviderFallback([
    { id: "groq", name: "Groq", available: true, call: async () => { calls.push("Groq"); throw new Error("503 unavailable"); } },
    { id: "openrouter", name: "OpenRouter", available: true, call: async () => { calls.push("OpenRouter"); return "backup answer"; } },
    { id: "mistral", name: "Mistral", available: true, call: async () => { calls.push("Mistral"); return "should not run"; } }
  ]);

  assert.deepEqual(calls, ["Groq", "OpenRouter"]);
  assert.deepEqual(result, { result: "backup answer", provider: "OpenRouter" });
});

test("uses Mistral when Groq and OpenRouter fail", async () => {
  const calls = [];
  const result = await runProviderFallback([
    { id: "groq", name: "Groq", available: true, call: async () => { calls.push("Groq"); throw new Error("503 unavailable"); } },
    { id: "openrouter", name: "OpenRouter", available: true, call: async () => { calls.push("OpenRouter"); throw new Error("429 rate limit"); } },
    { id: "mistral", name: "Mistral", available: true, call: async () => { calls.push("Mistral"); return "third provider answer"; } }
  ]);

  assert.deepEqual(calls, ["Groq", "OpenRouter", "Mistral"]);
  assert.equal(result.provider, "Mistral");
  assert.equal(result.result, "third provider answer");
});

test("skips unavailable and cooling-down providers", async () => {
  const calls = [];
  const result = await runProviderFallback([
    { id: "groq", name: "Groq", available: false, call: async () => { calls.push("Groq"); return "wrong"; } },
    { id: "openrouter", name: "OpenRouter", available: true, call: async () => { calls.push("OpenRouter"); return "wrong"; } },
    { id: "mistral", name: "Mistral", available: true, call: async () => { calls.push("Mistral"); return "ready"; } }
  ], { isCoolingDown: (id) => id === "openrouter" });

  assert.deepEqual(calls, ["Mistral"]);
  assert.equal(result.provider, "Mistral");
  assert.equal(result.result, "ready");
});

test("reports provider failures when no provider can answer", async () => {
  const failures = [];
  await assert.rejects(
    runProviderFallback([
      { id: "groq", name: "Groq", available: true, call: async () => { throw new Error("quota exhausted"); } },
      { id: "openrouter", name: "OpenRouter", available: true, call: async () => { throw new Error("timeout"); } },
      { id: "mistral", name: "Mistral", available: true, call: async () => { throw new Error("unavailable"); } }
    ], { onFailure: (provider, error) => failures.push(provider.name + ":" + error.message) }),
    /Groq: quota exhausted \| OpenRouter: timeout \| Mistral: unavailable/
  );
  assert.deepEqual(failures, ["Groq:quota exhausted", "OpenRouter:timeout", "Mistral:unavailable"]);
});

test("fails clearly when no provider is available", async () => {
  await assert.rejects(
    runProviderFallback([{ id: "groq", name: "Groq", available: false, call: async () => "never" }]),
    /No available AI provider/
  );
});
