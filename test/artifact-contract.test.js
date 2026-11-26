import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSpecialistArtifact, SPECIALIST_ARTIFACT_IDS } from "../lib/artifact-contract.js";

test("registers exactly the five existing specialist IDs", () => {
  assert.deepEqual(SPECIALIST_ARTIFACT_IDS, ["blogging", "youtube", "affiliate", "app-development", "seo"]);
});

test("does not mistake a saved internal blog draft for Blogger delivery", () => {
  const result = evaluateSpecialistArtifact("blogging", {
    blogDraftId: "draft-1",
    blogDraftVerified: true,
    cmsTransfer: "quality_gate_blocked"
  });
  assert.equal(result.complete, false);
  assert.equal(result.status, "internal_draft_only");
  assert.match(result.blockers[0], /private Blogger draft/);
});

test("accepts a confirmed private Blogger draft but not live publishing", () => {
  const result = evaluateSpecialistArtifact("blogging", {
    blogDraftVerified: true,
    bloggerDraftCreated: true
  });
  assert.equal(result.complete, true);
  assert.equal(result.status, "deliverable_verified");
});

test("does not mistake a rhyme plan for a playable video", () => {
  const result = evaluateSpecialistArtifact("youtube", { youtubeRhymeProjectId: "project-1" });
  assert.equal(result.complete, false);
  assert.equal(result.status, "production_plan_only");
});

test("requires a verified MP4 storage path for YouTube completion", () => {
  const result = evaluateSpecialistArtifact("youtube", {
    finalVideoVerified: true,
    finalVideoStoragePath: "owner/job/final.mp4"
  });
  assert.equal(result.complete, true);
});

test("does not mistake affiliate research for a tracked campaign", () => {
  const result = evaluateSpecialistArtifact("affiliate", { affiliateCampaignId: "campaign-1" });
  assert.equal(result.complete, false);
  assert.equal(result.status, "research_brief_only");
});

test("requires source, build and tests for app-development completion", () => {
  const result = evaluateSpecialistArtifact("app-development", {
    sourceFiles: ["src/index.js"],
    buildStatus: "passed",
    testStatus: "failed"
  });
  assert.equal(result.complete, false);
  assert.equal(result.status, "source_generated_not_validated");
});

test("requires saved SEO work and verified measurement", () => {
  const result = evaluateSpecialistArtifact("seo", {
    keywordResearchSaved: true,
    contentOptimizationSaved: true,
    searchConsoleDataVerified: false
  });
  assert.equal(result.complete, false);
  assert.equal(result.status, "recommendations_only");
});

test("unknown specialists fail closed", () => {
  const result = evaluateSpecialistArtifact("master", {});
  assert.equal(result.complete, false);
  assert.equal(result.status, "unsupported_specialist");
});
