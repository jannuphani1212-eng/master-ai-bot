export function getRetrySeconds(message, retryAfterHeader, now = Date.now()) {
  const header = String(retryAfterHeader || "").trim();

  if (header) {
    const numericSeconds = Number(header);
    if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
      return Math.min(3600, Math.max(1, Math.ceil(numericSeconds)));
    }

    const retryDate = Date.parse(header);
    if (Number.isFinite(retryDate)) {
      return Math.min(3600, Math.max(1, Math.ceil((retryDate - now) / 1000)));
    }
  }

  const text = String(message || "");
  const match = text.match(/(?:try again in|retry after)\s*([\d.]+)\s*(?:s|sec|seconds?)?/i);
  if (match) {
    return Math.min(3600, Math.max(10, Math.ceil(Number(match[1]))));
  }

  return 60;
}
