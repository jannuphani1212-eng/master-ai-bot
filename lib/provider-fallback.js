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
    maxTpmRetries = 1
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
          const waitMs = getTpmRetryDelayMs(error);
          onSkipped(provider, "Groq TPM rate limit; retrying once after " + waitMs + "ms");
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
