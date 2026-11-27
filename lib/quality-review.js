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
    pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?(?:\d+[.)]\s*)?(?:\*{1,2})?research(?:\s+and\s+|\s*&\s*)evidence\b/im
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


const APP_DEVELOPMENT_SECTION_RULES = [
  { id: "executive-summary", label: "Executive summary", pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?executive summary\b/im },
  { id: "user-problem", label: "User problem and audience", pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?(?:user problem and audience|problem and target users)\b/im },
  { id: "mvp-scope", label: "MVP scope and features", pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?mvp scope and features\b/im },
  { id: "source-files", label: "Source files", pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?source files\b/im },
  { id: "acceptance-criteria", label: "Acceptance criteria", pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?acceptance criteria\b/im },
  { id: "security-privacy", label: "Security and privacy", pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?security and privacy\b/im },
  { id: "static-validation", label: "Static validation and limitations", pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?static validation and limitations\b/im },
  { id: "next-steps", label: "Next steps", pattern: /^\s{0,3}(?:#{1,6}\s*)?(?:\*{1,2})?next steps\b/im }
];

const EXECUTION_LIMITATION_PATTERNS = [
  /\b(?:i|we)\s+(?:am|are|was|were)\s+(?:unable|not able)\s+to\s+(?:access|inspect|verify|check|run|perform|connect to)\b/i,
  /\b(?:i|we)\s+(?:do not|don't|did not|didn't)\s+have access to\b/i,
  /\b(?:could not|couldn't|cannot|can't)\s+(?:access|inspect|verify|check|run|perform|connect to)\b/i,
  /\bno access to\s+(?:the\s+)?(?:actual\s+)?(?:environment|account|channel|workspace|credentials|logs|live data|system)\b/i
];

function countWords(value) {
  return String(value || "").match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu)?.length || 0;
}

function getSectionBodies(report, rules = SECTION_RULES) {
  const lines = String(report || "").split(/\r?\n/);
  const headings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rule = rules.find(item => item.pattern.test(lines[index]));
    if (rule) headings.push({ index, rule });
  }

  return headings.map((heading, position) => {
    const next = headings[position + 1];
    const body = lines.slice(heading.index + 1, next ? next.index : lines.length).join("\n");
    return { id: heading.rule.id, label: heading.rule.label, wordCount: countWords(body) };
  });
}

export function reviewSpecialistReport(report, agentId = "") {
  const text = typeof report === "string" ? report.trim() : "";
  const rules = agentId === "app-development" ? APP_DEVELOPMENT_SECTION_RULES : SECTION_RULES;
  const normalized = text.toLowerCase();
  const passedSections = rules
    .filter(rule => rule.pattern.test(normalized))
    .map(rule => rule.label);
  const missingSections = rules
    .filter(rule => !rule.pattern.test(normalized))
    .map(rule => rule.label);
  const sectionBodies = getSectionBodies(text, rules);
  const thinSections = sectionBodies
    .filter(section => section.wordCount < 1)
    .map(section => section.label);

  const evidenceAware = /verified|unverified|assumption|estimate|needs? verification|source/i.test(normalized);
  // Factual-quality classification is separate from structural completeness.
  // Presence of a label does not prove the claim is true; it makes its status explicit.
  const evidenceClassification = {
    verifiedFacts: /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?verified facts?(?:\*\*)?\s*[:：-]/im.test(text) || /^\s{0,3}#{1,6}\s*verified facts?\b/im.test(text),
    assumptions: /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?assumptions?(?:\*\*)?\s*[:：-]/im.test(text) || /^\s{0,3}#{1,6}\s*assumptions?\b/im.test(text),
    estimates: /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?estimates?(?:\*\*)?\s*[:：-]/im.test(text) || /^\s{0,3}#{1,6}\s*estimates?\b/im.test(text),
    recommendations: /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?recommendations?(?:\*\*)?\s*[:：-]/im.test(text) || /^\s{0,3}#{1,6}\s*recommendations?\b/im.test(text)
  };
  const missingEvidenceLabels = Object.entries(evidenceClassification)
    .filter(([, present]) => !present)
    .map(([label]) => label);
  const actionable = /\b(step|action|implement|create|publish|measure|test|review|build|fix)\b/i.test(normalized);
  const executionLimitations = EXECUTION_LIMITATION_PATTERNS
    .filter(pattern => pattern.test(text))
    .map(() => "The report explicitly says the requested environment, account or live evidence could not be accessed or verified.");
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
  if (executionLimitations.length) warnings.push(...new Set(executionLimitations));
  if (missingSections.length) {
    warnings.push("Missing report sections: " + missingSections.join(", ") + ".");
  }
  if (thinSections.length) {
    warnings.push("Sections need more substantive detail (no substantive words): " + thinSections.join(", ") + ".");
  }
  if (!evidenceAware) {
    warnings.push("Evidence, assumptions or verification status are not clearly labelled.");
  }
  if (!actionable) {
    warnings.push("The report may lack concrete action steps.");
  }

  return {
    score,
    status: riskyClaims.length > 0 || executionLimitations.length > 0 || missingSections.length > 0 || thinSections.length > 0 || !evidenceAware || !actionable ? "needs_review" : "passed",
    passedSections,
    missingSections,
    thinSections,
    executionLimitations,
    evidenceAware,
    actionable,
    warnings,
    evidenceReview: unverifiedQuantitativeClaims || unverifiedMetadataClaims || missingEvidenceLabels.length ? "needs_verification" : "no_automatic_warning",
    evidenceClassification,
    missingEvidenceLabels,
    factualAccuracyScore: null,
    disclaimer: "Structural quality score only; factual accuracy is not scored and must be independently verified."
  };
}
