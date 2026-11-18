import { isRetryableTpmRateLimit, getTpmRetryDelayMs } from "./rate-limit.js";

export async function runProviderFallback(
  providers,
  {
    isCoolingDown = () => false,
    onAttempt = () => {},
    onSkipped = () => {},
    onSuccess = () => {},
    onFailure = () => {},
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    maxTpmRetries = 2
  } = {}
) {
  const failures = [];

  for (const provider of providers) {
    if (provider.available === false) {
      onSkipped(provider, "API key not configured");
      continue;
    }

    if (isCoolingDown(provider.id)) {
      onSkipped(provider, "provider is cooling down");
      continue;
    }

    onAttempt(provider);
    let finalError = null;

    for (let attempt = 0; attempt <= maxTpmRetries; attempt += 1) {
      try {
        const result = await provider.call();
        if (typeof result !== "string" || !result.trim()) {
          throw new Error(provider.name + " returned no text.");
        }
        onSuccess(provider);
        return { result, provider: provider.name };
      } catch (error) {
        finalError = error;
        if (attempt < maxTpmRetries && isRetryableTpmRateLimit(error)) {
          // Respect provider guidance, then apply capped exponential backoff
          // on subsequent attempts to avoid repeatedly colliding with the TPM window.
          const providerDelayMs = getTpmRetryDelayMs(error);
          const waitMs = Math.min(15000, providerDelayMs * (2 ** attempt));
          onSkipped(provider, "TPM rate limit; retry " + (attempt + 1) + " after " + waitMs + "ms");
          await sleep(waitMs);
          continue;
        }
        break;
      }
    }

    const message = finalError instanceof Error ? finalError.message : String(finalError);
    failures.push(provider.name + ": " + message);
    onFailure(provider, finalError || new Error(message));
  }

  throw new Error(
    failures.join(" | ") || "No available AI provider. Check API configuration."
  );
}
