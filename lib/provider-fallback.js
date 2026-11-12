export async function runProviderFallback(
  providers,
  {
    isCoolingDown = () => false,
    onAttempt = () => {},
    onSkipped = () => {},
    onSuccess = () => {},
    onFailure = () => {}
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

    try {
      const result = await provider.call();
      if (typeof result !== "string" || !result.trim()) {
        throw new Error(provider.name + " returned no text.");
      }
      onSuccess(provider);
      return { result, provider: provider.name };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(provider.name + ": " + message);
      onFailure(provider, error);
    }
  }

  throw new Error(
    failures.join(" | ") || "No available AI provider. Check API configuration."
  );
}
