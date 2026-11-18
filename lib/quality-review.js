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


function countWords(value) {
  return String(value || "").match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu)?.length || 0;
}

function getSectionBodies(report) {
  const lines = String(report || "").split(/\r?\n/);
  const headings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rule = SECTION_RULES.find(item => item.pattern.test(lines[index]));
    if (rule) headings.push({ index, rule });
  }

  return headings.map((heading, position) => {
    const next = headings[position + 1];
    const body = lines.slice(heading.index + 1, next ? next.index : lines.length).join("\n");
    return { id: heading.rule.id, label: heading.rule.label, wordCount: countWords(body) };
  });
}

export function reviewSpecialistReport(report) {
  const text = typeof report === "string" ? report.trim() : "";
  const normalized = text.toLowerCase();
  const passedSections = SECTION_RULES
    .filter(rule => rule.pattern.test(normalized))
    .map(rule => rule.label);
  const missingSections = SECTION_RULES
    .filter(rule => !rule.pattern.test(normalized))
    .map(rule => rule.label);
  const sectionBodies = getSectionBodies(text);
  const thinSections = sectionBodies
    .filter(section => section.wordCount < 12)
    .map(section => section.label);

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

  // Headings alone are not evidence of a useful report. Penalize empty or
  // token sections so a report cannot earn a perfect score with headings only.
  const baseScore = Math.max(0, Math.min(100,
    passedSections.length * 10 +
    (evidenceAware ? 10 : 0) +
    (actionable ? 10 : 0) -
    thinSections.length * 5
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
  const unverifiedQuantitativeClaims = /(?:[$₹€£]\s?\d[\d,.]*|\b\d+(?:\.\d+)?\s?(?:%|k|m|million|thousand|subscribers?|views?|visits?|visitors?|clicks?|sales?|leads?|per\s+(?:day|week|month|year)|\/month|\/week|\/day|CPM|CTR|conversion rate)\b)/i.test(text);

  // This score measures structure only. Unsupported numerical claims are a
  // separate evidence-review warning and must not reduce structural completeness.
  const score = baseScore;
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
  if (thinSections.length) {
    warnings.push("Sections need more substantive detail (fewer than 12 words): " + thinSections.join(", ") + ".");
  }
  if (!evidenceAware) {
    warnings.push("Evidence, assumptions or verification status are not clearly labelled.");
  }
  if (!actionable) {
    warnings.push("The report may lack concrete action steps.");
  }

  return {
    score,
    status: riskyClaims.length > 0 || missingSections.length > 0 || thinSections.length > 0 || !evidenceAware || !actionable ? "needs_review" : "passed",
    passedSections,
    missingSections,
    thinSections,
    evidenceAware,
    actionable,
    warnings,
    evidenceReview: unverifiedQuantitativeClaims || unverifiedMetadataClaims ? "needs_verification" : "no_automatic_warning",
    factualAccuracyScore: null,
    disclaimer: "Structural quality score only; factual accuracy is not scored and must be independently verified."
  };
}
