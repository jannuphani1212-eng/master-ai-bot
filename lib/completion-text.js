export function extractCompletionText(data, providerName) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;

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

  if (text.trim()) return text.trim();

  const finishReason = choice?.finish_reason || "not provided";
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
