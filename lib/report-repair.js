export function mergeMissingReportSections(originalReport, generatedSections) {
  const original = String(originalReport || "").trim();
  const additions = String(generatedSections || "").trim();
  if (!additions) return original;
  if (!original) return additions;
  return original + "\n\n" + additions;
}
