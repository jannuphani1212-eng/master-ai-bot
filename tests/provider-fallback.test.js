import test from "node:test";
import assert from "node:assert/strict";
import { runProviderFallback } from "../lib/provider-fallback.js";

test("provider fallback uses the next available provider after a failure", async () => {
  const attempts = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", call: async () => { attempts.push("Gemini"); throw new Error("quota"); } },
    { id: "groq", name: "Groq", call: async () => { attempts.push("Groq"); return "backup answer"; } },
    { id: "openrouter", name: "OpenRouter", call: async () => { attempts.push("OpenRouter"); return "unused"; } }
  ]);
  assert.deepEqual(attempts, ["Gemini", "Groq"]);
  assert.deepEqual(result, { result: "backup answer", provider: "Groq" });
});

test("provider fallback skips providers in cooldown or without configuration", async () => {
  const attempts = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", call: async () => { attempts.push("Gemini"); return "unused"; } },
    { id: "groq", name: "Groq", available: false, call: async () => { attempts.push("Groq"); return "unused"; } },
    { id: "openrouter", name: "OpenRouter", call: async () => { attempts.push("OpenRouter"); return "router answer"; } }
  ], { isCoolingDown: (id) => id === "gemini" });
  assert.deepEqual(attempts, ["OpenRouter"]);
  assert.equal(result.provider, "OpenRouter");
});

test("provider fallback reaches OpenRouter after Gemini and Groq fail", async () => {
  const attempts = [];
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", call: async () => { attempts.push("Gemini"); throw new Error("quota"); } },
    { id: "groq", name: "Groq", call: async () => { attempts.push("Groq"); throw new Error("busy"); } },
    { id: "openrouter", name: "OpenRouter", call: async () => { attempts.push("OpenRouter"); return "router answer"; } }
  ]);

  assert.deepEqual(attempts, ["Gemini", "Groq", "OpenRouter"]);
  assert.deepEqual(result, { result: "router answer", provider: "OpenRouter" });
});

test("provider fallback reports every failure when all three providers fail", async () => {
  await assert.rejects(
    runProviderFallback([
      { id: "gemini", name: "Gemini", call: async () => { throw new Error("quota"); } },
      { id: "groq", name: "Groq", call: async () => { throw new Error("busy"); } },
      { id: "openrouter", name: "OpenRouter", call: async () => { throw new Error("unavailable"); } }
    ]),
    /Gemini: quota \| Groq: busy \| OpenRouter: unavailable/
  );
});

test("provider fallback rejects empty provider responses and continues", async () => {
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", call: async () => "   " },
    { id: "groq", name: "Groq", call: async () => "usable" }
  ]);
  assert.equal(result.provider, "Groq");
});
