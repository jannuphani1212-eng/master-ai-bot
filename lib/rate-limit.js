export function isRetryableTpmRateLimit(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /(?:HTTP\s*)?429/i.test(message) && /tokens per minute|\bTPM\b/i.test(message);
}

export function getTpmRetryDelayMs(error, { minMs = 1000, maxMs = 60000 } = {}) {
  const message = error instanceof Error ? error.message : String(error || "");
  const match = message.match(/try again in\s*([\d.]+)\s*(?:s|sec|seconds?)?/i);
  const seconds = match ? Number(match[1]) : 3;
  const safeSeconds = Number.isFinite(seconds) ? seconds : 3;
  return Math.min(maxMs, Math.max(minMs, Math.ceil(safeSeconds * 1000)));
}
