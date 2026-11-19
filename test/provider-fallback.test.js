import test from "node:test";
import assert from "node:assert/strict";
import { runProviderFallback } from "../lib/provider-fallback.js";

test("uses providers in configured order and stops after first success", async () => {
  const calls = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", available: true, call: async () => { calls.push("Gemini"); throw new Error("503 unavailable"); } },
    { id: "groq", name: "Groq", available: true, call: async () => { calls.push("Groq"); return "backup answer"; } },
    { id: "openrouter", name: "OpenRouter", available: true, call: async () => { calls.push("OpenRouter"); return "should not run"; } }
  ], { sleep: async () => {} });

  assert.deepEqual(calls, ["Gemini", "Gemini", "Groq"]);
  assert.deepEqual(result, { result: "backup answer", provider: "Groq" });
});

test("skips unavailable and cooling-down providers", async () => {
  const calls = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", available: false, call: async () => { calls.push("Gemini"); return "wrong"; } },
    { id: "groq", name: "Groq", available: true, call: async () => { calls.push("Groq"); return "wrong"; } },
    { id: "openrouter", name: "OpenRouter", available: true, call: async () => { calls.push("OpenRouter"); return "ready"; } }
  ], { isCoolingDown: (id) => id === "groq" });

  assert.deepEqual(calls, ["OpenRouter"]);
  assert.equal(result.provider, "OpenRouter");
  assert.equal(result.result, "ready");
});

test("reports provider failures when no provider can answer", async () => {
  const failures = [];
  await assert.rejects(
    runProviderFallback([
      { id: "gemini", name: "Gemini", available: true, call: async () => { throw new Error("quota exhausted"); } },
      { id: "groq", name: "Groq", available: true, call: async () => { throw new Error("timeout"); } }
    ], { onFailure: (provider, error) => failures.push(provider.name + ":" + error.message) }),
    /Gemini: quota exhausted \| Groq: timeout/
  );
  assert.deepEqual(failures, ["Gemini:quota exhausted", "Groq:timeout"]);
});

test("fails clearly when no provider is available", async () => {
  await assert.rejects(
    runProviderFallback([{ id: "gemini", name: "Gemini", available: false, call: async () => "never" }]),
    /No available AI provider/
  );
});


test("retries transient network failures once before switching provider", async () => {
  const calls = [];
  const waits = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", available: true, call: async () => { calls.push("Gemini"); if (calls.length === 1) throw new Error("fetch failed: ECONNRESET"); return "recovered"; } },
    { id: "groq", name: "Groq", available: true, call: async () => { calls.push("Groq"); return "backup"; } }
  ], { sleep: async ms => waits.push(ms) });
  assert.deepEqual(calls, ["Gemini", "Gemini"]);
  assert.deepEqual(waits, [500]);
  assert.equal(result.provider, "Gemini");
  assert.equal(result.result, "recovered");
});

test("does not retry authentication or ordinary quota errors", async () => {
  let calls = 0;
  await assert.rejects(
    runProviderFallback([
      { id: "gemini", name: "Gemini", available: true, call: async () => { calls += 1; throw new Error("HTTP 401 invalid API key"); } },
      { id: "groq", name: "Groq", available: true, call: async () => { calls += 1; throw new Error("HTTP 429 daily quota exhausted"); } }
    ], { sleep: async () => {} }),
    /Gemini: HTTP 401 invalid API key \\| Groq: HTTP 429 daily quota exhausted/
  );
  assert.equal(calls, 2);
});

test("retries provider TPM limits using provider guidance", async () => {
  const waits = [];
  let calls = 0;
  const result = await runProviderFallback([
    { id: "groq", name: "Groq", available: true, call: async () => { calls += 1; if (calls === 1) throw new Error("HTTP 429 tokens per minute. Try again in 2s"); return "recovered"; } }
  ], { sleep: async ms => waits.push(ms) });
  assert.deepEqual(waits, [2000]);
  assert.equal(result.provider, "Groq");
});
