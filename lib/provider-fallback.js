import { isRetryableTpmRateLimit, getTpmRetryDelayMs } from "./rate-limit.js";

function isRetryableTransientFailure(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/(?:HTTP\s*)?429/i.test(message)) return false;
  // A truncated completion cannot become complete by repeating the same request.
  // Fail over immediately; retry only transient transport/service failures.
  return /(?:HTTP\s*)?(?:408|425|500|502|503|504)\b/i.test(message) ||
    /returned no text|no usable text|empty content/i.test(message) ||
    /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|fetch failed|network error|timed? ?out|aborterror|operation was aborted|signal is aborted/i.test(message);
}

export async function runProviderFallback(
  providers,
  {
    isCoolingDown = () => false,
    onAttempt = () => {},
    onSkipped = () => {},
    onSuccess = () => {},
    onFailure = () => {},
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    maxTpmRetries = 2,
    maxTransientRetries = 1,
    transientBaseDelayMs = 1000,
    maxTransientDelayMs = 8000
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
    let tpmRetries = 0;
    let transientRetries = 0;

    while (true) {
      try {
        const result = await provider.call();
        if (typeof result !== "string" || !result.trim()) {
          throw new Error(provider.name + " returned no text.");
        }
        onSuccess(provider);
        return { result, provider: provider.name };
      } catch (error) {
        finalError = error;

        if (isRetryableTpmRateLimit(error) && tpmRetries < maxTpmRetries) {
          const providerDelayMs = getTpmRetryDelayMs(error);
          const waitMs = Math.min(60000, providerDelayMs * (2 ** tpmRetries));
          tpmRetries += 1;
          onSkipped(provider, "TPM rate limit; retry " + tpmRetries + " after " + waitMs + "ms");
          await sleep(waitMs);
          continue;
        }

        if (isRetryableTransientFailure(error) && transientRetries < maxTransientRetries) {
          const waitMs = Math.min(maxTransientDelayMs, transientBaseDelayMs * (2 ** transientRetries));
          transientRetries += 1;
          onSkipped(provider, "temporary provider/network failure; retry " + transientRetries + " after " + waitMs + "ms");
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
