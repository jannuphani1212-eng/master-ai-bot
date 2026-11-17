const SECTION_RULES = [
  {
    id: "executive-summary",
    label: "Executive summary",
    pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?(?:\d+[.)]\s*)?(?:\*{1,2})?executive summary\b/im
  },
  {
    id: "audience-assumptions",
    label: "Audience and assumptions",
    pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?(?:\d+[.)]\s*)?(?:\*{1,2})?audience(?:,\s*goal)?(?:\s+and\s+assumptions)?\b/im
  },
  {
    id: "research-evidence",
    label: "Research and evidence",
    pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?(?:\d+[.)]\s*)?(?:\*{1,2})?research and evidence\b/im
  },
  {
    id: "strategy",
    label: "Recommended strategy",
    pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?(?:\d+[.)]\s*)?(?:\*{1,2})?recommended strategy\b/im
  },
  {
    id: "deliverables",
    label: "Concrete deliverables",
    pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?(?:\d+[.)]\s*)?(?:\*{1,2})?concrete deliverables\b/im
  },
  {
    id: "measurement",
    label: "Measurement and KPIs",
    pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?(?:\d+[.)]\s*)?(?:\*{1,2})?measurement(?: and KPIs| plan)?\b/im
  },
  {
    id: "risks-quality",
    label: "Risks and quality checks",
    pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?(?:\d+[.)]\s*)?(?:\*{1,2})?risks(?:, policy checks(?: and quality-control steps)?| and quality checks)?\b/im
  },
  {
    id: "next-actions",
    label: "Next three actions",
    pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?(?:\d+[.)]\s*)?(?:\*{1,2})?next three actions\b/im
  }
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

  const baseScore = Math.max(0, Math.min(100,
    passedSections.length * 10 +
    (evidenceAware ? 10 : 0) +
    (actionable ? 10 : 0)
  ));

  // Provider identity and scores must come from server execution metadata,
  // never from claims generated inside a model-authored report.
  const unverifiedMetadataClaims =
    /\b(?:actual\s+provider|ai\s+provider|provider\s+used|model\s+used)\s*[:|]/i.test(text) ||
    /\b(?:OpenAI\s+GPT[- ]?\d|ChatGPT[- ]?\d|Anthropic\s+Claude|Google\s+Gemini|Microsoft\s+Azure\s+OpenAI)\b/i.test(text) ||
    /\b(?:structural\s+quality\s+score|quality\s+score)\s*[:=]/i.test(text);

  // Numeric business/performance claims are not evidence by themselves.
  // Keep them visible, but require human verification before treating them
  // as factual results or committed targets.
  const unverifiedQuantitativeClaims = /(?:[$₹€£]\s?\d[\d,.]*|\b\d+(?:\.\d+)?\s?(?:%|k|m|million|thousand|subscribers?|views?|visitors?|clicks?|sales?|leads?|per\s+month|\/month|\/week|\/day|CPM|CTR|conversion rate)\b)/i.test(text);

  const score = unverifiedMetadataClaims
    ? Math.min(baseScore, 60)
    : unverifiedQuantitativeClaims
      ? Math.min(baseScore, 70)
      : baseScore;
  const warnings = [...riskyClaims];
  if (unverifiedMetadataClaims) {
    warnings.push("Contains model-authored provider or quality-score claims; trust only the server execution metadata.");
  }
  if (unverifiedQuantitativeClaims) {
    warnings.push("Contains numerical budget, revenue, audience or performance claims; treat them as proposals until independently verified.");
  }
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
    status: riskyClaims.length > 0 || unverifiedMetadataClaims || unverifiedQuantitativeClaims || missingSections.length > 0 || !evidenceAware || !actionable || score < 70 ? "needs_review" : "passed",
    passedSections,
    missingSections,
    evidenceAware,
    actionable,
    warnings,
    disclaimer: "Structural quality score only; it does not independently verify factual accuracy."
  };
}
