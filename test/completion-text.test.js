import test from "node:test";
import assert from "node:assert/strict";
import { extractCompletionText } from "../lib/completion-text.js";

test("extracts ordinary string content", () => {
  assert.equal(extractCompletionText({
    choices: [{ message: { content: "  hello  " }, finish_reason: "stop" }]
  }, "Groq"), "hello");
});

test("extracts text from multipart content", () => {
  assert.equal(extractCompletionText({
    choices: [{ message: { content: [{ type: "text", text: "first" }, { text: "second" }] } }]
  }, "OpenRouter"), "first\nsecond");
});

test("reports useful diagnostics when a provider returns empty content", () => {
  assert.throws(
    () => extractCompletionText({
      choices: [{
        finish_reason: "length",
        message: { content: null, reasoning: "internal reasoning" }
      }],
      usage: { completion_tokens: 700 }
    }, "Groq"),
    /Groq returned no usable text \(finish_reason=length.*reasoning_chars=19.*completion_tokens=700/
  );
});

test("does not mistake reasoning for a user-facing answer", () => {
  assert.throws(
    () => extractCompletionText({
      choices: [{ message: { content: "", reasoning: "thinking only" } }]
    }, "OpenRouter"),
    /returned no usable text/
  );
});
