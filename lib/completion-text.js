export function extractCompletionText(data, providerName) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;
  const finishReason = choice?.finish_reason || "not provided";

  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map(part => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  // Never accept a response the provider explicitly says was cut off.
  // Passing truncated text to the next stage can create broken JSON, incomplete
  // specialist reports, or a misleading "successful" synthesis. Throwing here
  // lets the provider fallback layer try the next configured provider.
  if (String(finishReason).toLowerCase() === "length") {
    throw new Error(
      providerName + " response was truncated by its output-token limit " +
      "(finish_reason=length, partial_chars=" + text.length + ")."
    );
  }

  if (text.trim()) return text.trim();

  const messageKeys = message && typeof message === "object"
    ? Object.keys(message).join(", ") || "none"
    : "message missing";
  const reasoningLength = typeof message?.reasoning === "string"
    ? message.reasoning.length
    : typeof message?.reasoning_content === "string"
      ? message.reasoning_content.length
      : 0;
  const refusal = typeof message?.refusal === "string"
    ? message.refusal.slice(0, 180)
    : "";
  const completionTokens = data?.usage?.completion_tokens ?? "unknown";

  throw new Error(
    providerName + " returned no usable text (finish_reason=" +
    finishReason + ", message_fields=" + messageKeys +
    ", reasoning_chars=" + reasoningLength +
    ", completion_tokens=" + completionTokens +
    (refusal ? ", refusal=" + refusal : "") + ")."
  );
}
