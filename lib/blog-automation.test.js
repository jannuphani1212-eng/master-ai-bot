import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyBlogTask, buildBlogRevisionTask, extractBlogArticle, reviewBlogArticle } from "./blog-automation.js";

test("daily blog assignment chooses a topic autonomously and includes duplicate memory", () => {
  const task = buildDailyBlogTask({ dayKey: "2026-11-25", priorTopics: ["How to choose a kids learning app"] });
  assert.match(task, /select and produce today's Sports King 18 article/i);
  assert.match(task, /How to choose a kids learning app/);
  assert.match(task, /AUTOMATIC SUBTASKS/);
  assert.match(task, /player biography\/profile/i);
  assert.match(task, /Sports Update/i);
  assert.match(task, /Featured Player Biography/i);
  assert.match(task, /97\/100 \(9\.7\/10\)/i);
  assert.match(task, /owner only approves or rejects/i);
  assert.match(task, /Do not invent search volume/);
  assert.match(task, /Never impersonate a human/i);
  assert.match(task, /without explicit approval for that exact article/i);
  assert.match(task, /NATURAL HUMAN-EDITOR VOICE/);
  assert.match(task, /fake first-person experiences/i);
  assert.match(task, /COMPACT DAILY OUTPUT CONTRACT/);
  assert.match(task, /at least three distinct exact source URLs/);
  assert.match(task, /Actual income: NOT CONNECTED \/ NOT MEASURED/);
});

test("article parser extracts title, SEO metadata and full article body", () => {
  const report = [
    "SEO title: Simple Reading Games for Children",
    "Primary keyword: reading games for children",
    "Meta description: Practical reading games families can try at home.",
    "## Complete article draft",
    "This is a complete article body with practical details. ".repeat(50),
    "## Fact-check ledger",
    "No live sources supplied; needs verification."
  ].join("\n");
  const draft = extractBlogArticle(report, "2026-11-25");
  assert.equal(draft.title, "Simple Reading Games for Children");
  assert.equal(draft.primaryKeyword, "reading games for children");
  assert.equal(draft.dayKey, "2026-11-25");
  assert.ok(draft.wordCount > 350);
  assert.ok(draft.article.includes("practical details"));
  assert.equal(draft.extractionStatus, "complete");
});

test("parser accepts bold numbered production headings and keeps article subheadings", () => {
  const body = "### 1. Why this matters\n\n" + "Useful advice for a student. ".repeat(100);
  const report = [
    "**1. Executive Summary**",
    "Create a helpful post titled **“A Practical Study Plan for College Students”**.",
    "**5. Concrete Deliverables**",
    "**Full Article Draft**",
    body,
    "**Internal-Link Targets**",
    "1. Related article idea",
    "**Meta Tags**",
    "- **Meta Description**: A practical study plan for busy college students."
  ].join("\n\n");
  const draft = extractBlogArticle(report, "2026-11-25");
  assert.equal(draft.title, "A Practical Study Plan for College Students");
  assert.ok(draft.article.includes("### 1. Why this matters"));
  assert.ok(draft.wordCount > 350);
  assert.equal(draft.extractionStatus, "complete");
});

test("parser accepts Full Article Draft and extracts title from a Meta Tags block", () => {
  const body = "## A useful article\n\n" + "A practical paragraph for readers. ".repeat(100);
  const report = [
    "**Executive Summary**",
    "The article is ready for review.",
    "**Full Article Draft**",
    body,
    "**Meta Tags**",
    "- **Title**: Simple Reading Games for Children",
    "- **Meta Description**: Practical reading games families can try at home.",
    "**Fact-check ledger**",
    "Claims need verification."
  ].join("\n\n");
  const draft = extractBlogArticle(report, "2026-11-25");
  assert.equal(draft.title, "Simple Reading Games for Children");
  assert.ok(draft.article.length >= 1800);
  assert.ok(draft.metaDescription.startsWith("Practical reading games"));
});

test("parser marks missing or too-short article extraction as incomplete", () => {
  const draft = extractBlogArticle("**1. Executive Summary**\nNo article body.", "2026-11-25");
  assert.equal(draft.extractionStatus, "incomplete");
  assert.equal(draft.article, "");
});

test("parser recovers sports update and biography when wrapper heading is omitted", () => {
  const report = [
    "SEO title: India Sports Roundup",
    "Primary keyword: India sports news",
    "Meta description: Verified updates and a featured athlete profile.",
    "## Sports Update",
    ("A sourced sports update with context for Indian readers. ").repeat(180),
    "## Featured Player Biography",
    ("A detailed player biography with verified career context. ").repeat(180),
    "## Fact-check ledger",
    "Source status: NEEDS_VERIFICATION until each URL is checked."
  ].join("\n");
  const draft = extractBlogArticle(report, "2026-11-27");
  assert.equal(draft.extractionStatus, "complete");
  assert.ok(draft.article.startsWith("## Sports Update"));
  assert.match(draft.article, /Featured Player Biography/);
  assert.ok(draft.wordCount >= 350);
  assert.ok(!draft.article.includes("Fact-check ledger"));
});

test("quality review flags incomplete article and missing evidence safeguards", () => {
  const review = reviewBlogArticle({ title: "Short", primaryKeyword: "", metaDescription: "", article: "too short", wordCount: 2, report: "No article.", dayKey: "2026-11-25" });
  assert.equal(review.status, "needs_review");
  assert.ok(review.failures.includes("completeArticle"));
  assert.ok(review.failures.includes("evidenceLedger"));
});

test("quality review blocks placeholder product comparisons and stale titles", () => {
  const report = [
    "SEO package",
    "Fact-check ledger",
    "We scoured Amazon India and Flipkart. Laptop A costs ₹35,000 and lasts 7 hours.",
    "VERIFIED_FROM_SOURCE"
  ].join("\n");
  const review = reviewBlogArticle({
    title: "Top Budget Laptops for College Students in 2024",
    primaryKeyword: "budget laptops",
    metaDescription: "Compare budget laptops for students.",
    article: ("Laptop A has 8 GB RAM and costs ₹35,000. ").repeat(60),
    wordCount: 420,
    report,
    dayKey: "2026-11-25"
  });
  assert.equal(review.status, "needs_review");
  assert.ok(review.blockers.some(item => /placeholder product/i.test(item)));
  assert.ok(review.blockers.some(item => /outdated year/i.test(item)));
  assert.ok(review.blockers.some(item => /retailer research/i.test(item)));
  assert.ok(review.score <= 69);
});

test("a verified claim without a source URL cannot receive a passing score", () => {
  const review = reviewBlogArticle({
    title: "A Practical Student Study Guide",
    primaryKeyword: "student study guide",
    metaDescription: "A practical guide to planning study time.",
    article: ("Build a weekly plan and review your progress each day. ").repeat(45),
    wordCount: 405,
    report: "Fact-check ledger\nVERIFIED_FROM_SOURCE: This claim is verified.\nSEO package\nCMS handoff\nOriginality self-check; not proof of uniqueness.\nIncome: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-25"
  });
  assert.equal(review.status, "needs_review");
  assert.ok(review.failures.includes("verifiedClaimsHaveSourceUrls"));
  assert.ok(review.score <= 69);
});


test("bold-colon metadata strips residual Markdown emphasis markers", () => {
  const report = [
    "**Article title:** A Practical Weekly Study Timetable for College Students",
    "**Primary keyword:** weekly study timetable for college students",
    "**Meta description:** Build a realistic weekly study timetable with flexible study blocks.",
    "## Full Article Draft",
    ("A useful article paragraph with practical advice for college students. ").repeat(60),
    "## Fact-check ledger",
    "Unsupported claims are NEEDS_VERIFICATION."
  ].join("\n");
  const draft = extractBlogArticle(report, "2026-11-25");
  assert.equal(draft.title, "A Practical Weekly Study Timetable for College Students");
  assert.equal(draft.primaryKeyword, "weekly study timetable for college students");
  assert.equal(draft.metaDescription, "Build a realistic weekly study timetable with flexible study blocks.");
});

test("generic study-time advice is not mistaken for product specifications", () => {
  const report = ["SEO package", "Fact-check ledger", "Needs verification: study-hour recommendations."].join("\n");
  const review = reviewBlogArticle({
    title: "A Practical Weekly Study Timetable",
    primaryKeyword: "weekly study timetable",
    metaDescription: "Build a realistic weekly study timetable.",
    article: ("Plan 15–20 hours of study and use 25-minute focus sessions. ").repeat(45),
    wordCount: 405,
    report,
    dayKey: "2026-11-25"
  });
  assert.equal(review.checks.numericProductClaimsHaveEvidence, true);
});

test("claims labelled Verified fact require a specific source URL", () => {
  const report = [
    "SEO package",
    "Fact-check ledger",
    "Google Calendar is free. Status: Verified fact.",
    "CMS handoff",
    "Income: NOT CONNECTED / NOT MEASURED",
    "Originality self-check is not a plagiarism scan or proof of uniqueness.",
    "Natural voice and reader-value review"
  ].join("\n");
  const review = reviewBlogArticle({
    title: "A Practical Weekly Study Timetable",
    primaryKeyword: "weekly study timetable",
    metaDescription: "Build a realistic weekly study timetable.",
    article: ("A practical study plan should fit around lectures and rest. ").repeat(50),
    wordCount: 420,
    report,
    dayKey: "2026-11-25"
  });
  assert.equal(review.checks.verifiedClaimsHaveSourceUrls, false);
  assert.ok(review.failures.includes("verifiedClaimsHaveSourceUrls"));
});

test("natural voice review accepts typographic hyphens", () => {
  const report = [
    "SEO package",
    "Fact-check ledger",
    "Needs verification: any app feature claim.",
    "CMS handoff",
    "Income: NOT CONNECTED / NOT MEASURED",
    "Originality self-check is not a plagiarism scan or proof of uniqueness.",
    "## Natural voice and reader‑value review"
  ].join("\n");
  const review = reviewBlogArticle({
    title: "A Practical Weekly Study Timetable",
    primaryKeyword: "weekly study timetable",
    metaDescription: "Build a realistic weekly study timetable.",
    article: ("A practical study plan should fit around lectures and rest. ").repeat(50),
    wordCount: 420,
    report,
    dayKey: "2026-11-25"
  });
  assert.equal(review.checks.naturalVoiceReview, true);
  assert.equal(review.checks.originalityCaveat, true);
});


test("system appends an explicit originality caveat when the model omits it", async () => {
  const { ensureBlogOriginalityCaveat } = await import("./blog-automation.js");
  const report = "## Complete article draft\nA complete article.";
  const safe = ensureBlogOriginalityCaveat(report);
  assert.match(safe, /not a plagiarism scan or proof of uniqueness/i);
  assert.match(safe, /## Originality caveat/);
  assert.equal(ensureBlogOriginalityCaveat(safe), safe);
});


test("sports article quality gate requires both the sports update and player biography", () => {
  const base = {
    title: "A Complete Player Profile",
    seoTitle: "A Complete Player Profile",
    primaryKeyword: "player profile",
    metaDescription: "A verified sports update and player biography.",
    article: "## Sports Update\nIndia date: 26 November 2026. Cricket, football and tennis updates are included with their verified source context.\n\n## Featured Player Biography\n" + ("A useful sports article paragraph with verified context. ").repeat(110),
    wordCount: 990,
    report: "Fact-check ledger\nNEEDS_VERIFICATION\nhttps://www.icc-cricket.com/\nhttps://www.fifa.com/\nhttps://olympics.com/\nSEO package\nCMS handoff\nOriginality caveat: not proof of uniqueness.\nNatural voice and reader-value review\nIncome: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-26"
  };
  const missing = reviewBlogArticle({ ...base, article: ("A useful sports article paragraph with verified context. ").repeat(110) });
  assert.equal(missing.status, "needs_review");
  assert.ok(missing.failures.includes("sportsUpdateAndPlayerBiography"));
  const complete = reviewBlogArticle(base);
  console.log("BLOG_GATE_DEBUG", JSON.stringify({checks: complete.checks, blockers: complete.blockers, failures: complete.failures, score: complete.score}));
  assert.equal(complete.status, "passed", JSON.stringify({ failures: complete.failures, blockers: complete.blockers, checks: complete.checks }));
  assert.ok(complete.score >= 97);
  assert.equal(complete.targetScore, 97);
});


test("extractor keeps the short SEO title separate from the article headline", () => {
  const report = [
    "Article title: The Complete Story of a Champion Athlete and Their Journey",
    "SEO title: Champion Athlete Biography",
    "Primary keyword: champion athlete biography",
    "Meta description: A verified profile of a champion athlete.",
    "## Complete article draft",
    "## Sports Update",
    "India date: 26 November 2026. Cricket, football and tennis.",
    "## Featured Player Biography",
    ("A detailed biography paragraph. ").repeat(80),
    "## Fact-check ledger",
    "NEEDS_VERIFICATION"
  ].join("\n");
  const draft = extractBlogArticle(report, "2026-11-26");
  assert.equal(draft.title, "The Complete Story of a Champion Athlete and Their Journey");
  assert.equal(draft.seoTitle, "Champion Athlete Biography");
});

test("editorial gate rejects stale future claims and placeholder source URLs", () => {
  const review = reviewBlogArticle({
    title: "A Champion Athlete Profile",
    seoTitle: "Champion Athlete Profile",
    primaryKeyword: "champion athlete",
    metaDescription: "A detailed champion athlete profile.",
    article: "## Sports Update\nIndia date: 26 November 2026. Cricket, football and tennis. Currently preparing for the 2024 Olympics.\n\n## Featured Player Biography\n" + ("A detailed sports biography paragraph. ").repeat(110),
    wordCount: 990,
    report: "Fact-check ledger\nVERIFIED_FROM_SOURCE\nhttps://www.icc-cricket.com/\nhttps://www.fifa.com/\nhttps://example.com/placeholder/1234567\nSEO package\nCMS handoff\nOriginality caveat: not proof of uniqueness.\nNatural voice and reader-value review\nIncome: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-26"
  });
  assert.equal(review.checks.noStaleForwardLookingClaims, false);
  assert.equal(review.checks.sourceUrlIntegrity, false);
  assert.ok(review.blockers.some(item => /outdated year/i.test(item)));
  assert.ok(review.blockers.some(item => /placeholder/i.test(item)));
});


test("failed editorial attempts create complete revision instructions for the next queue retry", () => {
  const task = "Create today's Sports King 18 article.";
  assert.equal(buildBlogRevisionTask({ task, attempt: 1 }), task);
  const revised = buildBlogRevisionTask({
    task,
    attempt: 2,
    previousError: "Blog editorial gate failed at 69/100. Failed checks: sourceCoverage, sportsUpdateDate. Blockers: add three real sources."
  });
  assert.match(revised, /AUTOMATIC EDITORIAL REVISION/);
  assert.match(revised, /retry attempt 2 of 4/);
  assert.match(revised, /sourceCoverage, sportsUpdateDate/);
  assert.match(revised, /three real sources/);
  assert.match(revised, /Return the entire corrected report/);
});

test("revision task sanitizes and bounds previous failure feedback", () => {
  const revised = buildBlogRevisionTask({ task: "Write a sports article", attempt: 4, previousError: "X".repeat(5000) });
  assert.ok(revised.length < 6000);
  assert.match(revised, /retry attempt 4 of 4/);
});


test("revision retries require explicit SEO fields, evidence ledger and honest Blogger handoff", () => {
  const revised = buildBlogRevisionTask({
    task: "Create the Sports King 18 daily article.",
    attempt: 2,
    previousError: "Failed checks: seoTitle, evidenceLedger, naturalVoiceReview, incomeHonesty."
  });
  assert.match(revised, /SEO title:.*maximum 60 characters/i);
  assert.match(revised, /Primary keyword:/);
  assert.match(revised, /Meta description:.*maximum 160 characters/i);
  assert.match(revised, /Fact-check ledger/);
  assert.match(revised, /exact source URLs/);
  assert.match(revised, /Natural voice and reader-value review/);
  assert.match(revised, /Actual income: NOT CONNECTED/);
  assert.match(revised, /private-draft-only/);
  assert.match(revised, /do not invent results/i);
});


test("parser accepts descriptive complete-article headings and metadata headings", () => {
  const report = [
    "Article title: A Dated Sports Roundup and Player Profile",
    "SEO title: Sports roundup and player profile",
    "Primary keyword: India sports update",
    "Meta description: A sourced sports roundup and featured player profile.",
    "## Complete article draft (850 words)",
    "## Sports Update — November 27, 2026",
    ("Verified sports context for readers. ").repeat(180),
    "## Featured Player Biography — Featured athlete",
    ("Career details and milestones with source context. ").repeat(180),
    "## Fact-check ledger (source list)",
    "Source status: NEEDS_VERIFICATION."
  ].join("\n");
  const draft = extractBlogArticle(report, "2026-11-27");
  assert.equal(draft.extractionStatus, "complete");
  assert.match(draft.article, /Featured Player Biography/);
  assert.ok(!draft.article.includes("Fact-check ledger"));
});

test("parser recovers bold sports section labels without treating the report as article text", () => {
  const report = [
    "SEO title: Sports Update and Featured Athlete",
    "Primary keyword: sports update",
    "Meta description: Sports updates and an athlete profile.",
    "**Sports Update: November 27, 2026**",
    ("A sports update with context. ").repeat(180),
    "**Featured Player Biography — Featured athlete**",
    ("A player biography with career context. ").repeat(180),
    "**Fact-check ledger (sources)**",
    "Source status: NEEDS_VERIFICATION."
  ].join("\n");
  const draft = extractBlogArticle(report, "2026-11-27");
  assert.equal(draft.extractionStatus, "complete");
  assert.match(draft.article, /Featured Player Biography/);
  assert.ok(!draft.article.includes("Fact-check ledger"));
});


test("editorial gate blocks unsupported high-risk athlete allegations", () => {
  const review = reviewBlogArticle({
    title: "Sakshi Malik: Career and Olympic Legacy",
    seoTitle: "Sakshi Malik Career and Olympic Legacy",
    primaryKeyword: "Sakshi Malik",
    metaDescription: "A sourced profile of Indian wrestler Sakshi Malik and her Olympic career.",
    article: "## Sports Update\nIndia date: 27 November 2026. Cricket, football and tennis updates.\n\n## Featured Player Biography\nSakshi Malik won an Olympic medal. A 2019 suspension for a positive test for a banned substance was later cleared. " + ("Her career and achievements are discussed with historical context. ").repeat(60),
    wordCount: 900,
    report: "Fact-check ledger\nSakshi Malik's Olympic medal | https://olympics.com/en/athletes/sakshi-malik | VERIFIED_FROM_SOURCE\nSEO package\nNatural voice and reader-value review\nCMS handoff\nActual income: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-27"
  });
  assert.equal(review.checks.sensitiveClaimsHaveAuthoritativeEvidence, false);
  assert.ok(review.blockers.some(item => /high-risk biographical allegation/i.test(item)));
});

test("editorial gate permits a sensitive claim only with a matching official-source ledger row", () => {
  const review = reviewBlogArticle({
    title: "A Wrestler's Career",
    seoTitle: "Wrestler Career Profile",
    primaryKeyword: "wrestler profile",
    metaDescription: "A sourced profile of a wrestler and career milestones.",
    article: "## Sports Update\nIndia date: 27 November 2026. Cricket, football and tennis updates.\n\n## Featured Player Biography\nA suspension was reported in an anti-doping case. " + ("The profile explains the verified timeline and context. ").repeat(60),
    wordCount: 900,
    report: "Fact-check ledger\nAnti-doping suspension case | https://www.wada-ama.org/en/news | VERIFIED_FROM_SOURCE\nhttps://www.bbc.co.uk/sport/1\nhttps://www.bbc.co.uk/sport/2\nSEO package\nNatural voice and reader-value review\nCMS handoff\nActual income: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-27"
  });
  assert.equal(review.checks.sensitiveClaimsHaveAuthoritativeEvidence, true);
});


test("editorial gate blocks biography medal years missing official ledger rows", () => {
  const review = reviewBlogArticle({
    title: "Wrestler Career Profile",
    seoTitle: "Wrestler Career Profile",
    primaryKeyword: "wrestler profile",
    metaDescription: "A sourced profile of a wrestler and career milestones.",
    article: "## Sports Update\nIndia date: 27 November 2026. Cricket, football and tennis updates.\n\n## Featured Player Biography\n2014 – Gold, Commonwealth Games. 2016 – Bronze, Olympic Games. " + ("The profile covers career context and achievements. ").repeat(60),
    wordCount: 900,
    report: "Fact-check ledger\n2016 Olympic bronze medal | https://olympics.com/en/athletes/example | VERIFIED_FROM_SOURCE\nSEO package\nNatural voice and reader-value review\nCMS handoff\nActual income: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-27"
  });
  assert.equal(review.checks.biographyMilestonesHaveOfficialSources, false);
});

test("editorial gate accepts biography medal milestones with matching official ledger rows", () => {
  const review = reviewBlogArticle({
    title: "Wrestler Career Profile",
    seoTitle: "Wrestler Career Profile",
    primaryKeyword: "wrestler profile",
    metaDescription: "A sourced profile of a wrestler and career milestones.",
    article: "## Sports Update\nIndia date: 27 November 2026. Cricket, football and tennis updates.\n\n## Featured Player Biography\n2014 – Gold, Commonwealth Games. 2016 – Bronze, Olympic Games. " + ("The profile covers career context and achievements. ").repeat(60),
    wordCount: 900,
    report: "Fact-check ledger\n2014 Commonwealth Games gold | https://thecgf.com/results/athletes/example | VERIFIED_FROM_SOURCE\n2016 Olympic bronze medal | https://olympics.com/en/athletes/example | VERIFIED_FROM_SOURCE\nSEO package\nNatural voice and reader-value review\nCMS handoff\nActual income: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-27"
  });
  assert.equal(review.checks.biographyMilestonesHaveOfficialSources, true);
});
test("parser reads bold metadata labels whose values are on the next line", () => {
  const body = "## Sports Update\n" + "A verified sports update with useful context. ".repeat(120) +
    "\n## Featured Player Biography\n" + "A detailed biography with sourced career milestones. ".repeat(120);
  const report = [
    "**Article title:**",
    "India’s Sports Pulse – November 27",
    "",
    "**SEO title:**",
    "India Sports Update: Cricket, Football and Tennis",
    "",
    "**Primary keyword:**",
    "India sports news",
    "",
    "**Meta description:**",
    "Verified Indian and global sports updates with a detailed athlete biography.",
    "",
    "## Complete article draft",
    body,
    "## Fact-check ledger",
    "Claim — https://www.bbc.co.uk/sport/example — NEEDS_VERIFICATION"
  ].join("\n");
  const draft = extractBlogArticle(report, "2026-11-27");
  assert.equal(draft.title, "India’s Sports Pulse – November 27");
  assert.equal(draft.seoTitle, "India Sports Update: Cricket, Football and Tennis");
  assert.equal(draft.primaryKeyword, "India sports news");
  assert.equal(draft.metaDescription, "Verified Indian and global sports updates with a detailed athlete biography.");
});

test("quality review does not substitute the article title for a missing SEO title", () => {
  const review = reviewBlogArticle({
    title: "A reasonable article title",
    seoTitle: "",
    primaryKeyword: "sports news",
    metaDescription: "A short description.",
    article: "A".repeat(2200),
    wordCount: 900,
    report: "Fact-check ledger\nNEEDS_VERIFICATION\nSEO package\nNatural voice and reader-value review\nCMS handoff\nNOT CONNECTED",
    dayKey: "2026-11-27"
  });
  assert.equal(review.checks.seoTitle, false);
});

test("parser normalizes nested section markers and recognizes snooker and Formula 1 coverage", () => {
  const body = [
    "### ## Sports Update",
    "Cricket, snooker and Formula 1 updates are summarized with verified context. ".repeat(55),
    "#### Featured Player Biography",
    "A detailed biography with verified career context and milestones. ".repeat(70)
  ].join("\n");
  const report = [
    "Article title: India Sports Pulse November 27",
    "SEO title: India Sports Pulse: Cricket, Snooker and F1",
    "Primary keyword: India sports news",
    "Meta description: Verified sports updates and an athlete biography for Indian readers.",
    "## Complete article draft",
    body,
    "## Fact-check ledger",
    "Claim — https://www.bbc.co.uk/sport/snooker/example — NEEDS_VERIFICATION"
  ].join("\n");
  const draft = extractBlogArticle(report, "2026-11-27");
  assert.match(draft.article, /^## Sports Update/m);
  assert.match(draft.article, /^## Featured Player Biography/m);
  const review = reviewBlogArticle(draft);
  assert.equal(review.checks.sportsUpdateAndPlayerBiography, true);
  assert.equal(review.checks.multiSportCoverage, true);
});

test("parser trims overlong SEO titles to the 60-character limit", () => {
  const report = [
    "Article title: A detailed sports article title",
    "SEO title: India’s Sports Pulse – November 27, 2026: Cricket, Football, Snooker and Formula 1 Highlights",
    "Primary keyword: India sports news",
    "Meta description: Verified sports news for Indian readers.",
    "## Complete article draft",
    "## Sports Update\n" + "Cricket, football and snooker. ".repeat(80),
    "## Featured Player Biography\n" + "A detailed biography. ".repeat(80),
    "## Fact-check ledger"
  ].join("\n");
  const draft = extractBlogArticle(report, "2026-11-27");
  assert.ok(draft.seoTitle.length <= 60);
  assert.ok(draft.seoTitle.length > 40);
});

test("editorial gate rejects an age that conflicts with a sourced birth date", () => {
  const review = reviewBlogArticle({
    title: "Shreyas Iyer Profile",
    seoTitle: "Shreyas Iyer Profile",
    primaryKeyword: "Shreyas Iyer",
    metaDescription: "A sourced profile of Indian cricketer Shreyas Iyer.",
    article: "## Sports Update\nIndia date: 27 November 2026. Cricket, football and tennis updates.\n\n## Featured Player Biography\n*Date of birth:* 6 December 1994 (age 32). " + ("A detailed career profile with useful context. ").repeat(100),
    wordCount: 900,
    report: "Fact-check ledger\nShreyas Iyer date of birth 6 December 1994 | https://www.espncricinfo.com/cricketers/shreyas-iyer-576664 | VERIFIED_FROM_SOURCE\nhttps://www.bbc.co.uk/sport/cricket\nhttps://www.icc-cricket.com/\nSEO package\nOriginality caveat: not proof of uniqueness.\nNatural voice and reader-value review\nCMS handoff\nActual income: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-27"
  });
  assert.equal(review.checks.biographyBirthDetailsHaveAuthoritativeSource, true);
  assert.equal(review.checks.biographyAgeConsistent, false);
  assert.ok(review.blockers.some(item => /stated player age does not match/i.test(item)));
});

test("editorial gate requires a trusted source for a biography birth date", () => {
  const review = reviewBlogArticle({
    title: "Athlete Profile",
    seoTitle: "Athlete Profile",
    primaryKeyword: "athlete profile",
    metaDescription: "A sourced athlete profile.",
    article: "## Sports Update\nIndia date: 27 November 2026. Cricket, football and tennis updates.\n\n## Featured Player Biography\nDate of birth: 6 December 1994. " + ("A detailed career profile with useful context. ").repeat(100),
    wordCount: 900,
    report: "Fact-check ledger\nBirth date | https://en.wikipedia.org/wiki/Example | VERIFIED_FROM_SOURCE\nhttps://www.bbc.co.uk/sport/cricket\nhttps://www.icc-cricket.com/\nSEO package\nOriginality caveat: not proof of uniqueness.\nNatural voice and reader-value review\nCMS handoff\nActual income: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-27"
  });
  assert.equal(review.checks.biographyBirthDetailsHaveAuthoritativeSource, false);
  assert.ok(review.blockers.some(item => /birth date needs a matching fact-check ledger row/i.test(item)));
});


test("editorial gate detects table-form birth dates and rejects unsupported biography DOB", () => {
  const review = reviewBlogArticle({
    title: "Shreyas Iyer Profile",
    seoTitle: "Shreyas Iyer Profile",
    primaryKeyword: "Shreyas Iyer",
    metaDescription: "A sourced profile of Indian cricketer Shreyas Iyer.",
    article: "## Sports Update\nIndia date: 27 November 2026. Cricket, football and tennis updates.\n\n## Featured Player Biography\n| Full name | Shreyas Iyer |\n| Date of birth | 3 January 1994 |\n| Age | 32 |\n" + ("A detailed career profile with useful context. ").repeat(100),
    wordCount: 900,
    report: "Fact-check ledger\nShreyas Iyer date of birth 6 December 1994 | https://www.bcci.tv/players/cef1971a-977f-4ede-aa47-ea51659d659b/shreyas-iyer\nhttps://www.espncricinfo.com/\nhttps://www.icc-cricket.com/\nSEO package\nOriginality caveat: not proof of uniqueness.\nNatural voice and reader-value review\nCMS handoff\nActual income: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-27"
  });
  assert.equal(review.checks.biographyBirthDetailsHaveAuthoritativeSource, false);
  assert.equal(review.checks.biographyAgeConsistent, true);
  assert.ok(review.blockers.some(item => /birth date needs a matching fact-check ledger row/i.test(item)));
});

test("editorial gate normalizes abbreviated birth months and catches table age errors", () => {
  const review = reviewBlogArticle({
    title: "Shreyas Iyer Profile",
    seoTitle: "Shreyas Iyer Profile",
    primaryKeyword: "Shreyas Iyer",
    metaDescription: "A sourced profile of Indian cricketer Shreyas Iyer.",
    article: "## Sports Update\nIndia date: 27 November 2026. Cricket, football and tennis updates.\n\n## Featured Player Biography\n| Date of birth | 6 Dec 1994 |\n| Age | 32 |\n" + ("A detailed career profile with useful context. ").repeat(100),
    wordCount: 900,
    report: "Fact-check ledger\nShreyas Iyer date of birth 6 December 1994 | https://www.bcci.tv/players/cef1971a-977f-4ede-aa47-ea51659d659b/shreyas-iyer\nhttps://www.espncricinfo.com/\nhttps://www.icc-cricket.com/\nSEO package\nOriginality caveat: not proof of uniqueness.\nNatural voice and reader-value review\nCMS handoff\nActual income: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-27"
  });
  assert.equal(review.checks.biographyBirthDetailsHaveAuthoritativeSource, true);
  assert.equal(review.checks.biographyAgeConsistent, false);
  assert.ok(review.blockers.some(item => /stated player age does not match/i.test(item)));
});


test("editorial gate rejects a known Indian athlete assigned to the wrong sport", () => {
  const review = reviewBlogArticle({
    title: "India Sports Profile", seoTitle: "India Sports Profile",
    primaryKeyword: "Indian sports profile", metaDescription: "A sourced profile of an Indian athlete.",
    article: "## Sports Update\nIndia date: 28 November 2026. Cricket, football and tennis updates.\n\n## Featured Player Biography\nSakshi Malik is an Indian boxer who won an Olympic bronze medal. " + ("A detailed career profile with useful context. ").repeat(100),
    wordCount: 900,
    report: "Fact-check ledger\nhttps://www.bbc.co.uk/sport\nhttps://www.icc-cricket.com/\nhttps://www.olympics.com/\nSEO package\nOriginality caveat: not proof of uniqueness.\nNatural voice and reader-value review\nCMS handoff\nActual income: NOT CONNECTED / NOT MEASURED",
    dayKey: "2026-11-28"
  });
  assert.equal(review.checks.biographySportIdentityConsistent, false);
  assert.ok(review.blockers.some(item => /incorrect sport/i.test(item)));
});


test("editorial gate rejects known incorrect P V Sindhu biography facts", () => {
  const review = reviewBlogArticle({
    title: "P V Sindhu Profile", seoTitle: "P V Sindhu Profile",
    primaryKeyword: "P V Sindhu badminton", metaDescription: "A sourced profile of Indian badminton champion P V Sindhu.",
    article: [
      "## Sports Update",
      "India date: 28 November 2026. Cricket, football and tennis updates.",
      "",
      "## Featured Player Biography",
      "P V Sindhu was born on 5 February 1995. She won 2013 Commonwealth Games gold and defeated Carolina Diaz in the Rio Olympic final.",
      ("A detailed career profile with useful context. ").repeat(100)
    ].join("\n"),
    wordCount: 900,
    report: [
      "Fact-check ledger",
      "https://www.olympics.com/en/athletes/p-v-sindhu",
      "https://www.commonwealthsport.com/news/3615061/pv-sindhu-from-commonwealth-youth-games-to-global-superstar",
      "https://www.pib.gov.in/PressReleasePage.aspx?PRID=1741308",
      "SEO package",
      "Originality caveat: not proof of uniqueness.",
      "Natural voice and reader-value review",
      "CMS handoff",
      "Actual income: NOT CONNECTED / NOT MEASURED"
    ].join("\n"),
    dayKey: "2026-11-28"
  });
  assert.equal(review.checks.biographyKnownFactsConsistent, false);
  assert.ok(review.blockers.some(item => /known incorrect fact/i.test(item)));
});


test("editorial gate catches alternate incorrect P V Sindhu dates and Olympic medal claims", () => {
  const article = [
    "## Sports Update",
    "India date: 28 November 2026. Cricket, football and tennis updates.",
    "",
    "## Featured Player Biography",
    "| Date of birth | 5 March 1995 |",
    "| Major achievements | 2013 – Gold at the Commonwealth Games; 2015 – Gold at the Asian Championships; 2024 – Olympic Bronze |",
    "Sindhu won a 2024 Olympic bronze medal in Paris.",
    ("A detailed career profile with useful context. ").repeat(100)
  ].join("\n");
  const review = reviewBlogArticle({
    title: "P V Sindhu Profile",
    seoTitle: "P V Sindhu Profile",
    primaryKeyword: "P V Sindhu badminton",
    metaDescription: "A sourced profile of Indian badminton champion P V Sindhu.",
    article,
    wordCount: 900,
    report: [
      "Fact-check ledger",
      "2016 Olympic silver | https://olympics.com/en/athletes/p-v-sindhu | VERIFIED_FROM_SOURCE",
      "https://www.bwfbadminton.com/",
      "https://www.thecgf.com/",
      "SEO package",
      "Originality caveat: not proof of uniqueness.",
      "Natural voice and reader-value review",
      "CMS handoff",
      "Actual income: NOT CONNECTED / NOT MEASURED"
    ].join("\n"),
    dayKey: "2026-11-28"
  });
  assert.equal(review.checks.biographyKnownFactsConsistent, false);
  assert.equal(review.checks.biographyMilestonesHaveOfficialSources, false);
  assert.equal(review.checks.biographyBirthDetailsHaveAuthoritativeSource, false);
  assert.ok(review.blockers.some(item => /known incorrect fact/i.test(item)));
});
