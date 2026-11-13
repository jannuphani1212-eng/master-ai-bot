const SECTION_RULES = [
  { id: "executive-summary", label: "Executive summary", pattern: /^\\s{0,3}#{1,6}\\s+executive summary\\b/im },
  { id: "audience-assumptions", label: "Audience and assumptions", pattern: /^\\s{0,3}#{1,6}\\s+audience(?: and assumptions)?\\b/im },
  { id: "research-evidence", label: "Research and evidence", pattern: /^\\s{0,3}#{1,6}\\s+research and evidence\\b/im },
  { id: "strategy", label: "Recommended strategy", pattern: /^\\s{0,3}#{1,6}\\s+recommended strategy\\b/im },
  { id: "deliverables", label: "Concrete deliverables", pattern: /^\\s{0,3}#{1,6}\\s+concrete deliverables\\b/im },
  { id: "measurement", label: "Measurement and KPIs", pattern: /^\\s{0,3}#{1,6}\\s+measurement and KPIs\\b/im },
  { id: "risks-quality", label: "Risks and quality checks", pattern: /^\\s{0,3}#{1,6}\\s+risks and quality checks\\b/im },
  { id: "next-actions", label: "Next three actions", pattern: /^\\s{0,3}#{1,6}\\s+next three actions\\b/im }
];

export function reviewSpecialistReport(report) {
  const text = typeof report === "string" ? report.trim() : "";
  const normalized = text.toLowerCase();
  const passedSections = SECTION_RULES
    .filter(rule => rule.pattern.test(normalized))
    .map(rule => rule.label);
  const missingSections = SECTION_RULES
    .filter(rule => !rule.pattern.test(normalized))
    .map(rule => rule.label);

  const evidenceAware = /verified|unverified|assumption|estimate|needs? verification|source/i.test(normalized);
  const actionable = /\b(step|action|implement|create|publish|measure|test|review|build|fix)\b/i.test(normalized);
  const riskyClaims = [];
  if (/guaranteed (?:income|revenue|rankings?|views?|sales?)/i.test(text)) {
    riskyClaims.push("Contains a guarantee about an outcome.");
  }
  if (/100% (?:guaranteed|certain)|risk[- ]free income|sure[- ]shot/i.test(text)) {
    riskyClaims.push("Contains an absolute or unrealistic certainty claim.");
  }
  if (!text) riskyClaims.push("The specialist returned an empty report.");

  const score = Math.max(0, Math.min(100,
    passedSections.length * 10 +
    (evidenceAware ? 10 : 0) +
    (actionable ? 10 : 0)
  ));

  const warnings = [...riskyClaims];
  if (missingSections.length) {
    warnings.push("Missing report sections: " + missingSections.join(", ") + ".");
  }
  if (!evidenceAware) {
    warnings.push("Evidence, assumptions or verification status are not clearly labelled.");
  }
  if (!actionable) {
    warnings.push("The report may lack concrete action steps.");
  }

  return {
    score,
    status: riskyClaims.length > 0 || score < 70 ? "needs_review" : "passed",
    passedSections,
    missingSections,
    evidenceAware,
    actionable,
    warnings,
    disclaimer: "Structural quality score only; it does not independently verify factual accuracy."
  };
}
