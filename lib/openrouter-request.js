export function getOpenRouterMaxTokens(requestedTokens = 900) {
  const parsed = Number(requestedTokens);
  const safeRequested = Number.isFinite(parsed) && parsed > 0
    ? Math.ceil(parsed)
    : 900;
  return Math.max(4096, Math.min(8192, safeRequested));
}
