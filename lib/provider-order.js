const DEFAULT_PROVIDER_ORDER = ["gemini", "groq", "openrouter"];

export function resolveProviderOrder(configuredOrder, availableProviders = DEFAULT_PROVIDER_ORDER) {
  const allowed = Array.isArray(availableProviders)
    ? [...new Set(availableProviders.map(value => String(value).trim().toLowerCase()).filter(Boolean))]
    : [...DEFAULT_PROVIDER_ORDER];
  const configured = typeof configuredOrder === "string" && configuredOrder.trim()
    ? configuredOrder.split(",").map(value => value.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_PROVIDER_ORDER;
  const ordered = [...new Set(configured)].filter(id => allowed.includes(id));
  for (const id of allowed) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}
