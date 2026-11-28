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
  return /^ {0,3}(?:#{1,6}\s*)?(?:\*\*)?(?:\d+[.)]\s*)?(?:complete|full)\s+article(?:\s+draft)?(?:\*\*)?(?:\s*(?::|：|—|–|-)\s*.*|\s*\([^)]*\)|\s*\[[^\]]*\])?\s*$/i.test(String(line || ""));
}

function isArticleSectionHeading(line, label) {
  const heading = String(line || "").trim()
    .replace(/^#{1,3}\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim().toLowerCase();
  const target = label.toLowerCase();
  return heading.startsWith(target) && /^(?:\s|[:：—–-]|$)/.test(heading.slice(target.length));
}

function isPostArticleHeading(line) {
  const heading = normalizedHeading(line);
  return [...POST_ARTICLE_HEADINGS].some(label =>
    heading === label || [" ", ":", "：", "—", "–", " -"].some(mark => heading.startsWith(label + mark))
  );
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
    "RESEARCH HONESTY: Never claim to have checked a source unless its exact URL and supported fact are included. Do not invent search volume, trends, rankings, statistics, citations, quotations, dates or links. Provide a claim ledger with source URL/title and status VERIFIED_FROM_SOURCE / NEEDS_VERIFICATION / OPINION. Verified claims require a specific URL and note. If live research is unavailable, mark claims NEEDS_VERIFICATION and the draft NOT READY. Add a separate machine-readable line `Research readiness: READY` only when at least three recent RSS items are supplied, the article uses only details supported by those headlines/summaries or otherwise directly verified facts, and at least three distinct claim rows are supported by exact source URLs. Otherwise write `Research readiness: NOT READY` and do not claim the article is ready for Blogger.",
    "NATURAL HUMAN-EDITOR VOICE: Write like a skilled independent sports editor: vivid but restrained storytelling, varied sentence rhythm, specific context, clear explanations of tactics and significance, natural conversational flow. Avoid formulaic intros, generic filler, exaggerated claims, keyword stuffing, fake quotes, fabricated interviews, fake eyewitness accounts, fake first-person experiences and robotic summaries. Never impersonate a human or misrepresent authorship. Do not copy another journalist's phrasing. Add a Natural voice and reader-value review and rewrite awkward passages.",
    "SEO: Include primary keyword and intent; related terms without fabricated volume; SEO title (60 characters or less where practical); meta description (160 characters or less); slug; H1/H2/H3 structure; internal-link topic targets without invented URLs; image concepts, licensing cautions and alt text.",
    "QUALITY GATE: Target at least 97/100 (9.7/10). The article must include both the dated multi-sport update and the featured player biography, at least three distinct source URLs, a source-backed evidence ledger, complete SEO metadata, natural editorial voice and a useful bio-data section where public facts exist. Revise and re-review any draft below 97; do not send a failed draft to Blogger. A score is an editorial signal, not proof of accuracy, originality, plagiarism clearance or Google ranking. Missing evidence means NEEDS OWNER REVIEW / NOT READY. Never label unsupported claims verified.",
    "ORIGINALITY AND POLICY: Do not copy other publishers. An AI originality self-check is not a plagiarism scan or proof of uniqueness. Check copyright, defamation, privacy, accessibility and Google policies. Do not invent interviews or quotes.",
    "MONETIZATION: Do not invent affiliate links, earnings, ad RPM, commissions or conversion forecasts. Actual income requires connected verified analytics; otherwise say NOT CONNECTED / NOT MEASURED.",
    "PUBLISHING SAFETY: Prepare Blogger drafts for owner review only. Never publish, schedule, send, spend, change accounts or call a live publishing action without explicit approval for that exact article. The owner only approves or rejects.",
    "COMPACT DAILY OUTPUT CONTRACT: Avoid a long executive summary or strategy preamble; reserve most output tokens for the reader-facing article. Return these exact fields and headings in this order: Article title: ...; SEO title: ... (maximum 60 characters); Primary keyword: ...; Meta description: ... (maximum 160 characters); Research readiness: READY or NOT READY; ## Complete article draft; ## Sports Update; ## Featured Player Biography; ## Fact-check ledger; ## SEO package; ## Natural voice and reader-value review; ## CMS handoff; Actual income: NOT CONNECTED / NOT MEASURED.",
    "The Complete article draft must contain the full dated Sports Update and Featured Player Biography, together at least 850 useful words where reliable evidence supports that length. Include at least three distinct exact source URLs in the Fact-check ledger, each with a claim and VERIFIED_FROM_SOURCE / NEEDS_VERIFICATION / OPINION status. Do not mark a claim verified without a source. The Natural voice and reader-value review must be a short, explicit section. The CMS handoff must say private Blogger draft only and owner approval required for publishing. Keep the SEO package concise (slug and related terms). Include the next biography backlog item in one short line. Do not add other long report sections or claim any stage passed without its deliverable."
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
    "MANDATORY MACHINE-READABLE EDITORIAL FIELDS: include separate lines exactly formatted as `Article title: ...`, `SEO title: ...` (maximum 60 characters), `Primary keyword: ...`, `Meta description: ...` (maximum 160 characters), and `Research readiness: READY` or `Research readiness: NOT READY`. Do not omit the SEO title or reuse a long headline as the SEO title. Use READY only when the supplied research and claim ledger support it; otherwise use NOT READY.",
    "ARTICLE COMPLETENESS: write at least 950 useful words across the complete Sports Update and Featured Player Biography sections where reliable evidence supports that length. Include the exact India publication date. The Sports Update must contain at least three distinct sports only when there are genuinely sourced updates; do not pad with unrelated sports names. If current updates cannot be sourced, clearly mark the section NOT READY and do not invent results.",
    "STRUCTURE: inside the Complete article draft, include these exact standalone Markdown H2 headings: ## Sports Update and ## Featured Player Biography. Do not replace them with bold text, H3 headings, or alternate wording. The Featured Player Biography must follow the Sports Update.",
    "EVIDENCE: include a `Fact-check ledger` with individual claims, exact source URLs and statuses `VERIFIED_FROM_SOURCE`, `NEEDS_VERIFICATION`, or `OPINION`. Use only real, directly relevant source URLs that you can identify confidently. Never fabricate a URL, quote, interview, statistic, date or source attribution. Do not invent biography sources. Any allegation about doping, positive tests, bans, suspensions, arrest, criminal conduct, assault, abuse, fraud or misconduct must be omitted unless a matching official sports authority source is cited on that exact ledger row; otherwise mark NEEDS_VERIFICATION and remove it from the narrative. Every medal-year and medal-type claim in the biography must have its own fact-check ledger row with a matching year, medal and official sports authority URL. Do not infer medals or invent result URLs. If a source cannot be verified, mark the claim NEEDS_VERIFICATION and the whole article NOT READY for Blogger handoff.",
    "EDITORIAL CHECKLIST: include a `Natural voice and reader-value review` section; an `Originality caveat` that says the AI check is not a plagiarism scan or proof of uniqueness; a `CMS handoff` section confirming private-draft-only and owner approval for publishing; and an explicit `Actual income: NOT CONNECTED / NOT MEASURED` line unless verified analytics are connected.",
    "Before returning, check every prior blocker and every required field above. Do not claim a 95+/100 score yourself; the application independently calculates the gate. If any required evidence or field is missing, state NOT READY instead of claiming the article passed.",
    "Return the entire corrected report with the exact required headings and the complete revised article body. Do not return only a checklist or summary."
  ].join("\n\n");
}
function extractLabeledField(text, labelPattern) {
  const lines = String(text || "").split(/\r?\n/);
  const label = new RegExp("^\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:" + labelPattern + ")(?:\\*\\*)?\\s*[:：-]\\s*(.*?)(?:\\*\\*)?\\s*$", "i");
  const knownField = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:Article title|Working title|SEO title|Primary keyword|Primary target keyword|Target keyword|Meta description|SEO description)\b/i;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(label);
    if (!match) continue;
    const inline = stripMarkdown(match[1] || "", 500);
    if (inline) return inline;
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (!candidate) continue;
      if (knownField.test(candidate) || candidate.startsWith("#")) break;
      return stripMarkdown(candidate, 500);
    }
    return "";
  }
  return "";
}

function normalizeBlogSectionHeadings(article) {
  return String(article || "").split(/\r?\n/).map(line => {
    let heading = String(line || "").trim();
    heading = heading.replace(/^#{1,6}\s*/, "").replace(/^#{1,6}\s*/, "");
    heading = heading.replace(/^\*\*(.*?)\*\*$/, "$1").trim();
    if (/^Sports Update\b/i.test(heading) || /^Featured Player Biography\b/i.test(heading)) return "## " + heading;
    return line;
  }).join("\n");
}

function fitSeoTitle(value, max = 60) {
  const title = stripMarkdown(value || "", 180);
  if (title.length <= max) return title;
  let shortened = title.slice(0, max + 1);
  const boundary = shortened.lastIndexOf(" ");
  if (boundary >= Math.floor(max * 0.55)) shortened = shortened.slice(0, boundary);
  return shortened.replace(/[\s:;,.–—-]+$/g, "").trim();
}

export function extractBlogArticle(report, dayKey = "") {
  const text = String(report || "");
  const lines = text.split(/\r?\n/);
  const titleValue = extractLabeledField(text, "Article title|Working title|Title");
  const seoTitleValue = extractLabeledField(text, "SEO title");
  const titledPhrase = text.match(/\btitled\s+(?:\*\*)?[“"']([^”"']+)[”"'](?:\*\*)?/i);
  const metaTitle = text.match(/^\s*(?:[-*]\s*)?\*\*Title\*\*\s*[:：|]\s*(.+)$/im);
  const keywordValue = extractLabeledField(text, "Primary keyword|Primary target keyword|Target keyword");
  const metaValue = extractLabeledField(text, "Meta description|SEO description");
  let startIndex = lines.findIndex(isArticleStart);
  let includeStartHeading = false;
  // Recover when a provider follows the required reader-facing H2 structure
  // but omits the optional "Complete article draft" wrapper. Require both
  // article sections so reports and checklists are never mistaken for content.
  if (startIndex < 0) {
    const sportsUpdateIndex = lines.findIndex(line => isArticleSectionHeading(line, "Sports Update"));
    const biographyIndex = lines.findIndex(line => isArticleSectionHeading(line, "Featured Player Biography"));
    if (sportsUpdateIndex >= 0 && biographyIndex > sportsUpdateIndex) {
      startIndex = sportsUpdateIndex;
      includeStartHeading = true;
    }
  }
  let article = "";
  if (startIndex >= 0) {
    let endIndex = lines.length;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (isPostArticleHeading(lines[index])) {
        endIndex = index;
        break;
      }
    }
    article = lines.slice(includeStartHeading ? startIndex : startIndex + 1, endIndex).join("\n").trim();
  }
  article = normalizeBlogSectionHeadings(article);
  const wordCount = article.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu)?.length || 0;
  const extractedTitle = stripMarkdown(titleValue || titledPhrase?.[1] || metaTitle?.[1] || seoTitleValue || "", 180);
  const extractedMeta = stripMarkdown(metaValue || "", 320);
  return {
    title: extractedTitle || "Daily blog draft " + clean(dayKey, 20),
    seoTitle: fitSeoTitle(seoTitleValue, 60),
    primaryKeyword: stripMarkdown(keywordValue || "", 240),
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
  // Only count evidence rows inside the fact-check ledger. Bare URLs elsewhere
  // in the report, or a list of homepages, are not claim-level evidence.
  // These rows are structural checks; the application does not fetch source pages.
  const reportLines = report.split(/\r?\n/);
  const ledgerStart = reportLines.findIndex(line => /fact[\s\u2010-\u2015-]*check ledger/i.test(line));
  const ledgerEnd = ledgerStart < 0 ? -1 : reportLines.findIndex((line, index) => index > ledgerStart && /^\s*#{1,4}\s+/.test(line));
  const ledgerSection = ledgerStart < 0 ? [] : reportLines.slice(ledgerStart + 1, ledgerEnd < 0 ? reportLines.length : ledgerEnd);
  const factCheckEvidenceRows = ledgerSection.filter(line =>
    /https?:\/\//i.test(line) &&
    /VERIFIED_FROM_SOURCE|NEEDS_VERIFICATION|OPINION/i.test(line) &&
    line.replace(/https?:\/\/[^\s)\]]+/gi, "").replace(/VERIFIED_FROM_SOURCE|NEEDS_VERIFICATION|OPINION/gi, "").replace(/[|—–:;\s]/g, "").length >= 6
  );
  const parseLedgerUrl = value => {
    try {
      const parsed = new URL(value);
      // A domain homepage is not claim-level evidence. Require HTTPS and a
      // specific resource path so the reviewer can identify the cited item.
      if (parsed.protocol !== "https:" || !parsed.hostname.includes(".") || parsed.pathname === "/" || parsed.pathname.length < 2) return null;
      if (/example\.(?:com|org|net)|placeholder|\/\d{4,}(?:[/?#]|$)/i.test(parsed.href)) return null;
      return parsed.href.replace(/\/$/, "");
    } catch {
      return null;
    }
  };
  const ledgerSourceUrls = factCheckEvidenceRows.flatMap(line =>
    [...line.matchAll(/https?:\/\/[^\s)\]]+/gi)]
      .map(match => parseLedgerUrl(match[0].replace(/[.,;]+$/, "")))
      .filter(Boolean)
  );
  const verifiedEvidenceRows = factCheckEvidenceRows.filter(line => /VERIFIED_FROM_SOURCE/i.test(line));
  const verifiedLedgerSourceUrls = verifiedEvidenceRows.flatMap(line =>
    [...line.matchAll(/https?:\/\/[^\s)\]]+/gi)]
      .map(match => parseLedgerUrl(match[0].replace(/[.,;]+$/, "")))
      .filter(Boolean)
  );
  const hasSourceCoverage = new Set(ledgerSourceUrls).size >= 3 &&
    factCheckEvidenceRows.length >= 3 &&
    new Set(verifiedLedgerSourceUrls).size >= 3 &&
    verifiedEvidenceRows.length >= 3;
  const sportsSection = (article.match(/#{1,3}\s+Sports Update\b([\s\S]*?)#{1,3}\s+Featured Player Biography\b/i) || [])[1] || "";
  const sportsCovered = ["cricket", "football", "tennis", "badminton", "hockey", "basketball", "athletics", "motorsport", "kabaddi", "volleyball", "golf", "wrestling", "boxing", "swimming", "snooker", "formula 1", "f1", "racing", "rugby", "cycling", "table tennis", "chess", "rowing", "surfing", "ice hockey"]
    .filter(sport => new RegExp("\\b" + sport + "\\b", "i").test(sportsSection));
  const sportTerms = ["cricket", "football", "tennis", "badminton", "hockey", "basketball", "athletics", "motorsport", "kabaddi", "volleyball", "golf", "wrestling", "boxing", "swimming", "snooker", "formula 1", "f1", "racing", "rugby", "cycling", "table tennis", "chess", "rowing", "surfing", "ice hockey"];
  // A model-written URL is not evidence by itself. Match each sports-news
  // ledger row to the exact article URL and sport returned by the RSS research
  // step; this prevents fabricated or unrelated URLs from satisfying coverage.
  const researchItems = Array.isArray(draft?.researchItems) ? draft.researchItems : [];
  const researchUrlToSport = new Map(researchItems.flatMap(item => {
    try {
      const url = new URL(String(item?.url || ""));
      if (url.protocol !== "https:" || url.username || url.password) return [];
      return [[url.toString(), String(item?.sport || "").toLowerCase()]];
    } catch {
      return [];
    }
  }));
  const sportsEvidenceCovered = [...new Set(verifiedEvidenceRows.flatMap(row => {
    const claimLabel = String(row.split("|")[0] || "").trim();
    if (!/\\b(?:update|match|tournament|event|result|news)\\b/i.test(claimLabel)) return [];
    const rowUrls = [...row.matchAll(/https?:\\/\\/[^\\s)\\]]+/gi)]
      .map(match => parseLedgerUrl(match[0].replace(/[.,;]+$/, "")))
      .filter(Boolean);
    return sportTerms.filter(sport => {
      if (!new RegExp("\\\\b" + sport + "\\\\b", "i").test(claimLabel)) return false;
      return rowUrls.some(url => {
        const researchSport = researchUrlToSport.get(url);
        return Boolean(researchSport && new RegExp("\\\\b" + sport + "\\\\b", "i").test(researchSport));
      });
    });
  }))];
  const researchFeedReady = draft?.researchStatus === "rss_headlines_available" && Number(draft?.researchItemCount || 0) >= 3;
  const researchReadiness = /(?:^|\n)\s*Research readiness\s*:\s*READY\b/i.test(report) &&
    !/(?:^|\n)\s*Research readiness\s*:\s*NOT READY\b/i.test(report);
  const dateParts = String(draft?.dayKey || "").split("-");
  const day = Number(dateParts[2]);
  const month = Number(dateParts[1]);
  const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1] || "";
  const dateText = day && monthName
    ? new RegExp("(?:\\b" + day + "\\s+" + monthName + "\\s+" + currentYear + "\\b|\\b" + monthName + "\\s+" + day + ",?\\s+" + currentYear + "\\b|" + draft.dayKey + ")","i").test(article)
    : false;
  const staleForwardLookingClaim = new RegExp("(?:currently|upcoming|looking ahead|next season|set to compete|will compete)[^\n]{0,100}\\b20(0\\d|1\\d|2[0-5])\\b","i").test(article);
  const claimsMarkedVerified = /VERIFIED_FROM_SOURCE|verified facts?/i.test(report);
  const claimsHaveUrls = !claimsMarkedVerified || hasSourceUrl;
  const claimsRetailResearch = /(?:searched|scoured|checked|cross-checked|compared)\s+(?:Amazon|Flipkart|retailer|retailers|reviews|expert tech blogs)/i.test(report);
  const sensitiveClaimLines = article.split(/\r?\n/).filter(line =>
    /\b(?:doping|positive test|banned substance|suspension|suspended|arrested|charged with|convicted|assault|abuse|fraud|misconduct)\b/i.test(line)
  );
  const officialSportsHosts = new Set([
    "olympics.com", "thecgf.com", "wada-ama.org", "unitedworldwrestling.org",
    "uww.org", "wrestlingfederationofindia.org", "worldathletics.org",
    "fifa.com", "icc-cricket.com", "bcci.tv", "itftennis.com", "fiba.basketball"
  ]);
  const ledgerLines = factCheckEvidenceRows;
  const sensitiveClaimsHaveAuthoritativeEvidence = sensitiveClaimLines.every(claim => {
    const terms = claim.toLowerCase().match(/\b(?:doping|positive test|banned substance|suspension|suspended|arrested|charged with|convicted|assault|abuse|fraud|misconduct)\b/g) || [];
    return ledgerLines.some(row => {
      const urls = [...row.matchAll(/https?:\/\/[^\s)\]]+/gi)].map(match => {
        try { return new URL(match[0]).hostname.toLowerCase(); } catch { return ""; }
      });
      return terms.some(term => row.toLowerCase().includes(term)) &&
        urls.some(host => [...officialSportsHosts].some(official => host === official || host.endsWith("." + official)));
    });
  });
  const biographySection = article.match(/(?:^|\n)#{1,4}\s*Featured Player Biography[\s\S]*?(?=\n#{1,4}\s|$)/i)?.[0] || "";
  const biographySportConflicts = [
    { name: /\bSakshi\s+Malik\b/i, wrongSport: /\bbox(?:ing|er|ers)\b/i, expectedSport: "wrestling" },
    { name: /\bMary\s+Kom\b/i, wrongSport: /\bwrestling\b/i, expectedSport: "boxing" },
    { name: /\bNeeraj\s+Chopra\b/i, wrongSport: /\bboxing|wrestling|badminton\b/i, expectedSport: "athletics / javelin" },
    { name: /\bP\.?\s*V\.?\s*Sindhu\b/i, wrongSport: /\bboxing|wrestling|tennis\b/i, expectedSport: "badminton" },
    { name: /\bSaina\s+Nehwal\b/i, wrongSport: /\bboxing|wrestling|tennis\b/i, expectedSport: "badminton" },
    { name: /\bSunil\s+Chhetri\b/i, wrongSport: /\bcricket|hockey|badminton\b/i, expectedSport: "football" },
    { name: /\bShreyas\s+Iyer\b/i, wrongSport: /\bboxing|wrestling|football\b/i, expectedSport: "cricket" }
  ];
  const biographySportMismatch = biographySportConflicts.find(rule => rule.name.test(biographySection) && rule.wrongSport.test(biographySection));
  const biographySportIdentityConsistent = !biographySportMismatch;
  const biographyKnownFactConflicts = [
    {
      name: /\bP\.?\s*V\.?\s*Sindhu\b/i,
      // Tolerate abbreviated months, Unicode spaces and either medal/competition
      // word order commonly used in generated biography tables.
      incorrectClaims: [
        /\b5\s+(?:February|Feb\.?|March|Mar\.?)\s+1995\b/i,
        /\b2013\b.{0,100}\b(?:Commonwealth Games|CWG)\b.{0,40}\bgold\b/i,
        /\b2013\b.{0,40}\bgold\b.{0,100}\b(?:Commonwealth Games|CWG)\b/i,
        /\b2015\b.{0,60}\bgold\b.{0,100}\bAsian Championships?\b/i,
        /\b2015\b.{0,100}\bAsian Championships?\b.{0,40}\bgold\b/i,
        /\b2024\b.{0,60}\b(?:Olympic|Paris Games?)\b.{0,40}\bbronze\b/i,
        /\b(?:Olympic|Paris Games?)\b.{0,40}\bbronze\b.{0,60}\b2024\b/i,
        /\bCarolina\s+D[ií]az\b/i,
        /\bLi\s+Xinhui\b/i,
        /\bSaina\s+Nagaraj\b/i
      ]
    }
  ];
  const biographyKnownFactMismatch = biographyKnownFactConflicts.find(rule =>
    rule.name.test(biographySection) && rule.incorrectClaims.some(pattern => pattern.test(biographySection))
  );
  const biographyKnownFactsConsistent = !biographyKnownFactMismatch;
  const birthDateMatch = biographySection.match(/\b(?:date of birth|born|dob)\*{0,2}\s*(?:[:–-]|\|)?\s*\*{0,2}\s*\|?\s*(\d{1,2})\s+(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\.?\s+((?:19|20)\d{2})/i);
  const statedAgeMatch = biographySection.match(/\b(\d{1,3})\s+years?\s+old\b|\bage\*{0,2}\s*(?:[:–-]|\|)?\s*\*{0,2}\s*\|?\s*(\d{1,3})\b|\|\s*age\s*\|\s*(\d{1,3})\s*\|/i);
  let biographyBirthDetailsHaveAuthoritativeSource = !birthDateMatch;
  let biographyAgeConsistent = !statedAgeMatch || Boolean(birthDateMatch);
  if (birthDateMatch) {
    const [, birthDay, birthMonthName, birthYear] = birthDateMatch;
    const monthToken = birthMonthName.toLowerCase().replace(/\.$/, "");
    const monthAliases = { jan: "january", feb: "february", mar: "march", apr: "april", jun: "june", jul: "july", aug: "august", sep: "september", sept: "september", oct: "october", nov: "november", dec: "december" };
    const normalizedBirthMonth = monthAliases[monthToken] || monthToken;
    const birthMonth = ["january","february","march","april","may","june","july","august","september","october","november","december"].indexOf(normalizedBirthMonth);
    const birthDateText = Number(birthDay) + " " + normalizedBirthMonth + " " + birthYear;
    const bioEvidenceHosts = new Set([...officialSportsHosts, "espncricinfo.com", "iplt20.com"]);
    biographyBirthDetailsHaveAuthoritativeSource = ledgerLines.some(row => {
      const normalizedRow = row.toLowerCase().replace(/[,]/g, " ");
      const urls = [...row.matchAll(/https?:\/\/[^\s)\]]+/gi)].map(match => {
        try { return new URL(match[0]).hostname.toLowerCase(); } catch { return ""; }
      });
      return normalizedRow.includes(birthDateText) &&
        urls.some(host => [...bioEvidenceHosts].some(official => host === official || host.endsWith("." + official)));
    });
    if (statedAgeMatch && birthMonth >= 0) {
      const statedAge = Number(statedAgeMatch[1] || statedAgeMatch[2] || statedAgeMatch[3]);
      const asOf = new Date(String(draft?.dayKey || "") + "T12:00:00Z");
      if (Number.isFinite(asOf.getTime())) {
        let expectedAge = asOf.getUTCFullYear() - Number(birthYear);
        if (asOf.getUTCMonth() < birthMonth || (asOf.getUTCMonth() === birthMonth && asOf.getUTCDate() < Number(birthDay))) expectedAge -= 1;
        biographyAgeConsistent = expectedAge === statedAge;
      }
    }
  }
  const biographyMilestones = [...biographySection.matchAll(/\b((?:19|20)\d{2})\s*[–—-]\s*(?:(?:Olympic|Commonwealth Games?|World Championships?|Asian Championships?)\s+)?(gold|silver|bronze)\b/gi)];
  const biographyMilestonesHaveOfficialSources = biographyMilestones.every(([, year, medal]) =>
    ledgerLines.some(row => {
      const urls = [...row.matchAll(/https?:\/\/[^\s)\]]+/gi)].map(match => {
        try { return new URL(match[0]).hostname.toLowerCase(); } catch { return ""; }
      });
      return row.includes(year) && row.toLowerCase().includes(medal.toLowerCase()) &&
        urls.some(host => [...officialSportsHosts].some(official => host === official || host.endsWith("." + official)));
    })
  );
  const retailerResearchHasEvidence = !claimsRetailResearch || /https?:\/\/[^\s)\]]*(?:amazon\.in|flipkart\.com)/i.test(report);
  const placeholderData = /\bLaptop\s+[A-E]\b|Brand\/Model|\[Brand\/?Model\]|₹\s*XX|\bModel\s+[A-E]\b/i.test(combined);
  const staleYear = Boolean(yearMatch && Number(yearMatch[1]) < currentYear && !/historical|archival|archive/i.test(draft?.title || ""));
  const numericProductClaims = /₹\s*[\d,]+|\b\d+(?:\.\d+)?\s*(?:GB|TB|Hz)\b|(?:price|cost|free version|free tier|subscription|commission|warranty|battery life|RAM|storage|processor|display|specifications?).{0,60}\b(?:\d+(?:\.\d+)?|free|paid|available|included)\b/i.test(article);
  const productClaimsHaveEvidence = !numericProductClaims || hasSourceUrl;
  const checks = {
    sportsUpdateAndPlayerBiography: /(?:^|\n)#{1,3}\s+Sports Update\b/im.test(article) && /(?:^|\n)#{1,3}\s+Featured Player Biography\b/im.test(article),
    sportsUpdateDate: dateText,
    multiSportCoverage: sportsCovered.length >= 3,
    sportsEvidenceCoverage: sportsEvidenceCovered.length >= 3,
    sportsEvidenceUrlsMatchResearch: sportsEvidenceCovered.length >= 3,
    researchFeedReady,
    researchReadiness,
    sourceCoverage: hasSourceCoverage,
    factCheckRowsHaveClaimStatusAndUrl: factCheckEvidenceRows.length >= 3,
    sourceUrlIntegrity: invalidSourceUrls.length === 0,
    completeArticle: article.trim().length >= 1800,
    usefulLength: Number(draft?.wordCount || 0) >= 850,
    seoTitle: Boolean(draft?.seoTitle && draft.seoTitle.length <= 60),
    metaDescription: Boolean(draft?.metaDescription && draft.metaDescription.length <= 160),
    primaryKeyword: Boolean(draft?.primaryKeyword),
    evidenceLedger: /fact[\s\u2010-\u2015-]*check ledger/i.test(report) && /needs.verification|verified.from.source|opinion/i.test(report),
    verifiedClaimsHaveSourceUrls: claimsHaveUrls,
    retailerResearchHasSourceUrls: retailerResearchHasEvidence,
    sensitiveClaimsHaveAuthoritativeEvidence,
    biographyMilestonesHaveOfficialSources,
    biographyBirthDetailsHaveAuthoritativeSource,
    biographyAgeConsistent,
    biographySportIdentityConsistent,
    biographyKnownFactsConsistent,
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
    ...(!hasSourceCoverage ? ["The fact-check ledger must contain at least three distinct HTTPS article/resource URLs on separate claim rows, and at least three claims must be explicitly VERIFIED_FROM_SOURCE. Homepages, bare URL lists, NEEDS_VERIFICATION and OPINION rows do not satisfy verified source coverage."] : []),
    ...(invalidSourceUrls.length ? ["One or more source URLs look like placeholders or fabricated example links and must be replaced with real source pages."] : []),
    ...(!dateText ? ["The Sports Update must state the exact India publication date."] : []),
    ...(sportsCovered.length < 3 ? ["The Sports Update must cover at least three distinct sports where verified updates are available; do not invent missing updates."] : []),
    ...(sportsEvidenceCovered.length < 3 ? ["At least three distinct sports in the Sports Update must each have a VERIFIED_FROM_SOURCE ledger row whose exact HTTPS URL and sport match an item returned by the current RSS research step."] : []),
    ...(!researchFeedReady ? ["Fewer than three recent items were returned by the configured free sports RSS feeds; current-news research is insufficient for a ready article."] : []),
    ...(!researchReadiness ? ["Add an explicit Research readiness: READY line only when supplied research and the claim ledger support it; otherwise mark NOT READY and do not hand off to Blogger."] : []),
    ...(staleForwardLookingClaim ? ["The article contains an outdated year presented as current or upcoming information."] : []),
    ...(!retailerResearchHasEvidence ? ["Retailer research is claimed without an Amazon India or Flipkart source URL."] : []),
    ...(!sensitiveClaimsHaveAuthoritativeEvidence ? ["A high-risk biographical allegation lacks a matching official-source fact-check ledger entry; remove it or mark it NEEDS_VERIFICATION."] : []),
    ...(!biographyMilestonesHaveOfficialSources ? ["Every medal year and medal type in the featured biography needs its own matching official-source fact-check ledger row."] : []),
    ...(!biographyBirthDetailsHaveAuthoritativeSource ? ["The featured biography birth date needs a matching fact-check ledger row with a trusted sports-body or established cricket-profile source."] : []),
    ...(!biographyAgeConsistent ? ["The stated player age does not match the sourced date of birth as of the India publication date, or age was supplied without a verifiable birth date."] : []),
    ...(biographySportMismatch ? ["The featured athlete is assigned an incorrect sport; verify the athlete identity and sport (expected: " + biographySportMismatch.expectedSport + ")."] : []),
    ...(biographyKnownFactMismatch ? ["The featured biography contains a known incorrect fact for this athlete; correct it and re-check the official source ledger."] : []),
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
