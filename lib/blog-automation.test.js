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
