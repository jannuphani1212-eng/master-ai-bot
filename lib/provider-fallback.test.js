import test from "node:test";
import assert from "node:assert/strict";
import { runProviderFallback } from "./provider-fallback.js";

test("waits for TPM reset windows before retrying and then fails over", async () => {
  const waits = [];
  let groqCalls = 0;
  const result = await runProviderFallback([
    { id: "groq", name: "Groq", call: async () => {
      groqCalls += 1;
      throw new Error("HTTP 429: TPM limit. Please try again in 24.8s.");
    } },
    { id: "openrouter", name: "OpenRouter", call: async () => "fallback output" }
  ], { sleep: async ms => waits.push(ms) });
  assert.equal(result.provider, "OpenRouter");
  assert.equal(groqCalls, 3);
  assert.deepEqual(waits, [24800, 49600]);
});
