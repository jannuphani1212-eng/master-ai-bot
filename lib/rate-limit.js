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

export function getProviderQuotaCooldownSeconds(message, { dailySeconds = 86400, defaultSeconds = 3600 } = {}) {
  const text = message instanceof Error ? message.message : String(message || "");
  if (/tokens per day|\bTPD\b|daily (?:token|request|quota)|free[_ -]?tier.{0,80}(?:requests|quota)|quota exceeded.*(?:daily|per day)|(?:daily|per day).*quota/i.test(text)) {
    return dailySeconds;
  }
  return defaultSeconds;
}
