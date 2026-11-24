import test from "node:test";
import assert from "node:assert/strict";
import { reviewSpecialistReport } from "../lib/quality-review.js";

const completeReport = [
  "## Executive summary",
  "This report recommends a focused launch sequence based on the stated business objective and constraints.",
  "## Audience, goal and assumptions",
  "The intended audience is clearly defined, and assumptions about budget, access, and experience are explicitly stated.",
  "## Research and evidence",
  "Available evidence is separated from assumptions, and all current prices and platform terms need live verification.",
  "## Recommended strategy",
  "Start with the highest-value channel, validate audience response, and expand only after reviewing measured results.",
  "## Concrete deliverables",
  "Prepare a product shortlist, comparison template, draft content, disclosure text, and a simple tracking sheet.",
  "## Measurement plan",
  "Measure impressions, clicks, conversions, and time spent each week; establish a baseline before choosing targets.",
  "## Risks, policy checks and quality-control steps",
  "Review platform policies, disclosure rules, product claims, copyright, and factual accuracy before publishing.",
  "## Next three actions",
  "First validate eligibility, then prepare the draft assets, and finally review performance after the initial test."
].join("\n\n");

test("passes a report whose required sections contain substantive content", () => {
  const review = reviewSpecialistReport(completeReport);
  assert.equal(review.status, "passed");
  assert.equal(review.score, 100);
  assert.deepEqual(review.thinSections, []);
});

test("does not award a passing score to headings with empty or token content", () => {
  const headingsOnly = [
    "## Executive summary",
    "## Audience, goal and assumptions",
    "## Research and evidence",
    "## Recommended strategy",
    "## Concrete deliverables",
    "## Measurement plan",
    "## Risks, policy checks and quality-control steps",
    "## Next three actions",
  ].join("\n");
  const review = reviewSpecialistReport(headingsOnly);
  assert.equal(review.status, "needs_review");
  assert.ok(review.score < 100);
  assert.equal(review.thinSections.length, 8);
});

test("reports thin sections separately from missing headings", () => {
  const review = reviewSpecialistReport(completeReport.replace(
    "This report recommends a focused launch sequence based on the stated business objective and constraints.",
    ""
  ));
  assert.ok(review.thinSections.includes("Executive summary"));
  assert.deepEqual(review.missingSections, []);
  assert.equal(review.status, "needs_review");
});


test("classifies verified facts, assumptions, estimates and recommendations separately", () => {
  const report = completeReport + [
    "",
    "Verified facts: The owner supplied the Android-only constraint.",
    "Assumptions: The first test niche is fashion and watches.",
    "Estimates: No earnings estimate is available; any scenario requires owner inputs.",
    "Recommendations: Start with one free publishing channel and measure baseline clicks."
  ].join("\n");
  const review = reviewSpecialistReport(report);
  assert.deepEqual(review.missingEvidenceLabels, []);
  assert.deepEqual(review.evidenceClassification, {
    verifiedFacts: true,
    assumptions: true,
    estimates: true,
    recommendations: true
  });
  assert.notEqual(review.factualAccuracyScore, 100);
});

test("flags missing evidence labels without misrepresenting factual accuracy as verified", () => {
  const review = reviewSpecialistReport(completeReport);
  assert.ok(review.missingEvidenceLabels.includes("verifiedFacts"));
  assert.equal(review.evidenceReview, "needs_verification");
  assert.equal(review.factualAccuracyScore, null);
});

test("recognizes Research & Evidence headings in bold numbered specialist reports", () => {
  const report = completeReport.replace("## Research and evidence", "**3. Research & Evidence**");
  const review = reviewSpecialistReport(report);
  assert.equal(review.passedSections.includes("Research and evidence"), true);
  assert.equal(review.missingSections.includes("Research and evidence"), false);
  assert.equal(review.status, "passed");
});
