import test from "node:test";
import assert from "node:assert/strict";
import { reviewSpecialistReport } from "../lib/quality-review.js";

test("scores a structured, evidence-aware and actionable report as passed", () => {
  const report = [
    "## Executive summary",
    "Recommended plan for the target audience.",
    "## Audience and assumptions",
    "Assumption: the user has a limited budget.",
    "## Research and evidence",
    "Unverified data must be checked against official sources.",
    "## Recommended strategy",
    "Build the plan in three stages.",
    "## Concrete deliverables",
    "Create a content calendar and draft.",
    "## Measurement and KPIs",
    "Measure clicks and conversions.",
    "## Risks and quality checks",
    "Review platform policy before publishing.",
    "## Next three actions",
    "1. Research. 2. Create. 3. Review."
  ].join("\n");

  const result = reviewSpecialistReport(report);
  assert.equal(result.score, 100);
  assert.equal(result.status, "passed");
  assert.equal(result.missingSections.length, 0);
  assert.equal(result.evidenceAware, true);
  assert.equal(result.actionable, true);
});

test("flags incomplete reports for human review", () => {
  const result = reviewSpecialistReport("A few generic ideas.");
  assert.equal(result.status, "needs_review");
  assert.ok(result.score < 70);
  assert.ok(result.missingSections.length > 0);
  assert.ok(result.warnings.length > 0);
});

test("marks reports with missing sections for review even when their numeric score is 80", () => {
  const report = [
    "## Executive summary",
    "Recommended plan.",
    "## Audience and assumptions",
    "Assumption: target audience is not yet verified.",
    "## Research and evidence",
    "Needs live verification against current sources.",
    "## Recommended strategy",
    "Create a focused plan.",
    "## Concrete deliverables",
    "Build a checklist.",
    "## Measurement and KPIs",
    "Measure clicks and conversions."
  ].join("\n");
  const result = reviewSpecialistReport(report);
  assert.equal(result.score, 80);
  assert.equal(result.status, "needs_review");
  assert.ok(result.missingSections.includes("Risks and quality checks"));
  assert.ok(result.missingSections.includes("Next three actions"));
});

test("flags guaranteed income claims", () => {
  const result = reviewSpecialistReport(
    "## Executive summary\nGuaranteed income from this strategy."
  );
  assert.equal(result.status, "needs_review");
  assert.ok(result.warnings.some(item => item.includes("guarantee")));
});

test("handles empty reports safely", () => {
  const result = reviewSpecialistReport("");
  assert.equal(result.score, 0);
  assert.equal(result.status, "needs_review");
  assert.ok(result.warnings.includes("The specialist returned an empty report."));
});

test("does not award section points for headings mentioned only in prose", () => {
  const report = "This report includes an executive summary, audience and assumptions, research and evidence, recommended strategy, concrete deliverables, measurement and KPIs, risks and quality checks, and next three actions in one generic paragraph.";
  const result = reviewSpecialistReport(report);
  assert.equal(result.passedSections.length, 0);
  assert.equal(result.score, 10);
  assert.equal(result.status, "needs_review");
});


test("recognizes the numbered report headings required by specialist prompts", () => {
  const report = [
    "1. Executive summary",
    "2. Audience, goal and assumptions",
    "3. Research and evidence",
    "4. Recommended strategy",
    "5. Concrete deliverables",
    "6. Measurement plan",
    "7. Risks, policy checks and quality-control steps",
    "8. Next three actions",
    "Assumption: current metrics have not been supplied.",
    "Next action: verify the official platform requirements."
  ].join("\n");

  const result = reviewSpecialistReport(report);
  assert.equal(result.score, 100);
  assert.equal(result.status, "passed");
  assert.equal(result.missingSections.length, 0);
});


test("flags numerical business and performance claims for human verification", () => {
  const report = [
    "## Executive summary",
    "Proposed campaign targets 10k subscribers and $200/month.",
    "## Audience and assumptions",
    "Assumption: these are planning estimates, not verified results.",
    "## Research and evidence",
    "All current figures require verification.",
    "## Recommended strategy",
    "Build and test the campaign.",
    "## Concrete deliverables",
    "Create a content plan.",
    "## Measurement and KPIs",
    "Measure results after launch.",
    "## Risks and quality checks",
    "Review all figures before relying on them.",
    "## Next three actions",
    "1. Verify. 2. Build. 3. Review."
  ].join("\n");
  const result = reviewSpecialistReport(report);
  assert.equal(result.status, "needs_review");
  assert.ok(result.score <= 70);
  assert.ok(result.warnings.some(item => item.includes("numerical")));
});


test("recognizes bold numbered specialist report headings", () => {
  const report = [
    "**1. Executive Summary**",
    "A clear summary for the intended audience.",
    "**2. Audience, Goal, and Assumptions**",
    "Assumption: no analytics were supplied.",
    "**3. Research and Evidence**",
    "Current facts require verification.",
    "**4. Recommended Strategy**",
    "Build and test the proposed plan.",
    "**5. Concrete Deliverables**",
    "Create a draft and checklist.",
    "**6. Measurement Plan**",
    "Measure outcomes after launch.",
    "**7. Risks, Policy Checks, and Quality-Control Steps**",
    "Review all risks before publishing.",
    "**8. Next Three Actions**",
    "1. Research. 2. Draft. 3. Review."
  ].join("\n");

  const result = reviewSpecialistReport(report);
  assert.equal(result.passedSections.length, 8);
  assert.equal(result.missingSections.length, 0);
  assert.equal(result.score, 100);
  assert.equal(result.status, "passed");
});
