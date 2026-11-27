const REQUIRED_ARTIFACTS = {
  blogging: {
    label: "Sports King 18 private Blogger draft",
    check: assets => assets.bloggerDraftCreated === true || assets.bloggerDraftAlreadyCreated === true,
    status: assets => assets.blogDraftVerified === true ? "internal_draft_only" : "not_saved"
  },
  youtube: {
    label: "Playable MP4 video saved and verified",
    check: assets => assets.finalVideoVerified === true &&
      typeof assets.finalVideoStoragePath === "string" &&
      assets.finalVideoStoragePath.trim().length > 0,
    status: assets => assets.youtubeRhymeProjectId ? "production_plan_only" : "not_saved"
  },
  affiliate: {
    label: "Verified product offer, tracked affiliate link and campaign asset",
    check: assets => Number(assets.verifiedProductCount || 0) > 0 &&
      Number(assets.trackedAffiliateLinkCount || 0) > 0 &&
      assets.campaignAssetSaved === true,
    status: assets => assets.affiliateCampaignId ? "research_brief_only" : "not_saved"
  },
  "app-development": {
    label: "Application source files with successful build and tests",
    check: assets => Array.isArray(assets.sourceFiles) &&
      assets.sourceFiles.length > 0 &&
      assets.buildStatus === "passed" &&
      assets.testStatus === "passed",
    status: assets => Array.isArray(assets.sourceFiles) && assets.sourceFiles.length
      ? (assets.staticValidationStatus === "passed" ? "source_generated_static_checks_passed" : "source_generated_needs_fixes")
      : "plan_only"
  },
  seo: {
    label: "Saved keyword research, content optimizations and verified Search Console data",
    check: assets => assets.keywordResearchSaved === true &&
      assets.contentOptimizationSaved === true &&
      assets.searchConsoleDataVerified === true,
    status: assets => assets.searchConsoleDataVerified === true
      ? "measurement_available"
      : "recommendations_only"
  }
};

/**
 * Separates report quality from actual specialist delivery.
 * A well-structured AI report is not proof that the requested work artifact exists.
 */
export function evaluateSpecialistArtifact(agentId, savedAssets = {}) {
  const contract = REQUIRED_ARTIFACTS[agentId];
  const assets = savedAssets && typeof savedAssets === "object" ? savedAssets : {};
  if (!contract) {
    return {
      agentId,
      complete: false,
      status: "unsupported_specialist",
      requiredArtifact: null,
      blockers: ["No deliverable acceptance contract is registered for this specialist."]
    };
  }

  const complete = contract.check(assets);
  return {
    agentId,
    complete,
    status: complete ? "deliverable_verified" : contract.status(assets),
    requiredArtifact: contract.label,
    blockers: complete ? [] : ["Required deliverable has not been produced and verified: " + contract.label + "."]
  };
}

export const SPECIALIST_ARTIFACT_IDS = Object.freeze(Object.keys(REQUIRED_ARTIFACTS));
