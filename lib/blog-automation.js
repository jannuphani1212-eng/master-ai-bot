const MAX_PRIOR_TOPICS = 200;

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
  const history = [...new Set(priorTopics.map(item => clean(item, 180)).filter(Boolean))].slice(0, MAX_PRIOR_TOPICS);
  return [
    "AUTONOMOUS DAILY BLOG EDITORIAL WORK ORDER",
    "Date (India): " + clean(dayKey, 20),
    "Select and produce today's Sports King 18 article without asking the owner for a topic.",
    "BUSINESS CONTEXT: Permanent autonomous Sports King 18 Blogging Department. India-focused, English-first, mobile-first sports publication covering cricket, football, tennis, badminton, hockey, basketball, athletics, motorsport, kabaddi, volleyball, golf, wrestling, boxing, swimming and other major sports. Owner gives no daily prompts and does no research or writing. Master Brain plans and assigns; Blogging Specialist researches, drafts, edits, quality-checks and prepares owner-review drafts. ₹0-first; use free/reliable sources and never trigger paid APIs or subscriptions.",
    "DAILY EDITORIAL MISSION: Every India day, prepare one complete, timely sports article with TWO substantial reader-facing parts: (1) a dated multi-sport roundup of the notable verified developments available across cricket, football, tennis, badminton, hockey, basketball, athletics, motorsport, kabaddi, volleyball, golf, wrestling, boxing, swimming and other major competitions; and (2) a detailed featured player biography/profile. Rotate across cricket, football, tennis, badminton, hockey, basketball, athletics, motorsport, kabaddi, volleyball, golf, wrestling, boxing, swimming and other major sports, across countries, eras, genders and levels of recognition. Maintain a deduplicated, ongoing biography catalogue from saved-post history and never silently skip a planned profile. The long-term goal is broad coverage of professional and notable players; do not falsely claim every player worldwide is already covered. Publish one useful profile per daily article and transparently identify the next player in the backlog.",
    "DUPLICATE AVOIDANCE: Do not repeat or lightly reword these saved blog topics: " + (history.length ? history.join(" | ") : "No saved topic history supplied; avoid generic filler."),
    "AUTOMATIC SUBTASKS: Scan the sports desk across all major sports; select the strongest verified updates from each sport where meaningful news exists; select a featured player and research both the roundup and biography from reliable primary/official sources where possible; update the biography backlog; record source URLs beside supported facts; write both parts as one complete article; fact-check dates, scores, teams, statistics and career data; add SEO, internal-link and image/alt-text plans; revise after editorial review; save a private Blogger draft when the quality gate passes; report delivery and backlog progress. Never silently discard queued profiles.",
    "ARTICLE REQUIREMENTS: Write a complete original sports article, not an outline. Use explicit H2 headings 'Sports Update' and 'Featured Player Biography'. The sports update must state its India date, cover the notable verified developments across major sports where available, and explain why they matter; group updates by sport. If no current event can be verified for a sport, say no verified update was found rather than inventing news. If live research is unavailable, mark the article NOT READY. For the biography cover full name, verified birth details when public, nationality/sport/role, early development, teams, career timeline, milestones, playing style, achievements, records with dates/context, setbacks and legacy. Include a compact bio-data table or clearly labelled fact sheet only when each field is supported; mark private or unavailable fields as not publicly verified rather than guessing. Aim for 900–1,300 useful words where supported; never pad. Use a compelling opening, clear H2/H3 headings, context for statistics and a natural conclusion.",
    "FRESHNESS: Use the current India date. Historical topics must be framed as historical. Verify current results, teams, rankings and records from dated sources.",
    "RESEARCH HONESTY: Never claim to have checked a source unless its exact URL and supported fact are included. Do not invent search volume, trends, rankings, statistics, citations, quotations, dates or links. Provide a claim ledger with source URL/title and status VERIFIED_FROM_SOURCE / NEEDS_VERIFICATION / OPINION. Verified claims require a specific URL and note. If live research is unavailable, mark claims NEEDS_VERIFICATION and the draft NOT READY.",
    "NATURAL HUMAN-EDITOR VOICE: Write like a skilled independent sports editor: vivid but restrained storytelling, varied sentence rhythm, specific context, clear explanations of tactics and significance, natural conversational flow. Avoid formulaic intros, generic filler, exaggerated claims, keyword stuffing, fake quotes, fabricated interviews, fake eyewitness accounts, fake first-person experiences and robotic summaries. Never impersonate a human or misrepresent authorship. Do not copy another journalist's phrasing. Add a Natural voice and reader-value review and rewrite awkward passages.",
    "SEO: Include primary keyword and intent; related terms without fabricated volume; SEO title (60 characters or less where practical); meta description (160 characters or less); slug; H1/H2/H3 structure; internal-link topic targets without invented URLs; image concepts, licensing cautions and alt text.",
    "QUALITY GATE: Target at least 97/100 (9.7/10). The article must include both the dated multi-sport update and the featured player biography, at least three distinct source URLs, a source-backed evidence ledger, complete SEO metadata, natural editorial voice and a useful bio-data section where public facts exist. Revise and re-review any draft below 97; do not send a failed draft to Blogger. A score is an editorial signal, not proof of accuracy, originality, plagiarism clearance or Google ranking. Missing evidence means NEEDS OWNER REVIEW / NOT READY. Never label unsupported claims verified.",
    "ORIGINALITY AND POLICY: Do not copy other publishers. An AI originality self-check is not a plagiarism scan or proof of uniqueness. Check copyright, defamation, privacy, accessibility and Google policies. Do not invent interviews or quotes.",
    "MONETIZATION: Do not invent affiliate links, earnings, ad RPM, commissions or conversion forecasts. Actual income requires connected verified analytics; otherwise say NOT CONNECTED / NOT MEASURED.",
    "PUBLISHING SAFETY: Prepare Blogger drafts for owner review only. Never publish, schedule, send, spend, change accounts or call a live publishing action without explicit approval for that exact article. The owner only approves or rejects.",
    "RETURN FORMAT: Use exact top-level headings: Executive summary; Audience and assumptions; Research and evidence; Topic decision and scorecard; Task execution checklist; Complete article draft; Fact-check ledger; SEO package; Internal links and image plan; Quality-control results; CMS handoff; Measurement and income report; Risks and next actions.",
    "The Complete article draft section must contain the full article. Include the next biography backlog item, categories already covered based on saved topics, and the next planned sport/player. Do not claim any stage passed without its deliverable."
  ].join("\n\n");
}


export function buildBlogRevisionTask({ task, attempt = 1, previousError = "" } = {}) {
  const baseTask = String(task || "").trim();
  const retryNumber = Math.max(1, Number(attempt) || 1);
  const feedback = clean(previousError, 1800);
  if (retryNumber <= 1 && !feedback) return baseTask;
  return [
    baseTask,
    "AUTOMATIC EDITORIAL REVISION — retry attempt " + retryNumber + " of 4.",
    "The previous attempt did not pass the Sports King 18 editorial gate. Rewrite and improve the COMPLETE article, not just the report. Address every specific blocker below, retain only evidence-supported claims, and do not fabricate missing research.",
    feedback ? "PREVIOUS ATTEMPT BLOCKERS:\n" + feedback : "No previous error details were returned; re-check every required quality-gate item before responding.",
    "MANDATORY MACHINE-READABLE EDITORIAL FIELDS: include separate lines exactly formatted as `Article title: ...`, `SEO title: ...` (maximum 60 characters), `Primary keyword: ...`, and `Meta description: ...` (maximum 160 characters). Do not omit the SEO title or reuse a long headline as the SEO title.",
    "ARTICLE COMPLETENESS: write at least 950 useful words across the complete Sports Update and Featured Player Biography sections where reliable evidence supports that length. Include the exact India publication date. The Sports Update must contain at least three distinct sports only when there are genuinely sourced updates; do not pad with unrelated sports names. If current updates cannot be sourced, clearly mark the section NOT READY and do not invent results.",
    "EVIDENCE: include a `Fact-check ledger` with individual claims, exact source URLs and statuses `VERIFIED_FROM_SOURCE`, `NEEDS_VERIFICATION`, or `OPINION`. Use only real, directly relevant source URLs that you can identify confidently. Never fabricate a URL, quote, interview, statistic, date or source attribution. If a source cannot be verified, mark the claim NEEDS_VERIFICATION and the whole article NOT READY for Blogger handoff.",
    "EDITORIAL CHECKLIST: include a `Natural voice and reader-value review` section; an `Originality caveat` that says the AI check is not a plagiarism scan or proof of uniqueness; a `CMS handoff` section confirming private-draft-only and owner approval for publishing; and an explicit `Actual income: NOT CONNECTED / NOT MEASURED` line unless verified analytics are connected.",
    "Before returning, check every prior blocker and every required field above. Do not claim a 95+/100 score yourself; the application independently calculates the gate. If any required evidence or field is missing, state NOT READY instead of claiming the article passed.",
    "Return the entire corrected report with the exact required headings and the complete revised article body. Do not return only a checklist or summary."
  ].join("\n\n");
}
export function extractBlogArticle(report, dayKey = "") {
  const text = String(report || "");
  const lines = text.split(/\r?\n/);
  const titleLine = text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:Article title|Working title|Title)(?:\*\*)?\s*[:：-]\s*(.+)$/im);
  const seoTitleLine = text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?SEO title(?:\*\*)?\s*[:：-]\s*(.+)$/im);
  const titledPhrase = text.match(/\btitled\s+(?:\*\*)?[“"']([^”"']+)[”"'](?:\*\*)?/i);
  const metaTitle = text.match(/^\s*(?:[-*]\s*)?\*\*Title\*\*\s*[:：|]\s*(.+)$/im);
  const keyword = text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:Primary keyword|Primary target keyword|Target keyword)(?:\*\*)?\s*[:：-]\s*(.+)$/im);
  const meta = text.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(?:Meta description|SEO description)(?:\*\*)?\s*[:：-]\s*(.+)$/im);
  let startIndex = lines.findIndex(isArticleStart);
  let includeStartHeading = false;
  // Recover when a provider follows the required reader-facing H2 structure
  // but omits the optional "Complete article draft" wrapper. Require both
  // article sections so reports and checklists are never mistaken for content.
  if (startIndex < 0) {
    const sportsUpdateIndex = lines.findIndex(line => /^ {0,3}#{1,3}\s+Sports Update\b/i.test(line));
    const biographyIndex = lines.findIndex(line => /^ {0,3}#{1,3}\s+Featured Player Biography\b/i.test(line));
    if (sportsUpdateIndex >= 0 && biographyIndex > sportsUpdateIndex) {
      startIndex = sportsUpdateIndex;
      includeStartHeading = true;
    }
  }
  let article = "";
  if (startIndex >= 0) {
    let endIndex = lines.length;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (POST_ARTICLE_HEADINGS.has(normalizedHeading(lines[index]))) {
        endIndex = index;
        break;
      }
    }
    article = lines.slice(includeStartHeading ? startIndex : startIndex + 1, endIndex).join("\n").trim();
  }
  const wordCount = article.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu)?.length || 0;
  const extractedTitle = stripMarkdown(titleLine?.[1] || titledPhrase?.[1] || metaTitle?.[1] || seoTitleLine?.[1] || "", 180);
  const extractedMeta = stripMarkdown(meta?.[1] || "", 320);
  return {
    title: extractedTitle || "Daily blog draft " + clean(dayKey, 20),
    seoTitle: stripMarkdown(seoTitleLine?.[1] || "", 180),
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
  const rawSourceUrls = [...report.matchAll(/https?:\/\/[^\s)\]]+/gi)].map(match => match[0].replace(/[.,;]+$/, ""));
  const invalidSourceUrls = rawSourceUrls.filter(url => /example\.(?:com|org|net)|\/(?:1234567|12345|placeholder)(?:[/?#]|$)|\bplaceholder\b/i.test(url));
  const sourceUrls = rawSourceUrls.filter(url => !invalidSourceUrls.includes(url));
  const hasSourceUrl = sourceUrls.length > 0;
  const hasSourceCoverage = new Set(sourceUrls).size >= 3;
  const sportsSection = (article.match(/#{1,3}\s+Sports Update\b([\s\S]*?)#{1,3}\s+Featured Player Biography\b/i) || [])[1] || "";
  const sportsCovered = ["cricket", "football", "tennis", "badminton", "hockey", "basketball", "athletics", "motorsport", "kabaddi", "volleyball", "golf", "wrestling", "boxing", "swimming"]
    .filter(sport => new RegExp("\b" + sport + "\b", "i").test(sportsSection));
  const dateParts = String(draft?.dayKey || "").split("-");
  const day = Number(dateParts[2]);
  const month = Number(dateParts[1]);
  const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1] || "";
  const dateText = day && monthName
    ? new RegExp("(?:\b" + day + "\s+" + monthName + "\s+" + currentYear + "\b|\b" + monthName + "\s+" + day + ",?\s+" + currentYear + "\b|" + draft.dayKey + ")","i").test(article)
    : false;
  const staleForwardLookingClaim = new RegExp("(?:currently|upcoming|looking ahead|next season|set to compete|will compete)[^\\n]{0,100}\b20(0\\d|1\\d|2[0-5])\b","i").test(article);
  const claimsMarkedVerified = /VERIFIED_FROM_SOURCE|verified facts?/i.test(report);
  const claimsHaveUrls = !claimsMarkedVerified || hasSourceUrl;
  const claimsRetailResearch = /(?:searched|scoured|checked|cross-checked|compared)\s+(?:Amazon|Flipkart|retailer|retailers|reviews|expert tech blogs)/i.test(report);
  const retailerResearchHasEvidence = !claimsRetailResearch || /https?:\/\/[^\s)\]]*(?:amazon\.in|flipkart\.com)/i.test(report);
  const placeholderData = /\bLaptop\s+[A-E]\b|Brand\/Model|\[Brand\/?Model\]|₹\s*XX|\bModel\s+[A-E]\b/i.test(combined);
  const staleYear = Boolean(yearMatch && Number(yearMatch[1]) < currentYear && !/historical|archival|archive/i.test(draft?.title || ""));
  const numericProductClaims = /₹\s*[\d,]+|\b\d+(?:\.\d+)?\s*(?:GB|TB|Hz)\b|(?:price|cost|free version|free tier|subscription|commission|warranty|battery life|RAM|storage|processor|display|specifications?).{0,60}\b(?:\d+(?:\.\d+)?|free|paid|available|included)\b/i.test(article);
  const productClaimsHaveEvidence = !numericProductClaims || hasSourceUrl;
  const checks = {
    sportsUpdateAndPlayerBiography: /(?:^|\n)#{1,3}\s+Sports Update\b/im.test(article) && /(?:^|\n)#{1,3}\s+Featured Player Biography\b/im.test(article),
    sportsUpdateDate: dateText,
    multiSportCoverage: sportsCovered.length >= 3,
    sourceCoverage: hasSourceCoverage,
    sourceUrlIntegrity: invalidSourceUrls.length === 0,
    completeArticle: article.trim().length >= 1800,
    usefulLength: Number(draft?.wordCount || 0) >= 850,
    seoTitle: Boolean((draft?.seoTitle || draft?.title) && (draft?.seoTitle || draft?.title).length <= 60),
    metaDescription: Boolean(draft?.metaDescription && draft.metaDescription.length <= 160),
    primaryKeyword: Boolean(draft?.primaryKeyword),
    evidenceLedger: /fact[\s\u2010-\u2015-]*check ledger/i.test(report) && /needs.verification|verified.from.source|opinion/i.test(report),
    verifiedClaimsHaveSourceUrls: claimsHaveUrls,
    retailerResearchHasSourceUrls: retailerResearchHasEvidence,
    noPlaceholderProductData: !placeholderData,
    currentTopicOrHistoricalLabel: !staleYear,
    noStaleForwardLookingClaims: !staleForwardLookingClaim,
    numericProductClaimsHaveEvidence: productClaimsHaveEvidence,
    seoPackage: /SEO package/i.test(report),
    originalityCaveat: /plagiarism scan was run|plagiarism checker|not proof of uniqueness|originality/i.test(report),
    naturalVoiceReview: /natural voice and reader[\s‑–-]+value review/i.test(report),
    cmsHandoff: /CMS handoff/i.test(report),
    incomeHonesty: /NOT CONNECTED|NOT MEASURED|not connected|not measured/i.test(report)
  };
  const blockers = [
    ...(!claimsHaveUrls ? ["A claim is marked VERIFIED_FROM_SOURCE but no source URL is present."] : []),
    ...(!hasSourceCoverage ? ["The editorial report must cite at least three distinct source URLs before passing the sports quality gate."] : []),
    ...(invalidSourceUrls.length ? ["One or more source URLs look like placeholders or fabricated example links and must be replaced with real source pages."] : []),
    ...(!dateText ? ["The Sports Update must state the exact India publication date."] : []),
    ...(sportsCovered.length < 3 ? ["The Sports Update must cover at least three distinct sports where verified updates are available; do not invent missing updates."] : []),
    ...(staleForwardLookingClaim ? ["The article contains an outdated year presented as current or upcoming information."] : []),
    ...(!retailerResearchHasEvidence ? ["Retailer research is claimed without an Amazon India or Flipkart source URL."] : []),
    ...(placeholderData ? ["Placeholder product names or prices are present."] : []),
    ...(staleYear ? ["The article title uses an outdated year for a current article."] : []),
    ...(!productClaimsHaveEvidence ? ["Specific product prices/specifications appear without a source URL."] : [])
  ];
  const passed = Object.values(checks).filter(Boolean).length;
  const score = Math.round(passed / Object.keys(checks).length * 100);
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    status: failures.length === 0 && blockers.length === 0 && score >= 97 ? "passed" : "needs_review",
    score: blockers.length ? Math.min(score, 69) : score,
    targetScore: 97,
    checks,
    failures,
    blockers,
    wordCount: Number(draft?.wordCount || 0),
    disclaimer: "Automated editorial checks are safeguards, not proof of factual accuracy, legal compliance, source validity, or plagiarism-free content. Human review remains required."
  };
}
