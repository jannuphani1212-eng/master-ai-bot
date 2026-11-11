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

test("provider fallback reports failure when every configured provider fails", async () => {
  await assert.rejects(
    runProviderFallback([
      { id: "gemini", name: "Gemini", call: async () => { throw new Error("quota"); } },
      { id: "groq", name: "Groq", call: async () => { throw new Error("busy"); } }
    ]),
    /Gemini: quota \| Groq: busy/
  );
});

test("provider fallback rejects empty provider responses and continues", async () => {
  const result = await runProviderFallback([
    { id: "gemini", name: "Gemini", call: async () => "   " },
    { id: "groq", name: "Groq", call: async () => "usable" }
  ]);
  assert.equal(result.provider, "Groq");
});
