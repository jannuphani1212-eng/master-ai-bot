const SECTION_RULES = [
  { id: "executive-summary", label: "Executive summary", pattern: /executive summary|summary|recommendation at a glance/i },
  { id: "audience-assumptions", label: "Audience and assumptions", pattern: /audience|assumptions|target user|target customer/i },
  { id: "research-evidence", label: "Research and evidence", pattern: /research|evidence|verification|verified facts|data sources/i },
  { id: "strategy", label: "Recommended strategy", pattern: /recommended strategy|strategy|approach|prioriti[sz]ed plan/i },
  { id: "deliverables", label: "Concrete deliverables", pattern: /deliverables|content brief|implementation|sample|template|draft|code structure/i },
  { id: "measurement", label: "Measurement and KPIs", pattern: /measurement|kpi|metrics|success measure|tracking plan/i },
  { id: "risks-quality", label: "Risks and quality checks", pattern: /risks|quality control|quality checks|policy checks|limitations/i },
  { id: "next-actions", label: "Next three actions", pattern: /next steps|next actions|first three actions|action items/i }
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
