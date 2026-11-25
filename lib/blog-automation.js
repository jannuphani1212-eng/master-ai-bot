const MAX_PRIOR_TOPICS = 40;

function clean(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

export function buildDailyBlogTask({ dayKey, priorTopics = [] } = {}) {
  const history = [...new Set(priorTopics.map(item => clean(item, 180)).filter(Boolean))]
    .slice(0, MAX_PRIOR_TOPICS);
  return [
    "AUTONOMOUS DAILY BLOG EDITORIAL WORK ORDER",
    "Date (India): " + clean(dayKey, 20),
    "You are responsible for selecting and producing today's best blog article without asking the owner for a topic.",
    "BUSINESS CONTEXT: India-focused, English-first, Android/mobile readers, ₹0 upfront budget. Prefer topics that reinforce the owner's existing content and income workstreams: practical education/how-to content, original children's learning resources where suitable, and genuinely useful fashion/watch comparisons only when supported by evidence. Do not drift into unrelated niches.",
    "TOPIC DECISION: Generate several candidate angles internally, then select ONE based on reader demand signals that can actually be evidenced, search intent clarity, fit with the business, reader usefulness, ability to create a genuinely original article, free/available resources, and low policy risk. Explain the selection and score the criteria qualitatively. Do not invent search volume, trends, competitor gaps, analytics, or demand. If live demand data is unavailable, label the decision as a reasoned hypothesis and specify what Search Console/analytics evidence would validate it.",
    "DUPLICATE AVOIDANCE: Do not repeat or lightly reword these recent topics. Choose a meaningfully different reader problem or angle: " + (history.length ? history.join(" | ") : "No saved topic history supplied; avoid generic filler."),
    "AUTOMATIC SUBTASKS: Explicitly complete and report these stages in order: (1) topic research and selection, (2) reader/search-intent brief, (3) full article writing, (4) fact-check and evidence audit, (5) on-page SEO, (6) internal-link and image/alt-text plan, (7) editorial quality review, (8) save-ready CMS preparation, (9) daily performance/reporting plan.",
    "ARTICLE REQUIREMENTS: Write a complete original article, not an outline or short report. Aim for 900–1,300 useful words where the subject supports that length; never pad. Use a clear H1, engaging introduction, descriptive H2/H3 headings, practical examples, concise paragraphs, actionable conclusion and a natural CTA. Explain limitations and avoid unsupported expertise claims. Do not copy or imitate another publisher.",
    "FACT-CHECK: Provide a claim ledger with each material factual claim, source URL/title if actually consulted, and status VERIFIED_FROM_SOURCE / NEEDS_VERIFICATION / OPINION. Never fabricate citations, quotations, links, dates, prices, specifications, regulations or statistics. If no live research source is available, mark factual claims needing review instead of pretending they were checked.",
    "SEO DELIVERABLES: Primary keyword and intent; related terms without fabricated volume; SEO title (≤60 characters where practical); meta description (≤160 characters where practical); slug; H1/H2/H3 structure; suggested schema only if suitable; 3–5 internal-link targets described by topic (do not invent URLs); image concepts, licensing cautions and descriptive alt text.",
    "ORIGINALITY AND READABILITY: Explain the article's unique reader value and what distinguishes it from a generic AI summary. Check repetition, clarity, mobile readability, grammar, accessibility, affiliate/ad disclosures where applicable, copyright and child-safety if relevant. Do not claim a plagiarism scan was run unless a real checker result is supplied. A model self-check is not proof of uniqueness.",
    "MONETIZATION: Recommend monetization only when it genuinely serves the reader. Mark affiliate disclosures clearly. Never insert fabricated products, prices, affiliate links, earnings, ad RPM, or conversion forecasts. Actual income must be reported only from connected, verified analytics; otherwise say NOT CONNECTED / NOT MEASURED.",
    "PUBLISHING SAFETY: Prepare a CMS-ready draft only. Do not call Blogger/WordPress APIs, publish, schedule, send, spend, or change accounts. CMS transfer remains behind explicit owner approval.",
    "RETURN FORMAT: Use these exact top-level headings: Executive summary; Audience and assumptions; Research and evidence; Topic decision and scorecard; Task execution checklist; Complete article draft; Fact-check ledger; SEO package; Internal links and image plan; Quality-control results; CMS handoff; Measurement and income report; Risks and next actions.",
    "The Complete article draft section must contain the actual full article. Keep all unknowns visible. Do not claim any stage passed unless the report contains its deliverable."
  ].join("\n\n");
}

export function extractBlogArticle(report, dayKey = "") {
  const text = String(report || "");
  const title = text.match(/^\s{0,3}(?:#{1,2}\s*)?(?:\*\*)?(?:Article title|Working title|SEO title|Title)(?:\*\*)?\s*[:：-]\s*(.+)$/im)
    || text.match(/^\s*#\s+(.+)$/m);
  const keyword = text.match(/^\s*(?:Primary keyword|Primary target keyword|Target keyword)(?:\*\*)?\s*[:：-]\s*(.+)$/im);
  const meta = text.match(/^\s*(?:Meta description|SEO description)(?:\*\*)?\s*[:：-]\s*(.+)$/im);
  const articleHeading = /^\s{0,3}#{1,4}\s*(?:\*\*)?Complete article draft(?:\*\*)?\s*$/im;
  const match = articleHeading.exec(text);
  let article = "";
  if (match) {
    const start = match.index + match[0].length;
    const tail = text.slice(start);
    const next = tail.search(/^\s{0,3}#{1,4}\s+[^\n]+/m);
    article = (next >= 0 ? tail.slice(0, next) : tail).trim();
  }
  const wordCount = article.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu)?.length || 0;
  return {
    title: clean(title?.[1] || "Daily blog draft " + dayKey, 180),
    primaryKeyword: clean(keyword?.[1] || "", 240),
    metaDescription: clean(meta?.[1] || "", 320),
    article,
    wordCount,
    report: text
  };
}

export function reviewBlogArticle(draft) {
  const article = String(draft?.article || "");
  const report = String(draft?.report || "");
  const checks = {
    completeArticle: article.trim().length >= 1800,
    usefulLength: Number(draft?.wordCount || 0) >= 350,
    seoTitle: Boolean(draft?.title && draft.title.length <= 180),
    metaDescription: Boolean(draft?.metaDescription),
    primaryKeyword: Boolean(draft?.primaryKeyword),
    evidenceLedger: /fact-check ledger/i.test(report) && /needs.verification|verified.from.source|opinion/i.test(report),
    seoPackage: /SEO package/i.test(report),
    originalityCaveat: /plagiarism scan was run|plagiarism checker|not proof of uniqueness|originality/i.test(report),
    cmsHandoff: /CMS handoff/i.test(report),
    incomeHonesty: /NOT CONNECTED|NOT MEASURED|not connected|not measured/i.test(report)
  };
  const passed = Object.values(checks).filter(Boolean).length;
  const score = Math.round(passed / Object.keys(checks).length * 100);
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    status: failures.length === 0 ? "passed" : "needs_review",
    score,
    checks,
    failures,
    wordCount: Number(draft?.wordCount || 0),
    disclaimer: "Automated editorial checks do not prove factual accuracy, legal compliance, or plagiarism-free content. Human review remains required."
  };
}
