const MAX_PRIOR_TOPICS = 40;

function clean(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

export function ensureBlogOriginalityCaveat(report) {
  const text = String(report || "").trim();
  if (/not a plagiarism scan|not proof of uniqueness/i.test(text)) return text;
  const caveat = "System editorial safeguard: This AI-generated draft has not been independently checked for plagiarism or uniqueness. An AI originality self-check is not a plagiarism scan or proof of uniqueness.";
  return [text, "## Originality caveat", caveat].filter(Boolean).join("\n\n");
}

function stripMarkdown(value, max = 500) {
  return clean(String(value || "").replace(/^\s*[-•]\s*/, "").replace(/^\*{1,2}\s*/, "").replace(/\s*\*{1,2}\s*$/, "").replace(/^["“”']|["“”']$/g, ""), max);
}

function normalizedHeading(line) {
  return String(line || "")
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .replace(/[:：]\s*$/, "")
    .trim()
    .toLowerCase();
}

const POST_ARTICLE_HEADINGS = new Set([
  "fact-check ledger", "seo package", "internal links and image plan",
  "quality-control results", "cms handoff", "measurement and income report",
  "risks and next actions", "internal-link targets", "internal link targets",
  "meta tags", "image licensing", "structured data", "performance basics",
  "mobile readability", "accessibility", "measurement plan",
  "risks & policy checks", "risks and policy checks", "next three actions",
  "natural voice and reader-value review"
]);

function isArticleStart(line) {
  return /^ {0,3}(?:#{1,6}\s*)?(?:\*\*)?(?:\d+[.)]\s*)?(?:complete|full)\s+article(?:\s+draft)?(?:\*\*)?\s*[:：-]?\s*$/i.test(String(line || ""));
}

export function buildDailyBlogTask({ dayKey, priorTopics = [] } = {}) {
  const history = [...new Set(priorTopics.map(item => clean(item, 180)).filter(Boolean))]
    .slice(0, MAX_PRIOR_TOPICS);
  return [
    "AUTONOMOUS DAILY BLOG EDITORIAL WORK ORDER",
    "Date (India): " + clean(dayKey, 20),
    "You are responsible for selecting and producing today's best blog article without asking the owner for a topic.",
    "BUSINESS CONTEXT: Permanent autonomous Sports King 18 Blogging Department. India-focused, English-first, mobile-first sports publication covering cricket, football, tennis, badminton, hockey, basketball, athletics, motorsport, kabaddi, volleyball, golf, wrestling, boxing, swimming and other major sports. The owner gives no daily prompts and does no research or writing. Master Brain plans and assigns; Blogging Specialist researches, drafts, edits, quality-checks and prepares owner-review drafts. ₹0-first; use available free/reliable sources and never trigger paid APIs or subscriptions.",
    "DAILY EDITORIAL MISSION: Publish-ready work is prepared every India day without asking the owner for topics. Each day's lead article must combine a meaningful sports category with a detailed player biography/profile, rotating across sports, countries, eras, genders and levels of recognition so the series expands over time. Also identify the next sports-news/category article opportunity in the editorial backlog. Maintain a deduplicated biography backlog using the supplied saved-post history; never repeat a player already covered unless there is a genuinely new milestone angle. Do not claim to cover every player in the world; maintain a transparent, ongoing series.",
    "AUTOMATIC SUBTASKS: Complete and report: daily sports desk scan across major sports; select today's sport and player profile; update biography backlog; research with specific source URLs; reader/search-intent brief; complete article; fact-check and evidence audit; SEO; internal-link and image/alt-text plan; editorial review and revisions; owner-review CMS preparation; performance report. Never silently discard queued profiles.",
    "ARTICLE REQUIREMENTS: Write a complete original sports article, not an outline. For biographies cover verified background, development, teams, career milestones, playing style, achievements, records with dates/context, setbacks and legacy; distinguish confirmed facts from disputed or unavailable details. Aim for 900–1,300 useful words where supported; never pad. Use a compelling opening, clear H2/H3 headings, context for statistics and a natural conclusion. Include the sport/category in the angle.",
    "NATURAL HUMAN-EDITOR VOICE: Write like a skilled independent sports editor: vivid but restrained storytelling, varied sentence rhythm, specific context, clear explanations of tactics and significance, natural conversational flow. Avoid formulaic intros, generic filler, exaggerated claims, keyword stuffing, fake quotes, fabricated interviews, fake eyewitness accounts, fake first-person experiences and robotic summaries. Never impersonate a human or misrepresent authorship. Do not copy another journalist's phrasing. Add a Natural voice and reader-value review and rewrite awkward passages.",
    "QUALITY GATE: Target at least 95/100 (9.5/10). Revise and re-review any draft below 95. A numeric score is only an automated editorial signal, not proof of accuracy, originality or Google ranking. If reliable sources or required evidence are missing, mark NEEDS OWNER REVIEW / NOT READY rather than inventing facts. Never label unsupported claims verified.",
    "PUBLISHING SAFETY: Prepare owner-review-ready Blogger drafts only. Never publish, schedule, send, spend, change accounts or call a live publishing action without the owner's explicit approval for that exact article. A quality score is not publishing authorization. The owner only approves or rejects.",
    "RETURN FORMAT: Use these exact top-level headings: Executive summary; Audience and assumptions; Research and evidence; Topic decision and scorecard; Task execution checklist; Complete article draft; Fact-check ledger; SEO package; Internal links and image plan; Quality-control results; CMS handoff; Measurement and income report; Risks and next actions.",
    "The Complete article draft section must contain the actual full article. Include the next biography backlog item, the sports categories already covered, and the next planned sport/player. Do not claim any stage passed without its deliverable."
    "DUPLICATE AVOIDANCE: Do not repeat or lightly reword these recent topics. Choose a meaningfully different reader problem or angle: " + (history.length ? history.join(" | ") : "No saved topic history supplied; avoid generic filler."),
    "AUTOMATIC SUBTASKS: Complete and report: daily sports desk scan across major sports; select today's story; update player-biography backlog and select next profile; research with source URLs; reader/search-intent brief; complete article; fact-check and evidence audit; SEO; internal-link and image/alt-text plan; editorial review and revisions; owner-review CMS preparation; performance report. Never silently discard queued profiles." +
    "ARTICLE REQUIREMENTS: Write a complete original sports article. For biographies cover verified background, development, teams, career milestones, playing style, achievements, records with dates/context, setbacks and legacy; distinguish confirmed facts from disputed or unavailable details. Aim for 900–1,300 useful words where supported; never pad. Use clear H1/H2/H3 headings, engaging opening, context for statistics and natural conclusion." +
    "PRODUCT COMPARISON SAFETY: Never use placeholders such as Laptop A/B/C, Brand/Model, ₹XX,000, or invented product names. Every recommended product must have an exact model/SKU and a source URL for the model's official specifications. Current price and availability must each have a dated retailer source URL. If these sources are unavailable, do NOT fabricate a top-five list: change to a timeless buying guide or clearly label the comparison as incomplete and not publishable.",
    "RESEARCH HONESTY: Never say 'searched', 'scoured', 'checked', 'compared', or 'cross-checked' a retailer, review, or source unless the report includes the exact source URL and what was verified there. Do not invent search volume, reviews, benchmarks, market statistics, citations, quotations, links, dates, prices, specifications, regulations or statistics.",
    "FACT-CHECK: Provide a claim ledger with each material factual claim, source URL/title if actually consulted, and status VERIFIED_FROM_SOURCE / NEEDS_VERIFICATION / OPINION. A VERIFIED_FROM_SOURCE claim must include a working, specific source URL and a short note describing what that source supports. A generic source name or unsupported citation label is not evidence. If no live research source is available, mark claims NEEDS_VERIFICATION and keep the article non-publishable.",
    "SEO DELIVERABLES: Primary keyword and intent; related terms without fabricated volume; SEO title (≤60 characters where practical); meta description (≤160 characters where practical); slug; H1/H2/H3 structure; suggested schema only if suitable; 3–5 internal-link targets described by topic (do not invent URLs); image concepts, licensing cautions and descriptive alt text.",
    "ORIGINALITY AND READABILITY: Explain the article's unique reader value and what distinguishes it from a generic AI summary. Check repetition, clarity, mobile readability, grammar, accessibility, affiliate/ad disclosures where applicable, copyright and child-safety if relevant. Include the exact statement: 'An AI originality self-check is not a plagiarism scan or proof of uniqueness.' Do not claim a plagiarism scan was run unless a real checker result is supplied. A model self-check is not proof of uniqueness.",
    "NATURAL HUMAN-EDITOR VOICE: Write like a skilled independent sports editor: vivid but restrained storytelling, varied sentence rhythm, specific context, clear explanations of tactics and significance, natural conversational flow. Avoid formulaic intros, generic filler, exaggerated claims, keyword stuffing, fake quotes, fabricated interviews, fake eyewitness accounts, fake first-person experiences and robotic summaries. Never impersonate a human or misrepresent authorship. Do not copy another journalist's phrasing. Add a Natural voice and reader-value review and rewrite awkward passages." +
    "MONETIZATION: Recommend monetization only when it genuinely serves the reader. Mark affiliate disclosures clearly. Never insert fabricated products, prices, affiliate links, earnings, ad RPM, or conversion forecasts. Actual income must be reported only from connected, verified analytics; otherwise say NOT CONNECTED / NOT MEASURED.",
    "PUBLISHING SAFETY: Prepare owner-review-ready Blogger drafts only. Never publish, schedule, send, spend, change accounts or call a live publishing action without the owner's explicit approval for that exact article. A quality score is not publishing authorization. Keep all output in the approval queue; owner only approves or rejects." +
    "RETURN FORMAT: Use these exact top-level headings: Executive summary; Audience and assumptions; Research and evidence; Topic decision and scorecard; Task execution checklist; Complete article draft; Fact-check ledger; SEO package; Internal links and image plan; Quality-control results; CMS handoff; Measurement and income report; Risks and next actions.",
    "The Complete article draft section must contain the actual full article. Include next biography backlog item and status. Target at least 95/100 on the review rubric; revise and re-review below target, and mark not ready when evidence or checks fail. Do not claim any stage passed without its deliverable."
  ].join("\n\n");
}

export function extractBlogArticle(report, dayKey = "") {
  const text = String(report || "");
  const lines = text.split(/\r?\n/);
  const titleLine = text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:Article title|Working title|SEO title|Title)(?:\*\*)?\s*[:：-]\s*(.+)$/im);
  const titledPhrase = text.match(/\btitled\s+(?:\*\*)?[“"']([^”"']+)[”"'](?:\*\*)?/i);
  const metaTitle = text.match(/^\s*(?:[-*]\s*)?\*\*Title\*\*\s*[:：|]\s*(.+)$/im);
  const keyword = text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:Primary keyword|Primary target keyword|Target keyword)(?:\*\*)?\s*[:：-]\s*(.+)$/im);
  const meta = text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:Meta description|SEO description)(?:\*\*)?\s*[:：-]\s*(.+)$/im);
  const startIndex = lines.findIndex(isArticleStart);
  let article = "";
  if (startIndex >= 0) {
    let endIndex = lines.length;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (POST_ARTICLE_HEADINGS.has(normalizedHeading(lines[index]))) {
        endIndex = index;
        break;
      }
    }
    article = lines.slice(startIndex + 1, endIndex).join("\n").trim();
  }
  const wordCount = article.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu)?.length || 0;
  const extractedTitle = stripMarkdown(titleLine?.[1] || titledPhrase?.[1] || metaTitle?.[1] || "", 180);
  const extractedMeta = stripMarkdown(meta?.[1] || "", 320);
  return {
    title: extractedTitle || "Daily blog draft " + clean(dayKey, 20),
    primaryKeyword: stripMarkdown(keyword?.[1] || "", 240),
    metaDescription: extractedMeta,
    article,
    wordCount,
    dayKey: clean(dayKey, 20),
    extractionStatus: article.length >= 1800 && wordCount >= 350 ? "complete" : "incomplete",
    report: text
  };
}

export function reviewBlogArticle(draft) {
  const article = String(draft?.article || "");
  const report = String(draft?.report || "");
  const combined = draft?.title + "\n" + article + "\n" + report;
  const yearMatch = String(draft?.title || "").match(/\b(20\d{2})\b/);
  const currentYear = Number(String(draft?.dayKey || "").slice(0, 4)) || new Date().getUTCFullYear();
  const hasSourceUrl = /https?:\/\/[^\s)\]]+/i.test(report);
  const claimsMarkedVerified = /VERIFIED_FROM_SOURCE|verified facts?/i.test(report);
  const claimsHaveUrls = !claimsMarkedVerified || hasSourceUrl;
  const claimsRetailResearch = /(?:searched|scoured|checked|cross-checked|compared)\s+(?:Amazon|Flipkart|retailer|retailers|reviews|expert tech blogs)/i.test(report);
  const retailerResearchHasEvidence = !claimsRetailResearch || /https?:\/\/[^\s)\]]*(?:amazon\.in|flipkart\.com)/i.test(report);
  const placeholderData = /\bLaptop\s+[A-E]\b|Brand\/Model|\[Brand\/?Model\]|₹\s*XX|\bModel\s+[A-E]\b/i.test(combined);
  const staleYear = Boolean(yearMatch && Number(yearMatch[1]) < currentYear && !/historical|archival|archive/i.test(draft?.title || ""));
  const numericProductClaims = /₹\s*[\d,]+|\b\d+(?:\.\d+)?\s*(?:GB|TB|Hz)\b|(?:price|cost|free version|free tier|subscription|commission|warranty|battery life|RAM|storage|processor|display|specifications?).{0,60}\b(?:\d+(?:\.\d+)?|free|paid|available|included)\b/i.test(article);
  const productClaimsHaveEvidence = !numericProductClaims || hasSourceUrl;
  const checks = {
    completeArticle: article.trim().length >= 1800,
    usefulLength: Number(draft?.wordCount || 0) >= 350,
    seoTitle: Boolean(draft?.title && draft.title.length <= 60),
    metaDescription: Boolean(draft?.metaDescription && draft.metaDescription.length <= 160),
    primaryKeyword: Boolean(draft?.primaryKeyword),
    evidenceLedger: /fact-check ledger/i.test(report) && /needs.verification|verified.from.source|opinion/i.test(report),
    verifiedClaimsHaveSourceUrls: claimsHaveUrls,
    retailerResearchHasSourceUrls: retailerResearchHasEvidence,
    noPlaceholderProductData: !placeholderData,
    currentTopicOrHistoricalLabel: !staleYear,
    numericProductClaimsHaveEvidence: productClaimsHaveEvidence,
    seoPackage: /SEO package/i.test(report),
    originalityCaveat: /plagiarism scan was run|plagiarism checker|not proof of uniqueness|originality/i.test(report),
    naturalVoiceReview: /natural voice and reader[\s‑–-]+value review/i.test(report),
    cmsHandoff: /CMS handoff/i.test(report),
    incomeHonesty: /NOT CONNECTED|NOT MEASURED|not connected|not measured/i.test(report)
  };
  const blockers = [
    ...(!claimsHaveUrls ? ["A claim is marked VERIFIED_FROM_SOURCE but no source URL is present."] : []),
    ...(!retailerResearchHasEvidence ? ["Retailer research is claimed without an Amazon India or Flipkart source URL."] : []),
    ...(placeholderData ? ["Placeholder product names or prices are present."] : []),
    ...(staleYear ? ["The article title uses an outdated year for a current article."] : []),
    ...(!productClaimsHaveEvidence ? ["Specific product prices/specifications appear without a source URL."] : [])
  ];
  const passed = Object.values(checks).filter(Boolean).length;
  const score = Math.round(passed / Object.keys(checks).length * 100);
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    status: failures.length === 0 && blockers.length === 0 ? "passed" : "needs_review",
    score: blockers.length ? Math.min(score, 69) : score,
    checks,
    failures,
    blockers,
    wordCount: Number(draft?.wordCount || 0),
    disclaimer: "Automated editorial checks are safeguards, not proof of factual accuracy, legal compliance, source validity, or plagiarism-free content. Human review remains required."
  };
}
