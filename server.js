import express from "express";
import { timingSafeEqual } from "node:crypto";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { fallbackAgentSelection, requestsAllSpecialists } from "./lib/routing.js";
import { runProviderFallback } from "./lib/provider-fallback.js";
import { extractCompletionText } from "./lib/completion-text.js";
import { mergeMissingReportSections } from "./lib/report-repair.js";
import { getRetrySeconds as getProviderRetrySeconds } from "./lib/retry-after.js";
import { getMasterInstructions, getSpecialistInstructions } from "./lib/specialist-prompts.js";
import { createSelfHealingMonitor, inferFailureType } from "./lib/self-healing.js";
import { buildRepairProposals } from "./lib/repair-proposals.js";
import { buildAgentReadinessChecks, HEALTH_CHECK_INTERVAL_MS } from "./lib/agent-health-checks.js";
import { reviewSpecialistReport } from "./lib/quality-review.js";
import { evaluateSpecialistArtifact } from "./lib/artifact-contract.js";
import { createSupabaseApprovalHandlers } from "./lib/supabase-approvals.js";
import { createOwnerAuthMiddleware } from "./lib/owner-auth.js";
import { createYoutubeIntegrationHandlers, getYoutubeAgentContext } from "./lib/youtube-integration.js";
import { createAgnesVideoHandlers } from "./lib/agnes-video.js";
import { createAgentHistoryHandlers } from "./lib/supabase-task-history.js";
import { createYoutubeRhymeMemory } from "./lib/youtube-rhyme-memory.js";
import { createYoutubeVideoJobStore, createYoutubeVideoJobHandlers } from "./lib/youtube-video-jobs.js";
import { renderNurseryRhymeVideo } from "./lib/youtube-video-renderer.js";
import { buildYoutubeTaskContext } from "./lib/youtube-task-context.js";
import { parseSynthesisReuseRequest, validateSavedSpecialistReports } from "./lib/synthesis-reuse.js";
import { createAgentPortfolioHandlers } from "./lib/agent-portfolio.js";
import { createAppProjectHandlers } from "./lib/app-projects.js";
import { createAuditMiddleware } from "./lib/audit-log.js";
import { createPersistentQueue } from "./lib/persistent-queue.js";
import { createBlogCmsHandlers } from "./lib/blog-cms-integration.js";
import { createSearchConsoleHandlers } from "./lib/search-console-integration.js";
import { createAffiliateHandlers } from "./lib/affiliate-integration.js";
import { createInstagramIntegrationHandlers } from "./lib/instagram-integration.js";
import { buildDailyBlogTask, buildBlogRevisionTask, ensureBlogOriginalityCaveat, extractBlogArticle, reviewBlogArticle } from "./lib/blog-automation.js";
import { fetchSportsResearch, formatSportsResearchContext } from "./lib/sports-research.js";
import { buildDailyReport } from "./lib/daily-report.js";

const app = express();
const PORT = process.env.PORT || 3000;
const selfHealingMonitor = createSelfHealingMonitor();

// Render runs behind a trusted reverse proxy. This allows req.ip to identify
// the originating client for the lightweight API request limit below.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Baseline browser security headers. HSTS is emitted only for HTTPS requests.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (req.secure || req.get?.("x-forwarded-proto") === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

const apiRequestWindows = new Map();
const API_WINDOW_MS = 60 * 1000;
const API_MAX_REQUESTS = 15;

function limitApiRequests(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  let bucket = apiRequestWindows.get(key);

  if (!bucket || now - bucket.startedAt >= API_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
  }

  bucket.count += 1;
  apiRequestWindows.set(key, bucket);

  if (apiRequestWindows.size > 1000) {
    for (const [ip, item] of apiRequestWindows) {
      if (now - item.startedAt >= API_WINDOW_MS) {
        apiRequestWindows.delete(ip);
      }
    }
  }

  if (bucket.count > API_MAX_REQUESTS) {
    const retryAfter = Math.max(
      1,
      Math.ceil((bucket.startedAt + API_WINDOW_MS - now) / 1000)
    );
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      success: false,
      error: "Too many AI requests. Please wait before trying again.",
      retryAfterSeconds: retryAfter
    });
  }

  next();
}

app.use(express.json({ limit: "1mb" }));
const requireOwner = createOwnerAuthMiddleware();
const agentHistoryHandlers = createAgentHistoryHandlers();
const youtubeRhymeMemory = createYoutubeRhymeMemory();
const youtubeVideoJobStore = createYoutubeVideoJobStore();
const youtubeVideoJobHandlers = createYoutubeVideoJobHandlers(youtubeVideoJobStore);
const agentPortfolioHandlers = createAgentPortfolioHandlers();
const appProjectHandlers = createAppProjectHandlers();
const persistentQueue = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? createPersistentQueue() : null;
const blogCmsHandlers = createBlogCmsHandlers();
const searchConsoleHandlers = createSearchConsoleHandlers();
const affiliateHandlers = createAffiliateHandlers();
const instagramHandlers = createInstagramIntegrationHandlers();
const auditOwnerRequests = createAuditMiddleware();
async function persistTaskHistory(ownerId, agentId, task, data, failure) {
  if (!ownerId) return;
  try {
    const specialistReportIds = [];
    if (agentId === "master" && Array.isArray(data?.specialistResults) && !data?.reusedReports) {
      for (const item of data.specialistResults) {
        const savedId = await agentHistoryHandlers.record(ownerId, {
          agentId: item.agentId,
          task,
          status: item.success ? "completed" : item.needsAttention ? "needs_attention" : "failed",
          provider: item.provider,
          qualityScore: item.qualityReview?.score,
          report: item.result,
          error: item.error,
          metadata: { qualityReview: item.qualityReview || null, artifactAcceptance: item.artifactAcceptance || null }
        });
        if (typeof savedId === "string") specialistReportIds.push(savedId);
      }
    }
    if (agentId === "master" && data) {
      data.history = {
        specialistReportIds: data.reusedReports ? data.reusedReportIds : specialistReportIds,
        reusedExistingReports: Boolean(data.reusedReports)
      };
    }
    const masterHistoryId = await agentHistoryHandlers.record(ownerId, {
      agentId,
      task,
      status: failure ? "failed" : data?.success === false ? "needs_attention" : "completed",
      provider: data?.provider,
      qualityScore: data?.qualityReview?.score,
      report: data?.result,
      error: failure?.message || data?.error,
      metadata: {
        partialSuccess: Boolean(data?.partialSuccess),
        totalSpecialists: data?.totalSpecialists ?? null,
        reusedExistingReports: Boolean(data?.reusedReports),
        reusedReportIds: data?.reusedReportIds || [],
        specialistReportIds: data?.reusedReports ? data.reusedReportIds : specialistReportIds,
        qualityReview: data?.qualityReview || null,
        artifactAcceptance: data?.artifactAcceptance || null
      }
    });
    if (data?.history && typeof masterHistoryId === "string") data.history.masterHistoryId = masterHistoryId;
  } catch (historyError) {
    console.error("Persistent agent history could not be saved:", historyError.message);
    if (data) data.history = { verified: false, error: historyError.message };
  }
}
// Apply IP limits before authentication so invalid-token floods are throttled too.
// The app currently runs as one Render instance; this in-memory limit is per instance.
app.use(["/api/task", "/api/brain", "/api/repair-proposals", "/api/agent-history", "/api/agent-portfolio", "/api/app-projects", "/api/agnes-video", "/api/approvals", "/api/blog", "/api/instagram", "/api/search-console", "/api/affiliate", "/go"], limitApiRequests);
app.use(["/api/task", "/api/brain", "/api/repair-proposals", "/api/agent-history", "/api/agent-portfolio", "/api/app-projects", "/api/notifications", "/api/queue"], requireOwner);
app.use(["/api/task", "/api/brain", "/api/repair-proposals", "/api/agent-history", "/api/agent-portfolio", "/api/app-projects", "/api/notifications", "/api/queue"], auditOwnerRequests);
app.get("/api/agent-history", agentHistoryHandlers.list);
app.get("/api/agent-portfolio", agentPortfolioHandlers.get);
app.get("/api/app-projects", appProjectHandlers.listHandler);
app.post("/api/app-projects", appProjectHandlers.createHandler);
app.get("/api/app-projects/:id", appProjectHandlers.getHandler);
app.put("/api/app-projects/:id/files", appProjectHandlers.saveFilesHandler);
app.post("/api/app-projects/:id/validate", appProjectHandlers.validateHandler);

app.get("/api/queue", async (req, res) => {
  if (!persistentQueue) return res.status(503).json({ success: false, error: "Persistent queue is not configured." });
  try {
    const jobs = await persistentQueue.status(req.ownerUser.id);
    return res.json({ success: true, source: "supabase", jobs });
  } catch (error) {
    return res.status(503).json({ success: false, error: error.message });
  }
});

app.get("/api/notifications", async (req, res) => {
  if (!persistentQueue) return res.status(503).json({ success: false, error: "Notifications are not configured." });
  try {
    return res.json({ success: true, notifications: await persistentQueue.notifications(req.ownerUser.id) });
  } catch (error) {
    return res.status(503).json({ success: false, error: error.message });
  }
});

app.patch("/api/notifications/:id/read", async (req, res) => {
  if (!persistentQueue) return res.status(503).json({ success: false, error: "Notifications are not configured." });
  try {
    const updated = await persistentQueue.markNotificationRead(req.ownerUser.id, req.params.id);
    return res.json({ success: updated });
  } catch (error) {
    return res.status(503).json({ success: false, error: error.message });
  }
});

function secureSecretMatches(provided, expected) {
  if (!provided || !expected) return false;
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

function indiaDayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

let dailyWorkerRunning = false;

const DAILY_ASSIGNMENTS = {
  affiliate: "Daily production: research one useful India-focused fashion or watch product opportunity. Deliver a cautious product shortlist, buyer problem, comparison criteria, original short-video or blog campaign asset, disclosure text, and tracking plan. Do not invent live prices, stock, commission rates, affiliate eligibility, links, or earnings. Mark every unverified item clearly. Draft only; no posting.",
  youtube: "Daily production for Global Rhymes 4U: continue the saved rhyme project from its exact next unfinished scene if one exists; otherwise create one original English children's rhyme with a complete script, scene-by-scene visual prompts, consistent character and background bible, title, description, and child-safety/copyright checks. Create production-ready text and prompts only. Do not claim a video clip was generated or upload/publish anything.",
  blogging: "Daily production for Sports King 18: create one original, mobile-first sports article with a dated verified sports update AND a detailed featured player biography with verified bio data. Rotate across major sports and maintain a deduplicated player-profile backlog. Research with source URLs, fact-check scores/records/career details, deliver attractive SEO-ready writing and save as a private Blogger draft only after the 9.7/10 editorial gate. Never publish live or invent facts.",
  "app-development": "Daily production: build one small Android-first HTML5 app or game prototype that supports the owner's YouTube, blogging, affiliate, or SEO operations. Rotate between useful apps and 2D/3D game prototypes; avoid duplicating existing projects. Produce complete source files in the required FILE code-block format, a README, acceptance criteria, privacy/security notes, and zero-cost technology choices. Do not deploy, spend, use paid APIs, or claim a real build/test was executed.",
  seo: "Daily cross-workstream SEO: review today's completed affiliate, YouTube, blogging, and app-development outputs in the attached queue context. Produce keyword/topic mapping, search intent, title/meta improvements, internal-link and content repurposing recommendations, technical/measurement checklist, and prioritized fixes for all four workstreams. Do not invent search volumes, rankings, traffic, or performance metrics."
};

const BLOGGING_RUNTIME_INSTRUCTIONS = [
  "ROLE: Sports King 18 senior sports editor. India-focused, English-first, mobile-first.",
  "Follow the user task's exact article and output contract; produce the full article, never a strategy-only report.",
  "Use only supplied research and source facts you can identify confidently. Cite exact URLs in the fact-check ledger. Do not invent scores, statistics, quotes, results, dates, records, or source URLs. Mark uncertain claims NEEDS_VERIFICATION and omit unsupported allegations.",
  "Every medal-year and medal-type claim needs its own matching official sports-authority ledger row. Unsupported sensitive allegations must be removed from the narrative.",
  "Use exact standalone H2 headings ## Sports Update and ## Featured Player Biography. Include separate machine-readable lines for Article title, SEO title (60 characters max), Primary keyword, and Meta description (160 characters max).",
  "Write at least 850 useful article words where evidence supports the detail; do not pad or fabricate. Use a natural human editorial voice and explain why verified news matters.",
  "Prepare a private internal/Blogger draft only. Never publish, schedule, or perform external actions without the owner's explicit approval."
].join("\n");

const APP_DEVELOPMENT_RUNTIME_INSTRUCTIONS = [
  "ROLE: Senior Android-first app and game engineer for a zero-budget owner.",
  "Create a complete small HTML5 prototype, not a plan-only report. Choose a useful app or a 2D/3D game prototype that can run in a modern mobile browser.",
  "Use only plain HTML, CSS and JavaScript; no npm packages, paid APIs, external CDNs, remote fonts, analytics, secrets, install scripts or build scripts. A YouTube helper may make one read-only request to https://www.youtube.com/oembed for public video metadata; no other external hosts or network calls. Use localStorage only when needed.",
  "Include touch-friendly controls, responsive layout, accessible labels, clear empty/error states, and a concise README with how to open and use the prototype.",
  "Start with these exact metadata lines: PROJECT NAME: ..., PROJECT TYPE: app or game_2d or game_3d, PROJECT DESCRIPTION: ... . Then provide each complete source file using exactly: FILE: relative/path.ext on its own line, followed by a fenced code block with the entire file contents. Required: index.html and at least one .js file; include styles.css and README.md where useful.",
  "Keep all paths relative and safe. Do not include secrets, dynamic code execution, XMLHttpRequest, WebSocket, or any external dependency. The only permitted network call is a single read-only fetch to the YouTube oEmbed endpoint described above; no other fetch calls or external URLs. Do not claim that code was built or executed; the server only performs static syntax/structure checks.",
  "Use these exact report headings with concise substantive content: Executive summary; User problem and audience; MVP scope and features; Verified facts; Assumptions; Estimates; Recommendations; Source files; Acceptance criteria; Security and privacy; Static validation and limitations; Next steps. Keep all prose outside code blocks under 250 words total. Then output every complete FILE code block; source files are the primary deliverable. Never return a plan-only report or omit FILE blocks. Clearly state that build and runtime tests were not run."
].join("\n");

async function processDailyQueue(ownerId, dayKey) {
  if (!persistentQueue) throw new Error("Persistent queue is not configured.");
  const workerId = "daily-worker-" + process.pid + "-" + Date.now();
  const summary = [];
  for (let count = 0; count < 30; count += 1) {
    const job = await persistentQueue.claim(workerId);
    if (!job) break;
    const leaseHeartbeat = setInterval(() => {
      void persistentQueue.renew(job.id, workerId).then(renewed => {
        if (!renewed) console.error("Daily queue worker lease was lost for job:", job.id);
      }).catch(error => console.error("Daily queue lease renewal failed:", error.message));
    }, 60 * 1000);
    if (typeof leaseHeartbeat.unref === "function") leaseHeartbeat.unref();
    try {
      let task = job.task;
      if (job.agent_id === "youtube") {
        try {
          const saved = await youtubeRhymeMemory.context(ownerId);
          if (saved) task += "\n\nRESUME CONTEXT FROM SAVED RHYME MEMORY:\n" + saved;
        } catch (error) {
          console.warn("Daily YouTube resume context unavailable:", error.message);
        }
        try {
          const channel = await getYoutubeAgentContext({ ownerId });
          if (channel) task += "\n\nCONNECTED CHANNEL CONTEXT:\n" + channel;
        } catch (error) {
          console.log("Daily YouTube channel context unavailable:", error.message);
        }
      }
      let searchConsoleContext = null;
      if (job.agent_id === "seo") {
        const earlier = await persistentQueue.dailyResults(ownerId, dayKey);
        const context = earlier.filter(item => item.agent_id !== "seo").map(item =>
          "AGENT " + item.agent_id + " STATUS: " + item.status + "\n" +
          (item.result?.report
            ? "OUTPUT:\n" + String(item.result.report).slice(0, 5000)
            : "OUTPUT NOT AVAILABLE. " + String(item.last_error || "The workstream has not completed yet.").slice(0, 500))
        ).join("\n\n");
        if (context) task += "\n\nTODAY'S COMPLETED WORKSTREAM OUTPUTS:\n" + context;
        try {
          searchConsoleContext = await searchConsoleHandlers.dailyContext(ownerId);
          if (searchConsoleContext?.verified) {
            task += "\n\nVERIFIED GOOGLE SEARCH CONSOLE DATA (READ ONLY):\n" +
              "Property: " + searchConsoleContext.siteUrl + "\n" +
              "Finalized data range: " + searchConsoleContext.startDate + " to " + searchConsoleContext.endDate + "\n" +
              "These are the top rows returned by the Search Console API, not complete site totals. " +
              "Use the measured clicks, impressions, CTR and average position only as observations; do not infer missing rows.\n" +
              JSON.stringify(searchConsoleContext.rows || []);
          } else {
            task += "\n\nSEARCH CONSOLE DATA STATUS: NOT VERIFIED. " +
              String(searchConsoleContext?.reason || "No connected Search Console property is available.") +
              " Do not invent clicks, impressions, CTR, rankings or positions. Save research and on-page recommendations separately from measured performance.";
          }
        } catch (error) {
          searchConsoleContext = { verified: false, reason: error.message };
          task += "\n\nSEARCH CONSOLE DATA STATUS: NOT VERIFIED. " + String(error.message).slice(0, 300) +
            " Do not invent clicks, impressions, CTR, rankings or positions.";
          console.warn("Daily SEO Search Console context unavailable:", error.message);
        }
      }
      if (job.agent_id === "app-development") {
        try {
          const existingProjects = await appProjectHandlers.list(ownerId);
          const portfolio = existingProjects.slice(0, 12).map(project =>
            "- " + project.name + " (" + project.project_type + ", " + project.status + ")"
          ).join("\n");
          const hasGameProject = existingProjects.some(project => /^game_/.test(String(project.project_type || "")));
          const portfolioGuidance = !hasGameProject
            ? "The saved portfolio has apps but no games. Prioritize a small game_2d or game_3d prototype next; do not create another app."
            : "Rotate between app, game_2d and game_3d project types, and avoid duplicate concepts.";
          task += "\n\nEXISTING APP/GAME PROJECTS — avoid duplicates:\n" +
            (portfolio || "No existing App Development projects are saved yet.") + "\n" + portfolioGuidance;
        } catch (error) {
          console.warn("App project portfolio context unavailable:", error.message);
        }
      }
      // Keep the sports article output budget compatible with the free Groq TPM window.
      // 2,100 requested tokens maps to about 2,800 max_completion_tokens in callGroq.
      if (job.agent_id === "blogging") {
        task = buildBlogRevisionTask({ task, attempt: job.attempts, previousError: job.last_error });
        const sportsResearch = await fetchSportsResearch();
        task += "\n\n" + formatSportsResearchContext(sportsResearch);
      }
      const runtimeInstructions = job.agent_id === "blogging" ? BLOGGING_RUNTIME_INSTRUCTIONS
        : job.agent_id === "app-development" ? APP_DEVELOPMENT_RUNTIME_INSTRUCTIONS
          : agentInstructions[job.agent_id];
      const generated = await generateAI(task, runtimeInstructions, job.agent_id === "blogging" ? 2100 : 2600);
      if (job.agent_id === "blogging") {
        await persistentQueue.checkpoint(job.id, workerId, {
          checkpoint: "ai_response_received",
          provider: generated.provider,
          report: String(generated.result || "").slice(0, 18000)
        });
      }
      if (job.agent_id === "blogging") generated.result = ensureBlogOriginalityCaveat(generated.result);
      const savedAssets = {};
      let blogReview = null;
      if (job.agent_id === "blogging") {
        const article = extractBlogArticle(generated.result, dayKey);
        if (article.extractionStatus !== "complete") {
          throw new Error("Blog article extraction failed: full article body was not found or was too short. The draft was not saved; the queue will retry.");
        }
        blogReview = reviewBlogArticle({ ...article, dayKey });
        const savedDraft = await persistentQueue.saveBlogDraft(ownerId, job.id, {
          topic: article.title,
          language: "English",
          audience: "India-focused readers",
          targetKeyword: article.primaryKeyword,
          provider: generated.provider,
          report: generated.result,
          content: {
            title: article.title,
            seoTitle: article.seoTitle,
            article: article.article,
            metaDescription: article.metaDescription,
            primaryKeyword: article.primaryKeyword,
            wordCount: article.wordCount,
            editorialReview: blogReview,
            fullReport: generated.result,
            source: "master_ai_daily_queue",
            dayKey,
            cmsPublication: "private_draft_auto_delivery_live_publish_owner_approval_required",
            actualIncome: "not_connected_or_not_measured"
          }
        });
        if (!savedDraft.verified) throw new Error("Blog draft storage did not return a verified read-back result.");
        savedAssets.blogDraftId = savedDraft.id;
        savedAssets.blogDraftInserted = savedDraft.inserted;
        savedAssets.blogDraftVerified = true;
        savedAssets.articleWordCount = article.wordCount;
        savedAssets.editorialScore = blogReview.score;
        savedAssets.editorialStatus = blogReview.status;
        savedAssets.cmsTransfer = "quality_gate_blocked";
        if (blogReview.status !== "passed" || Number(blogReview.score) < 97) {
          const details = [
            "Blog editorial gate failed at " + blogReview.score + "/100.",
            "Failed checks: " + (blogReview.failures || []).join(", "),
            "Blockers: " + (blogReview.blockers || []).join(" ")
          ].join(" ");
          throw new Error(details.slice(0, 1800));
        }
        if (blogReview.status === "passed" && Number(blogReview.score) >= 97) {
          try {
            const cmsResult = await blogCmsHandlers.createDailyCmsDraft({ ownerId, draftId: savedDraft.id });
            savedAssets.cmsTransfer = cmsResult.status || "not_connected";
            savedAssets.bloggerDraftCreated = Boolean(cmsResult.success && cmsResult.status === "created");
            savedAssets.bloggerDraftAlreadyCreated = Boolean(cmsResult.alreadyCreated || cmsResult.status === "already_created");
            savedAssets.bloggerSiteName = cmsResult.siteName || null;
            savedAssets.bloggerDraftUrl = cmsResult.publication?.remote_url || cmsResult.remoteDraft?.url || null;
            if (!cmsResult.success && cmsResult.message) savedAssets.bloggerDraftMessage = cmsResult.message;
            if (!savedAssets.bloggerDraftCreated && !savedAssets.bloggerDraftAlreadyCreated) {
              throw new Error("Blogger private-draft delivery did not complete: " + String(cmsResult.message || cmsResult.status || "unknown CMS result").slice(0, 500));
            }
          } catch (cmsError) {
            // Keep the verified internal article and report CMS delivery separately.
            // A transient Blogger error must not discard the completed editorial work.
            savedAssets.cmsTransfer = "failed";
            savedAssets.bloggerDraftError = String(cmsError.message || cmsError).slice(0, 500);
            console.error("Automatic Blogger draft delivery failed:", cmsError.message);
          }
          if (savedAssets.cmsTransfer === "failed") {
            throw new Error("Blogger private-draft delivery failed and must be retried: " + String(savedAssets.bloggerDraftError || "unknown CMS error"));
          }
        }
      }
      if (job.agent_id === "affiliate") {
        const titleMatch = String(generated.result).match(/^(?:\\*\\*)?(?:Campaign title|Working title|Title)(?:\\*\\*)?\\s*[:：-]\\s*(.+)$/im) ||
          String(generated.result).match(/^#{1,3}\\s+(.+)$/m);
        const campaignTitle = String(titleMatch?.[1] || ("Daily affiliate research brief " + dayKey)).trim().slice(0, 180);
        const savedCampaign = await persistentQueue.saveAffiliateCampaign(ownerId, job.id, {
          productName: campaignTitle,
          category: "Research brief",
          provider: generated.provider,
          report: generated.result,
          content: {
            title: campaignTitle,
            report: generated.result,
            source: "master_ai_daily_queue",
            dayKey,
            productClaimsVerified: false
          }
        });
        savedAssets.affiliateCampaignId = savedCampaign.id;
        savedAssets.affiliateCampaignInserted = savedCampaign.inserted;
      }
      if (job.agent_id === "youtube") {
        try {
          const savedProject = await youtubeRhymeMemory.persistReport(ownerId, null, generated.result);
          if (savedProject?.id) savedAssets.youtubeRhymeProjectId = savedProject.id;
        } catch (memoryError) {
          console.error("Daily YouTube rhyme state could not be saved:", memoryError.message);
        }
      }
      if (job.agent_id === "app-development") {
        const savedProject = await appProjectHandlers.createFromGeneratedReport(ownerId, job.id, generated.result);
        savedAssets.appProjectId = savedProject.projectId;
        savedAssets.appProjectName = savedProject.projectName;
        savedAssets.appProjectType = savedProject.projectType;
        savedAssets.appProjectStatus = savedProject.status;
        savedAssets.sourceFiles = savedProject.files;
        savedAssets.staticValidationStatus = savedProject.validation.status;
        savedAssets.staticValidation = savedProject.validation;
        savedAssets.buildStatus = "not_run";
        savedAssets.testStatus = "not_run";
      }
      const review = job.agent_id === "blogging"
        ? { ...blogReview, status: blogReview?.status || "needs_review", score: blogReview?.score ?? 0,
            warnings: (blogReview?.failures || []).map(item => "Blog editorial check failed: " + item),
            disclaimer: blogReview?.disclaimer || "Editorial quality requires owner review." }
        : reviewSpecialistReport(generated.result, job.agent_id);
      if (job.agent_id === "seo") {
        savedAssets.keywordResearchSaved = review.status === "passed";
        savedAssets.contentOptimizationSaved = review.status === "passed";
        savedAssets.searchConsoleDataVerified = Boolean(searchConsoleContext?.verified);
        savedAssets.searchConsoleProperty = searchConsoleContext?.siteUrl || null;
        savedAssets.searchConsoleRows = Array.isArray(searchConsoleContext?.rows) ? searchConsoleContext.rows.length : 0;
        savedAssets.searchConsoleDateRange = searchConsoleContext?.verified
          ? { startDate: searchConsoleContext.startDate, endDate: searchConsoleContext.endDate }
          : null;
      }
      const artifactAcceptance = evaluateSpecialistArtifact(job.agent_id, savedAssets);
      const qualityPassed = review.status === "passed";
      const result = {
        success: qualityPassed && artifactAcceptance.complete,
        needsAttention: !qualityPassed || !artifactAcceptance.complete,
        agent: job.agent_id,
        provider: generated.provider,
        qualityReview: review,
        artifactAcceptance,
        report: generated.result,
        savedAssets,
        executionMode: "draft_only",
        requiresHumanApproval: true
      };
      await persistTaskHistory(ownerId, job.agent_id, task, {
        success: result.success,
        provider: result.provider,
        qualityReview: result.qualityReview,
        artifactAcceptance: result.artifactAcceptance,
        result: result.report
      });
      await persistentQueue.complete(job.id, workerId, result);
      await persistentQueue.notify(ownerId, {
        agentId: job.agent_id,
        type: result.success ? "agent_completed" : "agent_needs_attention",
        title: job.agent_id + (result.success ? " completed daily work" : " needs review"),
        body: result.success
          ? "Required specialist deliverable was saved and verified. Review it before any external action."
          : (!qualityPassed
              ? "The report did not pass its quality gate. Review the flagged report before using it."
              : "The report passed structural review, but the actual deliverable is not complete: " + artifactAcceptance.blockers.join(" ")),
        metadata: { jobId: job.id, dayKey, provider: generated.provider, qualityScore: review.score ?? null, ...savedAssets }
      }).catch(notificationError => console.error("Could not save completion notification:", notificationError.message));
      summary.push({ agentId: job.agent_id, status: result.success ? "completed" : "needs_attention", provider: generated.provider, savedAssets });
      if (!result.success) {
        selfHealingMonitor.record(job.agent_id, { success: false, failureType: "report_quality", error: "Daily output requires quality review." });
      } else {
        selfHealingMonitor.record(job.agent_id, { success: true });
      }
    } catch (error) {
      const retry = await persistentQueue.fail(job, workerId, error);
      selfHealingMonitor.record(job.agent_id, { success: false, failureType: inferFailureType(error.message), error: error.message });
      await persistentQueue.notify(ownerId, {
        agentId: job.agent_id,
        type: retry.terminal ? "agent_failed" : "agent_retry_scheduled",
        title: job.agent_id + (retry.terminal ? " daily task failed" : " daily task will retry"),
        body: error.message.slice(0, 1200),
        metadata: { jobId: job.id, dayKey, terminal: retry.terminal, retryInSeconds: retry.retryInSeconds }
      }).catch(notificationError => console.error("Could not save failure notification:", notificationError.message));
      summary.push({ agentId: job.agent_id, status: retry.terminal ? "failed" : "retry_scheduled", error: error.message });
      if (!retry.terminal) await new Promise(resolve => setTimeout(resolve, retry.retryInSeconds * 1000));
    } finally {
      clearInterval(leaseHeartbeat);
    }
  }
  try {
    const dailyJobs = await persistentQueue.dailyResults(ownerId, dayKey);
    if (dailyJobs.length) {
      const report = buildDailyReport(dayKey, dailyJobs);
      await persistentQueue.upsertDailyReport(ownerId, report);
    }
  } catch (error) {
    console.error("Could not save the daily Master AI report:", error.message);
  }
  return summary;
}

async function startDailyWorker(ownerId, dayKey) {
  if (dailyWorkerRunning) return false;
  dailyWorkerRunning = true;
  try {
    await processDailyQueue(ownerId, dayKey);
  } finally {
    dailyWorkerRunning = false;
  }
  return true;
}

function schedulerAuthorized(req) {
  const provided = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return secureSecretMatches(provided, process.env.SCHEDULER_SHARED_SECRET);
}

app.post("/api/internal/daily-run", async (req, res) => {
  if (!schedulerAuthorized(req)) return res.status(401).json({ success: false, error: "Unauthorized scheduler request." });
  if (!persistentQueue) return res.status(503).json({ success: false, error: "Persistent queue is not configured; check Supabase service-role configuration." });
  const ownerId = String(process.env.SUPABASE_OWNER_USER_ID || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) {
    return res.status(503).json({ success: false, error: "SUPABASE_OWNER_USER_ID is not configured correctly." });
  }
  const dayKey = indiaDayKey();
  try {
    const priority = { affiliate: 10, youtube: 20, blogging: 30, "app-development": 40, seo: 100 };
    const recentBlogDrafts = await persistentQueue.recentBlogTopics(ownerId, 200);
    const blogTask = buildDailyBlogTask({
      dayKey,
      priorTopics: recentBlogDrafts.map(item => item.topic)
    });
    const items = Object.entries(DAILY_ASSIGNMENTS).map(([agentId, task]) => ({
      agentId,
      task: agentId === "blogging" ? blogTask : task,
      priority: priority[agentId],
      idempotencyKey: "daily:" + dayKey + ":" + agentId
    }));
    const queued = await persistentQueue.enqueue(ownerId, items);
    void startDailyWorker(ownerId, dayKey).catch(error => console.error("Daily queue worker stopped:", error.message));
    return res.status(202).json({
      success: true, accepted: true, dayKey, timezone: "Asia/Kolkata", queued,
      message: "Daily jobs are saved in the persistent queue. The background worker is processing drafts; publishing and spending remain approval-only."
    });
  } catch (error) {
    console.error("Daily autonomous run failed:", error.message);
    return res.status(503).json({ success: false, dayKey, error: error.message });
  }
});

app.post("/api/internal/blog-retry", async (req, res) => {
  if (!schedulerAuthorized(req)) return res.status(401).json({ success: false, error: "Unauthorized scheduler request." });
  if (!persistentQueue) return res.status(503).json({ success: false, error: "Persistent queue is not configured." });
  const ownerId = String(process.env.SUPABASE_OWNER_USER_ID || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) {
    return res.status(503).json({ success: false, error: "SUPABASE_OWNER_USER_ID is not configured correctly." });
  }
  const dayKey = indiaDayKey();
  try {
    const recent = await persistentQueue.status(ownerId);
    const prefix = "daily:" + dayKey + ":blogging:recovery:";
    const recoveries = recent.filter(item => String(item.idempotency_key || "").startsWith(prefix));
    const active = recoveries.find(item => ["pending", "running"].includes(item.status));
    if (active && active.status === "pending" && Number(active.attempts || 0) >= Number(active.max_attempts || 4)) {
      const finalized = await persistentQueue.finalizeExhaustedPending(active.id);
      if (finalized.finalized) {
        console.warn("Exhausted pending Blogging recovery marked failed; enqueueing a fresh recovery job.");
        active.status = "failed";
      }
    }
    if (active && ["pending", "running"].includes(active.status)) {
      let resumedStatus = active.status;
      let finalAttemptExpired = false;
      if (active.status === "running" && !dailyWorkerRunning) {
        const recovery = await persistentQueue.recoverExpired(active.id, 2);
        if (recovery.recovered) resumedStatus = recovery.status;
        finalAttemptExpired = recovery.recovered && recovery.status === "failed";
      }
      if (!finalAttemptExpired) {
        void startDailyWorker(ownerId, dayKey).catch(error => console.error("Blog recovery resume worker stopped:", error.message));
        return res.status(202).json({ success: true, accepted: false, existing: true, status: resumedStatus, message: "An existing Blogging recovery was found; stale worker leases are recovered safely and pending work is resumed." });
      }
      console.warn("Expired final Blogging attempt marked failed; enqueueing a fresh recovery job.");
    }
    if (recoveries.length >= 4) {
      return res.status(429).json({ success: false, dayKey, error: "The daily Blogging recovery limit of four jobs has been reached. Stop retrying until the provider quota or editorial failure is resolved." });
    }
    const recoveryNumber = recoveries.length + 1;
    const priorTopics = await persistentQueue.recentBlogTopics(ownerId, 200);
    const task = buildDailyBlogTask({ dayKey, priorTopics: priorTopics.map(item => item.topic) });
    const queued = await persistentQueue.enqueue(ownerId, [{
      agentId: "blogging",
      task,
      priority: 30,
      idempotencyKey: prefix + recoveryNumber,
      payload: { recovery: true, recoveryNumber, source: "owner_requested_safe_recovery" }
    }]);
    void startDailyWorker(ownerId, dayKey).catch(error => console.error("Blog recovery worker stopped:", error.message));
    return res.status(202).json({
      success: true, accepted: queued.inserted > 0, dayKey, recoveryNumber, queued,
      message: "A Blogging-only recovery job was saved. It will be checked, stored as a private draft, and kept unpublished unless its editorial gate passes. Publishing remains approval-only."
    });
  } catch (error) {
    console.error("Blog recovery enqueue failed:", error.message);
    return res.status(503).json({ success: false, dayKey, error: error.message });
  }
});

app.post("/api/internal/app-development-retry", async (req, res) => {
  if (!schedulerAuthorized(req)) return res.status(401).json({ success: false, error: "Unauthorized scheduler request." });
  if (!persistentQueue) return res.status(503).json({ success: false, error: "Persistent queue is not configured." });
  const ownerId = String(process.env.SUPABASE_OWNER_USER_ID || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) {
    return res.status(503).json({ success: false, error: "SUPABASE_OWNER_USER_ID is not configured correctly." });
  }
  const dayKey = indiaDayKey();
  try {
    const recent = await persistentQueue.status(ownerId);
    const prefix = "daily:" + dayKey + ":app-development:recovery:";
    const recoveries = recent.filter(item => String(item.idempotency_key || "").startsWith(prefix));
    const active = recoveries.find(item => ["pending", "running"].includes(item.status));
    if (active && active.status === "pending" && Number(active.attempts || 0) >= Number(active.max_attempts || 4)) {
      const finalized = await persistentQueue.finalizeExhaustedPending(active.id);
      if (finalized.finalized) active.status = "failed";
    }
    if (active && ["pending", "running"].includes(active.status)) {
      let resumedStatus = active.status;
      let finalAttemptExpired = false;
      if (active.status === "running" && !dailyWorkerRunning) {
        const recovery = await persistentQueue.recoverExpired(active.id, 2);
        if (recovery.recovered) resumedStatus = recovery.status;
        finalAttemptExpired = recovery.recovered && recovery.status === "failed";
      }
      if (!finalAttemptExpired) {
        void startDailyWorker(ownerId, dayKey).catch(error => console.error("App Development recovery worker stopped:", error.message));
        return res.status(202).json({ success: true, accepted: false, existing: true, status: resumedStatus, dayKey, message: "An existing App Development recovery was found; stale worker leases are recovered safely and pending work is resumed." });
      }
      console.warn("Expired final App Development attempt marked failed; enqueueing a fresh recovery job.");
    }
    const recoveryNumber = recoveries.length + 1;
    const queued = await persistentQueue.enqueue(ownerId, [{
      agentId: "app-development",
      task: DAILY_ASSIGNMENTS["app-development"],
      priority: 20,
      idempotencyKey: prefix + recoveryNumber,
      payload: { recovery: true, recoveryNumber, source: "owner_requested_safe_recovery" }
    }]);
    void startDailyWorker(ownerId, dayKey).catch(error => console.error("App Development recovery worker stopped:", error.message));
    return res.status(202).json({ success: true, accepted: queued.inserted > 0, dayKey, recoveryNumber, queued, message: "An App Development-only job was saved. Source files are stored in the owner workspace and statically checked; builds and runtime tests remain separate." });
  } catch (error) {
    console.error("App Development recovery request failed:", error.message);
    return res.status(503).json({ success: false, dayKey, error: error.message });
  }
});

app.get("/api/internal/daily-status", async (req, res) => {
  if (!schedulerAuthorized(req)) return res.status(401).json({ success: false, error: "Unauthorized scheduler request." });
  if (!persistentQueue) return res.status(503).json({ success: false, error: "Persistent queue is not configured." });
  const ownerId = String(process.env.SUPABASE_OWNER_USER_ID || "");
  const dayKey = indiaDayKey();
  try {
    const allJobs = await persistentQueue.status(ownerId);
    const jobs = allJobs.filter(job => job.idempotency_key === "daily:" + dayKey + ":" + job.agent_id);
    const recoveryJobs = allJobs.filter(job => String(job.idempotency_key || "").startsWith("daily:" + dayKey + ":blogging:recovery:"));
    const counts = jobs.reduce((acc, job) => { acc[job.status] = (acc[job.status] || 0) + 1; return acc; }, {});
    return res.json({ success: true, dayKey, jobs, recoveryJobs, counts, workerRunning: dailyWorkerRunning, finished: jobs.length === 5 && jobs.every(job => ["completed", "failed"].includes(job.status)) });
  } catch (error) {
    return res.status(503).json({ success: false, error: error.message });
  }
});

app.use(express.static("public"));

// =====================================
// PROVIDER COOLDOWNS
// =====================================

const cooldowns = {
  gemini: 0,
  groq: 0,
  openrouter: 0
};

function isCoolingDown(provider) {
  return Date.now() < cooldowns[provider];
}

function setCooldown(provider, seconds = 60) {
  cooldowns[provider] = Math.max(
    cooldowns[provider],
    Date.now() + seconds * 1000
  );

  console.log(`${provider} cooldown: ${seconds} seconds.`);
}

function getRetrySeconds(message, retryAfterHeader) {
  return getProviderRetrySeconds(message, retryAfterHeader);
}

// =====================================
// AGENTS
// =====================================

const agents = [
  {
    id: "master",
    name: "Master AI Bot",
    role: "Coordinates tasks and delegates work to specialist bots."
  },
  {
    id: "affiliate",
    name: "Affiliate Marketing Bot",
    role: "Plans affiliate product research and promotional content."
  },
  {
    id: "youtube",
    name: "YouTube Bot",
    role: "Creates video ideas, scripts, and channel plans."
  },
  {
    id: "blogging",
    name: "Blogging Bot",
    role: "Plans blog topics and drafts articles."
  },
  {
    id: "app-development",
    name: "App Development Bot",
    role: "Helps plan applications, generate code, and troubleshoot."
  },
  {
    id: "seo",
    name: "SEO Bot",
    role: "Suggests keywords and search optimisation improvements."
  }
];

const specialistAgents = agents.filter(
  agent => agent.id !== "master"
);

// =====================================
// AGENT INSTRUCTIONS
// =====================================

const agentInstructions = {
  master: getMasterInstructions(),
  affiliate: getSpecialistInstructions("affiliate"),
  youtube: getSpecialistInstructions("youtube"),
  blogging: getSpecialistInstructions("blogging"),
  "app-development": getSpecialistInstructions("app-development"),
  seo: getSpecialistInstructions("seo")
};

// Automatic local readiness checks: no AI API calls or quota consumption.
let healthCheckLastRunAt = null;
let healthCheckRunning = false;

function runAgentHealthChecks() {
  if (healthCheckRunning) return;
  healthCheckRunning = true;
  try {
    const providers = [
      { id: "gemini", configured: Boolean(process.env.GEMINI_API_KEY), coolingDown: isCoolingDown("gemini") },
      { id: "groq", configured: Boolean(process.env.GROQ_API_KEY), coolingDown: isCoolingDown("groq") },
      { id: "openrouter", configured: Boolean(process.env.OPENROUTER_API_KEY), coolingDown: isCoolingDown("openrouter") }
    ];
    const checks = buildAgentReadinessChecks({ agents, specialistAgents, agentInstructions, providers });
    for (const check of checks) {
      const current = selfHealingMonitor.getAgent(check.agentId);
      // A passing configuration check must not erase a real task failure.
      // A degraded agent recovers only after a real successful task execution.
      if (check.success && current?.status === "degraded") continue;
      selfHealingMonitor.record(check.agentId, { success: check.success, error: check.error || undefined });
    }
    healthCheckLastRunAt = new Date().toISOString();
    console.log("Automatic agent readiness checks completed:", checks.filter(item => item.success).length + "/" + checks.length + " ready.");
  } catch (error) {
    console.error("Automatic agent readiness checks failed:", error.message);
  } finally {
    healthCheckRunning = false;
  }
}

void selfHealingMonitor.ready.then(() => {
  runAgentHealthChecks();
  const healthTimer = setInterval(runAgentHealthChecks, HEALTH_CHECK_INTERVAL_MS);
  if (typeof healthTimer.unref === "function") healthTimer.unref();
});

// =====================================
// GEMINI PROVIDER
// =====================================

async function callGemini(task, instructions, maxTokens = 900) {

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured.");
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    contents: task,
    config: {
      systemInstruction: instructions,
      maxOutputTokens: maxTokens,
      temperature: 0.4,
      httpOptions: { timeout: 90000 }
    }
  });

  const result = response.text;

  if (!result) {
    throw new Error("Gemini returned no text.");
  }

  return result;
}

// =====================================
// GROQ PROVIDER
// =====================================

async function callGroq(task, instructions, maxTokens = 900) {

  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq API key not configured.");
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    90000
  );

  try {

    const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
    const usesGptOss = groqModel.toLowerCase().startsWith("openai/gpt-oss");

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [
            {
              role: "system",
              content: instructions
            },
            {
              role: "user",
              content: task
            }
          ],
          temperature: 0.4,
          max_completion_tokens: Math.max(maxTokens + 600, 1400),
          ...(usesGptOss ? { reasoning_effort: "low" } : {})
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {

      const details = await response.text();

      if (response.status === 429) {
        // Honor the provider's Retry-After guidance when present. This cooldown
        // prevents later specialists from repeatedly hitting the same quota window.
        setCooldown("groq", getRetrySeconds(details, response.headers.get("retry-after")));
      }

      console.error(
        "Groq API error:",
        response.status,
        details
      );

      throw new Error(
        `Groq HTTP ${response.status}: ${details}`
      );
    }

    const data = await response.json();
    const result = extractCompletionText(data, "Groq");

    // A successful retry proves the short TPM window has cleared.
    cooldowns.groq = 0;
    console.log("Groq AI response successful.");

    return result;

  } finally {
    clearTimeout(timeout);
  }
}

// =====================================
// OPENROUTER PROVIDER
// =====================================

async function callOpenRouter(
  task,
  instructions,
  maxTokens = 900
) {

  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OpenRouter API key not configured.");
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    90000
  );

  try {

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "X-Title": "Master AI Bot"
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || "openrouter/free",
          messages: [
            {
              role: "system",
              content: instructions
            },
            {
              role: "user",
              content: task
            }
          ],
          temperature: 0.4,
          // Reserve most of the output budget for the user-facing answer.
          // OpenRouter free routing may select reasoning models that otherwise
          // spend the entire max_tokens budget on reasoning and return empty content.
          reasoning: {
            effort: "low",
            exclude: true
          },
          max_tokens: Math.max(maxTokens + 1000, 2000)
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {

      const details = await response.text();

      if (response.status === 429) {
        setCooldown("openrouter", getRetrySeconds(details, response.headers.get("retry-after")));
      }

      console.error(
        "OpenRouter API error:",
        response.status,
        details
      );

      throw new Error(
        `OpenRouter HTTP ${response.status}: ${details}`
      );
    }

    const data = await response.json();
    const result = extractCompletionText(data, "OpenRouter");

    console.log("OpenRouter AI response successful.");

    return result;

  } finally {
    clearTimeout(timeout);
  }
}

// =====================================
// THREE-PROVIDER AUTOMATIC SWITCHING
// =====================================

async function generateAI(task, instructions, maxTokens = 900) {
  // Reliability-first provider order: Groq primary, OpenRouter fallback,
  // Gemini final fallback. Keep all configured keys and models unchanged.
  const providers = [
    {
      id: "groq",
      name: "Groq",
      key: "GROQ_API_KEY",
      call: callGroq
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      key: "OPENROUTER_API_KEY",
      call: callOpenRouter
    },
    {
      id: "gemini",
      name: "Gemini",
      key: "GEMINI_API_KEY",
      call: callGemini
    }
  ].map((provider) => ({
    ...provider,
    available: Boolean(process.env[provider.key]),
    call: () => provider.call(task, instructions, maxTokens)
  }));

  return runProviderFallback(providers, {
    isCoolingDown,
    onAttempt(provider) {
      console.log(provider.name + " attempt started.");
    },
    onSkipped(provider, reason) {
      console.log(provider.name + " skipped: " + reason + ".");
    },
    onSuccess(provider) {
      console.log(provider.name + " fallback succeeded.");
    },
    onFailure(provider, error) {
      console.error(provider.name + " failed:", error.message);

      if (provider.id === "gemini") {
        if (/429|RESOURCE_EXHAUSTED/i.test(error.message)) {
          setCooldown("gemini", 3600);
        } else if (/503|UNAVAILABLE|timeout|fetch failed/i.test(error.message)) {
          setCooldown("gemini", getRetrySeconds(error.message));
        }
      }
    }
  });
}

// =====================================
// JSON EXTRACTION
// =====================================

function extractJson(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("AI returned an empty planning response.");
  }

  const cleaned = text.replace(/\x60{3}(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");

  if (start === -1) {
    throw new Error("AI did not return a JSON object.");
  }

  // Match the JSON object's closing brace while respecting quoted strings.
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i += 1) {
    const char = cleaned[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, i + 1));
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Planning response must be a JSON object.");
          }
          return parsed;
        } catch (error) {
          throw new Error("AI returned invalid planning JSON: " + error.message);
        }
      }
    }
  }

  throw new Error("AI returned incomplete planning JSON.");
}

// =====================================
// CENTRAL AI BRAIN: PLANNING
// =====================================

async function createBrainPlan(task) {

  const requireAllSpecialists = requestsAllSpecialists(task);

  const availableAgents = specialistAgents
    .map(agent => `${agent.id}: ${agent.role}`)
    .join("\n");

  if (requireAllSpecialists) {
    // Deterministic role-specific assignments prevent five agents from
    // receiving the same generic prompt and returning overlapping reports.
    const specialistBriefs = {
      affiliate: "Create a practical affiliate campaign proposal: define an audience, product-selection criteria, a compliant content funnel, a zero-budget starting route, and what must be verified before recommending any offer. Do not invent commission rates or revenue.",
      youtube: "Create a complete YouTube specialist report using all eight required report sections. Define the viewer and channel positioning; deliver exactly three differentiated, fully developed video concepts, each with a title, opening hook, story beats, scene-by-scene visual direction, runtime rationale, thumbnail concept and viewer payoff; include one sample script opening, retention plan, packaging, analytics measurement, copyright/children's-content policy checks where relevant, and exactly three next actions. Use Global Rhymes 4U context only if supplied. Do not invent channel analytics.",
      blogging: "Create an editorial proposal: choose one focused article idea, define search intent and reader value, provide an H2/H3 outline, internal-link ideas, an original-value angle, and a fact-check plan. Do not invent traffic or keyword metrics.",
      "app-development": "Create a mobile-first app MVP specification: state the user problem, core features, user flow, recommended low-cost stack, acceptance criteria, security/privacy checks, and test cases. Do not assume a budget or claim code has been built.",
      seo: "Create an SEO audit and content-discovery proposal: identify what evidence is needed, propose topic clusters and on-page checks, prioritize fixes by impact/effort, and define Search Console measurements. Mark search volumes and rankings as unverified unless supplied."
    };

    return {
      tasks: specialistAgents.map(agent => ({
        agentId: agent.id,
        task:
          "MASTER AI BOT SPECIALIST EVALUATION.\n" +
          "OWNER'S ORIGINAL GOAL:\n" + task + "\n\n" +
          "YOUR DISTINCT ASSIGNMENT:\n" + specialistBriefs[agent.id] + "\n\n" +
          "Return only your own specialist report. Do not describe or score other bots. " +
          "Do not claim an AI provider/model name, internal test evidence, or a self-awarded quality score. " +
          "The server attaches provider identity and structural review from execution metadata. " +
          "No publishing, spending, account changes, or external actions are permitted."
      })),
      provider: "Deterministic specialist assignment"
    };
  }

  const instructions =
    "You are the planning brain of a multi-agent AI system. " +
    (requireAllSpecialists
      ? "The user explicitly requested ALL FIVE specialist agents. You MUST assign a distinct task to every available specialist: affiliate, youtube, blogging, app-development, and seo. Do not omit any specialist. "
      : "Choose only relevant specialist agents. Choose between one and three agents. ") +
    "Return ONLY valid JSON without markdown.\n\n" +
    "Available agents:\n" +
    availableAgents +
    "\n\nJSON format:\n" +
    '{"tasks":[{"agentId":"affiliate","task":"Specific work"}]}\n' +
    "Do not select the master agent.";

  const response = await generateAI(
    task,
    instructions,
    350
  );

  const plan = extractJson(response.result);

  if (!Array.isArray(plan.tasks)) {
    throw new Error("Invalid task plan.");
  }

  const validTasks = [];

  for (const item of plan.tasks) {

    if (
      !item ||
      typeof item.agentId !== "string" ||
      typeof item.task !== "string"
    ) {
      continue;
    }

    const agent = specialistAgents.find(
      a => a.id === item.agentId
    );

    if (
      agent &&
      item.task.trim() &&
      !validTasks.some(
        t => t.agentId === agent.id
      )
    ) {
      validTasks.push({
        agentId: agent.id,
        task: item.task.trim()
      });
    }

    if (validTasks.length >= (requireAllSpecialists ? specialistAgents.length : 3)) {
      break;
    }
  }

  if (validTasks.length === 0) {
    // A planner can return valid JSON but still omit or misspell every agent.
    // Recover with deterministic routing instead of failing the entire brain.
    const fallbackIds = fallbackAgentSelection(task, specialistAgents);
    const fallbackTasks = fallbackIds.map(agentId => ({
      agentId,
      task
    }));

    if (fallbackTasks.length === 0) {
      throw new Error("No specialist could be selected for this task.");
    }

    console.warn(
      "AI planner returned no valid specialists; deterministic routing selected:",
      fallbackIds.join(", ")
    );

    return {
      tasks: fallbackTasks,
      provider: response.provider + " + deterministic routing"
    };
  }

  return {
    tasks: validTasks,
    provider: response.provider
  };
}

// =====================================
// LIMIT SPECIALIST REPORT SIZE
// =====================================

function compactReport(text, maxLength = 2600) {

  const cleaned = String(text || "").trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return (
    cleaned.slice(0, maxLength) +
    "\n\n[Report shortened to save AI tokens.]"
  );
}

// =====================================
// CENTRAL AI BRAIN: EXECUTION
// =====================================

async function runCentralBrain(task, ownerUserId, channelId) {

  let plan;

  let planningProvider = "Fallback selection";

  try {

    plan = await createBrainPlan(task);

    planningProvider = plan.provider;

  } catch (error) {

    console.error(
      "AI planning unavailable:",
      error.message
    );

    plan = {
      tasks: fallbackAgentSelection(task, specialistAgents).map(
        agentId => ({
          agentId,
          task
        })
      )
    };
  }

  const specialistResults = [];
  const providersUsed = new Set();

  // Deterministic assignment is internal orchestration, not an AI provider.
  // When an AI planner needed deterministic routing, retain its real provider.
  const actualPlanningProvider = planningProvider
    .replace(/\s*\+\s*deterministic routing$/i, "")
    .trim();
  if (
    actualPlanningProvider &&
    actualPlanningProvider !== "Fallback selection" &&
    actualPlanningProvider !== "Deterministic specialist assignment"
  ) {
    providersUsed.add(actualPlanningProvider);
  }

  // Execute specialists sequentially.
  for (const item of plan.tasks) {

    // Small spacing between sequential calls reduces burst pressure on shared
    // provider TPM windows; explicit 429 guidance is handled by fallback retry.
    if (specialistResults.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    const agent = specialistAgents.find(
      a => a.id === item.agentId
    );

    if (!agent) continue;

    try {

      let specialistTask = item.task;
      if (item.agentId === "youtube") {
        const youtubeContext = await buildYoutubeTaskContext({
          ownerId: ownerUserId,
          channelId,
          task: item.task,
          rhymeMemory: youtubeRhymeMemory,
          getYoutubeAgentContext,
          onError: (kind, error) => {
            if (kind === "rhyme_memory") {
              console.warn("Saved YouTube rhyme memory unavailable; continuing without resume context:", error.message);
            } else {
              console.log("YouTube channel context unavailable; continuing with the user request only:", error.message);
            }
          }
        });
        if (youtubeContext) specialistTask += youtubeContext;
      }

      const conciseInstructions =
        agentInstructions[item.agentId] +
        "Avoid stating or guessing the name of the AI model or provider. " +
        "The server adds verified provider information separately. " +
        "Never label your report as GPT-4, Gemini, or another model unless " +
        "the user explicitly asks for a comparison of models. " +
        "Use the required professional report format from your role instructions. " +
        "Prioritise important findings and actionable recommendations. " +
        "Avoid repeating the user's task.";

      const response = await generateAI(
        specialistTask,
        conciseInstructions,
        2600
      );

      let specialistReport = response.result;
      let specialistProvider = response.provider;
      let qualityReview = reviewSpecialistReport(specialistReport);
      let reportRepaired = false;

      // Repair only absent sections. Use at most two bounded passes so a
      // short or partially truncated repair cannot leave easy omissions behind.
      // Each pass recalculates missing sections and preserves the original draft.
      for (let repairRound = 0; repairRound < 2 && (qualityReview.missingSections.length > 0 || qualityReview.thinSections.length > 0); repairRound += 1) {
        const repairSections = [...qualityReview.missingSections, ...qualityReview.thinSections.filter(section => !qualityReview.missingSections.includes(section))];
        const thinSections = [...qualityReview.thinSections];
        try {
          const repairInstructions = [
            "You are a specialist report completion editor.",
            "Do NOT rewrite, summarize, or repeat the original report.",
            "Generate ONLY the requested sections listed in the task, using the exact requested headings.",
            "For a missing section, add its heading and content. For a thin section, replace the empty or weak content under its existing heading with substantive content; do not duplicate its heading.",
            "Preserve the specialist's original role, task context, and constraints.",
            "Do not invent research, sources, prices, commissions, metrics, test results, or completed actions.",
            "When evidence is unavailable, state 'Needs live verification' and specify exactly what source or measurement is required.",
            "When a KPI baseline is unavailable, describe how to measure it first; do not invent a target.",
            "Complete every listed section in this response. Keep each section concise but useful.",
            "Return only the requested sections, with no introduction or conclusion."
          ].join("\\n");

          const repairTask =
            "ORIGINAL SPECIALIST TASK:\\n" + item.task.slice(0, 2500) +
            "\\n\\nSECTIONS TO COMPLETE (ONLY THESE):\\n" +
            repairSections.map(section => "## " + section).join("\\n") +
            "\\n\\nORIGINAL REPORT — PRESERVE IT, DO NOT REWRITE:\\n" +
            compactReport(specialistReport, 5200);

          const repair = await generateAI(repairTask, repairInstructions, 1500);
          if (!repair.result || !repair.result.trim()) break;

          specialistReport = mergeMissingReportSections(specialistReport, repair.result, { replaceSections: thinSections });
          specialistProvider = [...new Set([specialistProvider, repair.provider])].join(" + ");
          providersUsed.add(repair.provider);
          qualityReview = reviewSpecialistReport(specialistReport);
          reportRepaired = true;
        } catch (repairError) {
          console.error(agent.name + " missing-section repair pass " + (repairRound + 1) + " failed:", repairError.message);
          break;
        }
      }

      // Save after report repair because the repair pass can add the machine-readable state block.
      let rhymeMemorySave = null;
      if (item.agentId === "youtube" && ownerUserId && /rhyme|nursery|scene|production plan/i.test(item.task)) {
        try {
          const savedRhyme = await youtubeRhymeMemory.persistReport(ownerUserId, channelId, specialistReport);
          if (savedRhyme && savedRhyme.id) {
            rhymeMemorySave = { success: true, projectId: savedRhyme.id };
            console.log("YouTube rhyme production state saved:", savedRhyme.id);
          } else {
            rhymeMemorySave = { success: false, error: "Final report did not contain a valid complete rhyme production state." };
            console.warn("YouTube rhyme production state was not saved: final report has no valid state block.");
          }
        } catch (memoryError) {
          rhymeMemorySave = { success: false, error: String(memoryError.message || "Unknown storage error").slice(0, 300) };
          console.warn("YouTube rhyme production state could not be saved:", memoryError.message);
        }
      }

      providersUsed.add(response.provider);
      const qualityPassed = qualityReview.status === "passed";
      const structuralIssues = [
        ...qualityReview.missingSections.map(section => "Missing section: " + section),
        ...qualityReview.warnings.filter(warning =>
          !/numerical budget, revenue, audience or performance claims/i.test(warning) &&
          !/provider or quality-score claims/i.test(warning)
        )
      ];
      const evidenceWarnings = qualityReview.warnings.filter(warning =>
        /numerical budget, revenue, audience or performance claims|provider or quality-score claims/i.test(warning)
      );
      const qualityFailure = qualityPassed
        ? undefined
        : "Structural report requires attention: " + structuralIssues.join("; ") +
          (evidenceWarnings.length ? ". Separate evidence warnings (not structural failures): " + evidenceWarnings.join("; ") : "");
      selfHealingMonitor.record(item.agentId, {
        success: qualityPassed,
        failureType: "report_quality",
        error: qualityFailure
      });

      specialistResults.push({
        agentId: item.agentId,
        name: agent.name,
        success: qualityPassed,
        needsAttention: !qualityPassed,
        error: qualityFailure,
        provider: specialistProvider,
        reportRepaired,
        structuralStatus: qualityReview.status,
        evidenceReview: qualityReview.evidenceReview,
        qualityReview,
        rhymeMemory: rhymeMemorySave,
        result: specialistReport
      });

    } catch (error) {

      console.error(
        `${agent.name} failed:`,
        error.message
      );
      selfHealingMonitor.record(item.agentId, {
        success: false,
        failureType: inferFailureType(error.message),
        error: error.message
      });

      specialistResults.push({
        agentId: item.agentId,
        name: agent.name,
        success: false,
        provider: null,
        error: String(error.message || "Unknown provider error").slice(0, 1200),
        result: "This specialist could not complete the task."
      });
    }
  }

  const successfulResults =
    specialistResults.filter(item => item.success);

  if (specialistResults.length === 0) {
    throw new Error(
      "The specialist bots could not complete this task."
    );
  }

  const specialistSummary = specialistResults
    .map(item =>
      `SPECIALIST: ${item.name}\n` +
      `EXECUTION STATUS: ${item.success ? "Passed" : item.needsAttention ? "Needs attention" : "Failed"}\n` +
      `VERIFIED PROVIDER: ${item.provider || "Not available"}\n` +
      (item.error ? `EXECUTION / QUALITY DETAIL: ${item.error}\n` : "") +
      `STRUCTURAL QUALITY REVIEW: ${item.qualityReview?.score ?? "Not scored"}/100 (${item.qualityReview?.status || "not available"})\n` +
      (item.qualityReview?.warnings?.length
        ? `QUALITY WARNINGS: ${item.qualityReview.warnings.join("; ")}\n`
        : "") +
      compactReport(item.result, 2600)
    )
    .join("\n\n--------------------\n\n");

  const synthesisInstructions =
    "You are the Master AI Bot. Combine the specialist " +
    "reports into one useful final answer. " +
    "Remove repetition. Compare recommendations and explicitly identify contradictions, unsupported claims, stale advice, and missing evidence. " +
    "Identify the best strategy using the user's stated country, budget, skill level, device constraints, existing projects and preferences when those details are available in the task or specialist context. " +
    "Do not recommend tools or platforms that are unavailable or unsuitable in the user's country/device context; flag availability for verification when uncertain. " +
    "Separate verified facts, assumptions, estimates, proposals and unknowns. Numerical targets are not evidence. Never convert a specialist's unsupported claim into a verified fact. " +
    "Provide a prioritized decision, dependencies, risks, measurable KPIs without invented baselines, and exactly three immediate next actions when appropriate. " +
    "Preserve important facts. Never invent information. " +
    "Do not guess or invent AI provider names. Provider identity is supplied separately by verified server metadata; do not claim a provider unless that exact name appears in the metadata. " +
    "Do not mark a missing or failed specialist as successful. " +
    "Keep the final answer clear, concise and useful to the owner. " +
    "When the original task requests a 7-day plan, provide exactly Day 1 through Day 7, with no more than the owner's stated daily time limit. " +
    "Make the plan realistic for the stated device, skill level, country and budget; do not assign desktop-only work to a phone-only owner. " +
    "Do not assume the owner has social accounts, a website, a blog, an app, a product catalogue or analytics unless explicitly stated. " +
    "For every specialist, identify meaningful strengths and any material weakness, unsupported assumption or unverified claim. " +
    "If a recommendation cannot be carried out under the owner's constraints, reject it or provide a genuinely feasible alternative. " +
    "Do not turn proposed KPI examples into targets or forecasts; define what to measure first and establish a baseline.";

  let finalResult;
  let synthesisSucceeded = false;
  let synthesisError = null;

  try {

    const synthesis = await generateAI(
      "ORIGINAL USER TASK:\n" +
      task.slice(0, 2500) +
      "\n\nSPECIALIST REPORTS (compact decision briefs, one per specialist):\n" +
      specialistResults.map(item => [
        "SPECIALIST: " + item.name,
        "STATUS: " + (item.success ? "Passed" : item.needsAttention ? "Needs attention" : "Failed"),
        "PROVIDER: " + (item.provider || "Not available"),
        "EVIDENCE REVIEW: " + (item.evidenceReview || "not classified"),
        "REPORT EXCERPT:\n" + compactReport(item.result, 1150)
      ].join("\n")).join("\n\n---\n\n"),
      synthesisInstructions,
      2000
    );

    providersUsed.add(synthesis.provider);

    finalResult = synthesis.result;
    synthesisSucceeded = Boolean(String(finalResult || "").trim());
    if (!synthesisSucceeded) throw new Error("Synthesis provider returned no usable text.");

    console.log("Final AI synthesis successful.");

  } catch (error) {

    synthesisError = String(error.message || "Unknown synthesis failure").slice(0, 1200);
    console.error(
      "Final synthesis failed:",
      synthesisError
    );

    finalResult =
      "The specialist bots completed their reports, " +
      "but the final AI synthesis was unavailable. " +
      "Here are the collected reports:\n\n" +
      specialistSummary;
  }

  const needsAttentionResults = specialistResults.filter(item => item.needsAttention);
  const failedResults = specialistResults.filter(item => !item.success && !item.needsAttention);
  const nonPassingResults = [...needsAttentionResults, ...failedResults];
  const scoredResults = specialistResults.filter(item => item.qualityReview);

  // Build the audit from actual server results, not model-generated claims.
  const executionAudit = [
    "",
    "## Verified specialist execution audit",
    "| Specialist | Result | Actual provider | Structural quality |",
    "|---|---|---|---|",
    ...specialistResults.map(item =>
      `| ${item.name} | ${item.success ? "Passed" : item.needsAttention ? "Needs attention" : "Failed"} | ${item.provider || "No successful provider"} | ${item.qualityReview ? item.qualityReview.score + "/100 (" + item.qualityReview.status + ")" : "Not scored"} |`
    ),
    "",
    `**Verified totals:** ${successfulResults.length} passed, ${needsAttentionResults.length} need attention, ${failedResults.length} failed.`,
    `**Master Brain synthesis:** ${synthesisSucceeded ? "Completed" : "Needs attention — " + (synthesisError || "no usable synthesis text")}.`,
    `**Average structural quality:** ${scoredResults.length ? Math.round(scoredResults.reduce((sum, item) => sum + (item.qualityReview?.score || 0), 0) / scoredResults.length) + "/100" : "Not available"} (structure-only; factual accuracy is not independently verified).`,
    nonPassingResults.length
      ? "**Overall status:** Partial completion / needs attention. Do not treat this task as fully completed."
      : "**Overall status:** All requested specialists passed execution and structural quality checks."
  ].join("\n");

  finalResult = finalResult + "\n\n" + executionAudit;

  return {
    success: nonPassingResults.length === 0 && specialistResults.length > 0 && synthesisSucceeded,
    partialSuccess: successfulResults.length > 0 && (nonPassingResults.length > 0 || !synthesisSucceeded),
    synthesisStatus: synthesisSucceeded ? "completed" : "needs_attention",
    synthesisError,
    agent: "master",
    provider: [...providersUsed].join(" + ") || "Unknown",
    totalSpecialists: specialistResults.length,
    successfulSpecialists: successfulResults.length,
    failedSpecialists: failedResults.length,
    needsAttentionSpecialists: needsAttentionResults.length,
    requiresHumanApproval: true,
    executionMode: "proposal_only",
    approvalNotice: "This response is a proposal. Review it before publishing, spending, sending, deleting, or deploying anything.",
    selectedAgents: specialistResults.map(item => ({
      id: item.agentId,
      name: item.name,
      success: item.success
    })),
    specialistResults,
    result: finalResult
  };
}

// Synthesis-only recovery retrieves owner-scoped saved reports and never runs specialists.
async function runSynthesisFromSavedReports(task, ownerUserId, reportIds) {
  if (!ownerUserId) throw new Error("Owner authentication is required to reuse saved reports.");
  const rows = await agentHistoryHandlers.getByIds(ownerUserId, reportIds);
  const reports = validateSavedSpecialistReports(rows, reportIds);
  const specialistResults = reports.map(row => ({
    agentId: row.agent_id,
    name: agents.find(agent => agent.id === row.agent_id)?.name || row.agent_id,
    success: true,
    needsAttention: false,
    provider: row.provider || "Not recorded",
    result: row.report,
    qualityReview: row.metadata?.qualityReview || null,
    savedReportId: row.id,
    createdAt: row.created_at
  }));
  const reportContext = specialistResults.map(item =>
    "SAVED REPORT ID: " + item.savedReportId + "\n" +
    "SPECIALIST: " + item.name + "\n" +
    "ORIGINAL PROVIDER: " + item.provider + "\n" +
    "ORIGINAL REPORT:\n" + compactReport(item.result, 1200)
  ).join("\n\n--------------------\n\n");
  const synthesis = await generateAI(
    "SYNTHESIS ONLY. Do not execute, plan, or rerun specialists.\n" +
    "Owner synthesis request:\n" + task.replace(/^\s*SYNTHESIS_ONLY_REPORT_IDS\s*:.*$/im, "").slice(0, 3000) +
    "\n\nEXACTLY FIVE OWNER-VERIFIED SAVED REPORTS:\n" + reportContext,
    "Synthesize only the five supplied saved reports. Do not invent sources or claim research not present in them. Resolve conflicts, prioritize India, Android-first and ₹0 upfront constraints unless the owner explicitly overrides them, separate verified facts, assumptions, estimates and recommendations, and identify unsupported claims. Produce a ranked action plan with dependencies, risks, realistic sequencing and three immediate actions. Do not claim any specialist was executed. Return a useful unified plan.",
    2600
  );
  if (!synthesis.result || !String(synthesis.result).trim()) throw new Error("Synthesis provider returned no usable text. Saved reports were not rerun.");
  return {
    success: true, reusedReports: true, reusedReportIds: reports.map(row => row.id),
    agent: "master", provider: synthesis.provider, totalSpecialists: 5,
    successfulSpecialists: 5, failedSpecialists: 0, needsAttentionSpecialists: 0,
    specialistResults, requiresHumanApproval: true, executionMode: "proposal_only",
    result: synthesis.result + "\n\n## Saved report reuse audit\n" +
      reports.map(row => "- " + row.agent_id + ": " + row.id + " (saved " + row.created_at + ")").join("\n") +
      "\n\n**Execution mode:** synthesis-only; no specialist execution was performed."
  };
}

// =====================================
// OWNER-ONLY YOUTUBE CHANNEL INTEGRATION
// =====================================

const youtubeHandlers = createYoutubeIntegrationHandlers();

// OAuth callback is intentionally public, but accepts only a short-lived,
// HMAC-signed state created after a verified owner session.
app.get("/api/blog/oauth/callback", blogCmsHandlers.callback);
app.use("/api/blog", requireOwner);
app.use("/api/blog", auditOwnerRequests);
app.get("/api/blog/connect-url", blogCmsHandlers.connectUrl);
app.get("/api/blog/status", blogCmsHandlers.status);
app.post("/api/blog/verify-connection", blogCmsHandlers.verifyConnection);
app.post("/api/blog/drafts/:id/create-cms-draft", blogCmsHandlers.createCmsDraft);

// Search Console callback is public but protected by a short-lived signed OAuth state.
// Public affiliate redirects are allowlisted, logged and never accept arbitrary destinations.
app.get("/go/:id", limitApiRequests, affiliateHandlers.redirect);
app.use("/api/affiliate", requireOwner);
app.use("/api/affiliate", auditOwnerRequests);
app.get("/api/affiliate/campaigns", affiliateHandlers.list);
app.patch("/api/affiliate/campaigns/:id/link", affiliateHandlers.saveLink);

app.get("/api/search-console/oauth/callback", limitApiRequests, searchConsoleHandlers.callback);
app.use("/api/search-console", requireOwner);
app.use("/api/search-console", auditOwnerRequests);
app.get("/api/search-console/connect-url", searchConsoleHandlers.connectUrl);
app.get("/api/search-console/status", searchConsoleHandlers.status);
app.get("/api/search-console/sites", searchConsoleHandlers.sites);
app.post("/api/search-console/analytics", searchConsoleHandlers.analytics);

app.get("/api/instagram/oauth/callback", instagramHandlers.callback);
app.use("/api/instagram", requireOwner);
app.use("/api/instagram", auditOwnerRequests);
app.get("/api/instagram/connect-url", instagramHandlers.connectUrl);
app.get("/api/instagram/status", instagramHandlers.status);

app.get("/api/youtube/oauth/callback", limitApiRequests, youtubeHandlers.callback);
// OAuth callback is public but rate-limited; every other YouTube route is owner-only.
app.use("/api/youtube", requireOwner);
app.use("/api/youtube", auditOwnerRequests);
app.get("/api/youtube/connect-url", youtubeHandlers.connectUrl);
app.get("/api/youtube/status", youtubeHandlers.status);
app.get("/api/youtube/channel", youtubeHandlers.channel);
app.get("/api/youtube/videos", youtubeHandlers.videos);
app.get("/api/youtube/analytics", youtubeHandlers.analytics);
const youtubeRhymeMemoryHandlers = youtubeRhymeMemory;
app.get("/api/youtube/rhyme-projects", youtubeRhymeMemoryHandlers.listHandler);
app.post("/api/youtube/rhyme-projects", youtubeRhymeMemoryHandlers.saveHandler);
app.get("/api/youtube/rhyme-projects/:id", youtubeRhymeMemoryHandlers.getHandler);
app.get("/api/youtube/production-jobs", youtubeVideoJobHandlers.list);
app.get("/api/youtube/production-jobs/:id", youtubeVideoJobHandlers.get);
const activeYoutubeVideoJobs = new Set();
let youtubeVideoWorkerRunning = false;

async function runYoutubeVideoJob(job) {
  const ownerId = job?.owner_user_id;
  if (!ownerId || !job?.id || activeYoutubeVideoJobs.has(job.id) || youtubeVideoWorkerRunning) return;
  youtubeVideoWorkerRunning = true;
  activeYoutubeVideoJobs.add(job.id);
  try {
    const scenes = Array.isArray(job.production_spec?.scenes) ? job.production_spec.scenes.slice(0, 8) : [];
    if (scenes.length < 5) throw new Error("Saved production job is missing its complete storyboard.");
    const assetPaths = { ...(job.asset_paths || {}), scenes: { ...(job.asset_paths?.scenes || {}) } };
    // Keep saved artwork in private storage and fetch it sequentially during
    // rendering. Downloading every PNG into sceneImages at once contributed
    // to memory spikes and Render restarts on the 512 MiB free web instance.
    const loadSceneImage = async index => {
      const savedPath = assetPaths.scenes[String(index + 1)];
      return savedPath ? youtubeVideoJobStore.download(ownerId, job.id, savedPath) : null;
    };
    const completed = new Set(Object.keys(assetPaths.scenes).map(Number));
    await youtubeVideoJobStore.update(ownerId, job.id, {
      status: "rendering",
      total_scenes: scenes.length,
      completed_scenes: [...completed].sort((a, b) => a - b),
      next_scene: scenes.findIndex((_, index) => !completed.has(index + 1)) + 1 || null,
      retry_at: null,
      last_error: null
    });
    const rendered = await renderNurseryRhymeVideo({
      title: job.rhyme_title,
      scenes: scenes.map(scene => ({ caption: scene.caption || scene.visualDescription })),
      loadSceneImage,
      narrationText: job.script,
      onSceneRendered: async (index, imageBytes) => {
        const sceneNumber = index + 1;
        const scenePath = await youtubeVideoJobStore.upload(ownerId, job.id,
          "scene-" + String(sceneNumber).padStart(2, "0") + ".png", imageBytes, "image/png");
        assetPaths.scenes[String(sceneNumber)] = scenePath;
        completed.add(sceneNumber);
        const next = scenes.findIndex((_, sceneIndex) => !completed.has(sceneIndex + 1));
        await youtubeVideoJobStore.update(ownerId, job.id, {
          status: "rendering",
          completed_scenes: [...completed].sort((a, b) => a - b),
          next_scene: next < 0 ? null : next + 1,
          asset_paths: assetPaths
        });
      }
    });
    await youtubeVideoJobStore.update(ownerId, job.id, { status: "uploading", completed_scenes: [...completed].sort((a, b) => a - b), next_scene: null });
    const videoPath = await youtubeVideoJobStore.upload(ownerId, job.id, "rhyme-video.mp4", rendered.video, "video/mp4");
    const thumbnailPath = await youtubeVideoJobStore.upload(ownerId, job.id, "thumbnail.png", rendered.thumbnail, "image/png");
    const narrationPath = rendered.narration ? await youtubeVideoJobStore.upload(ownerId, job.id, "narration.wav", rendered.narration, "audio/wav") : null;
    await youtubeVideoJobStore.update(ownerId, job.id, {
      status: "ready_for_review",
      completed_scenes: scenes.map((_, index) => index + 1),
      next_scene: null,
      retry_at: null,
      video_path: videoPath,
      thumbnail_path: thumbnailPath,
      asset_paths: { ...assetPaths, video: videoPath, thumbnail: thumbnailPath, ...(narrationPath ? { narration: narrationPath } : {}) },
      metadata: {
        renderStyle: rendered.renderStyle,
        durationSeconds: rendered.durationSeconds,
        resolution: rendered.resolution,
        frameRate: rendered.frameRate,
        music: rendered.audio.music,
        narration: rendered.audio.narration,
        narrationRequired: Boolean(rendered.narration),
        narrationWarning: rendered.narrationError || null,
        youtubeMetadata: job.production_spec?.youtubeMetadata || {},
        policyPreflight: job.production_spec?.policyPreflight || {},
        ownerApprovalRequired: true,
        publishingEnabled: false,
        limitations: [rendered.narration ? "Spoken narration is synthesized with an offline computer voice and may sound robotic; no sung vocals are generated." : "Offline narration was unavailable in this render; the video contains original instrumental audio and on-screen lyrics/captions. Retry narration after the local speech engine is repaired.", "Policy preflight is an AI draft, not legal clearance or a monetization guarantee."]
      }
    });
  } catch (error) {
    console.error("YouTube video production job failed:", error.message);
    const attempts = Number(job.retry_attempts || 0) + 1;
    const canRetry = attempts < 3;
    try {
      await youtubeVideoJobStore.update(ownerId, job.id, {
        status: canRetry ? "queued" : "failed",
        retry_attempts: attempts,
        retry_at: canRetry ? new Date(Date.now() + attempts * 60000).toISOString() : null,
        last_error: String(error.message || error).slice(0, 1200)
      });
    } catch (saveError) {
      console.error("Could not persist YouTube production failure:", saveError.message);
    }
  } finally {
    activeYoutubeVideoJobs.delete(job.id);
    youtubeVideoWorkerRunning = false;
  }
}
async function resumeYoutubeVideoJobs() {
  try {
    if (youtubeVideoWorkerRunning) return;
    const pending = await youtubeVideoJobStore.listPending(10);
    for (const job of pending) {
      if (youtubeVideoWorkerRunning) break;
      await runYoutubeVideoJob(job);
    }
  } catch (error) {
    console.error("YouTube production recovery check failed:", error.message);
  }
}
app.post("/api/youtube/production-jobs", async (req, res) => {
  let job = null;
  try {
    const rhymeTitle = String(req.body?.rhyme_title || req.body?.rhymeTitle || "Rainbow's Little Parade").trim().slice(0, 180);
    const prompt = "Create an original preschool nursery rhyme production for the children's YouTube channel Global Rhymes 4U. Title: " + rhymeTitle + ". Return ONLY one JSON object with keys rhymeTitle, script, scenes, youtubeMetadata, policyPreflight. script must contain complete original lyrics. scenes must be an array of 5 to 8 objects, each with a short caption (maximum 100 characters) and a visualDescription for an original friendly 2D cartoon scene. Keep the same cute yellow baby bird character in every scene, with consistent appearance and child-safe cheerful backgrounds. No copyrighted characters, melodies, lyrics, brands, or imitation of known artists. Make captions correspond to the lyrics. youtubeMetadata must include a concise YouTube title, description, and 8 to 15 relevant tags. policyPreflight must include an originality statement, madeForKids recommendation, childSafety notes, and monetization caveat. These are preliminary AI suggestions, never claim legal clearance or guaranteed monetization.";
    const generated = await generateAI(prompt,
      "You are an original children's rhyme writer and storyboard artist. Output valid JSON only. Use simple, age-appropriate language and positive themes. Do not include production claims that cannot be verified.", 2400);
    const plan = extractJson(generated.result);
    const scenes = Array.isArray(plan.scenes) ? plan.scenes.slice(0, 8) : [];
    const script = String(plan.script || "").trim().slice(0, 30000);
    const metadata = plan.youtubeMetadata && typeof plan.youtubeMetadata === "object" ? plan.youtubeMetadata : {};
    const policyPreflight = plan.policyPreflight && typeof plan.policyPreflight === "object" ? plan.policyPreflight : {};
    const youtubeMetadata = {
      title: String(metadata.title || plan.rhymeTitle || rhymeTitle).trim().slice(0, 100),
      description: String(metadata.description || "Original nursery rhyme for Global Rhymes 4U.").trim().slice(0, 5000),
      tags: Array.isArray(metadata.tags) ? metadata.tags.map(tag => String(tag).trim().slice(0, 40)).filter(Boolean).slice(0, 15) : [],
      policyPreflight: {
        originality: String(policyPreflight.originality || "AI-generated draft; human review required.").slice(0, 500),
        madeForKids: String(policyPreflight.madeForKids || "Likely made for kids; confirm the audience setting before publishing.").slice(0, 500),
        childSafety: String(policyPreflight.childSafety || "Owner must review all lyrics and visuals for child safety.").slice(0, 500),
        monetization: String(policyPreflight.monetization || "No monetization or policy compliance guarantee.").slice(0, 500)
      }
    };
    if (script.length < 80 || scenes.length < 5 || scenes.some(scene => !String(scene.caption || scene.visualDescription || "").trim())) {
      throw new Error("The AI production plan did not contain a complete rhyme and at least five usable scenes.");
    }
    job = await youtubeVideoJobStore.create(req.ownerUser.id, {
      rhyme_title: String(plan.rhymeTitle || rhymeTitle).slice(0, 180),
      script,
      scenes,
      production_spec: { provider: generated.provider, scenes, youtubeMetadata, policyPreflight: youtubeMetadata.policyPreflight, characterContinuity: "One consistent original yellow baby bird character", visualStyle: "2D vector cartoon", music: "original synthesized instrumental", narration: "captions and original instrumental audio; speech synthesis disabled on the free memory-limited deployment" }
    });
    const workerEnabled = process.env.YOUTUBE_VIDEO_WORKER_ENABLED === "true";
    res.status(202).json({
      success: true,
      job,
      message: workerEnabled
        ? "Rhyme and storyboard created. Video rendering has been queued for the background worker. Publishing remains disabled."
        : "Rhyme and storyboard saved safely. Video rendering is paused because this free web instance has a 512 MB memory limit; the job remains queued for a dedicated worker.",
      reviewRequired: true,
      publishingEnabled: false,
      videoWorkerEnabled: workerEnabled
    });
    if (workerEnabled) void runYoutubeVideoJob(job);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

// Video recovery is opt-in: running FFmpeg alongside the API can exceed
// Render's 512 MB free-instance memory limit. Keep queued jobs durable until
// a separately sized worker is explicitly enabled.
if (process.env.YOUTUBE_VIDEO_WORKER_ENABLED === "true") {
  const youtubeVideoRecoveryTimer = setInterval(resumeYoutubeVideoJobs, 30000);
  if (typeof youtubeVideoRecoveryTimer.unref === "function") youtubeVideoRecoveryTimer.unref();
  setTimeout(resumeYoutubeVideoJobs, 5000).unref?.();
}

// Agnes video generation is owner-only and remains locked until its free-tier
// eligibility has been verified in the provider console and explicitly enabled.
const agnesVideoHandlers = createAgnesVideoHandlers();
app.use("/api/agnes-video", requireOwner);
app.use("/api/agnes-video", auditOwnerRequests);
app.post("/api/agnes-video", agnesVideoHandlers.create);
app.get("/api/agnes-video/status", agnesVideoHandlers.status);

// =====================================
// HEALTH API
// =====================================

// =====================================
// OWNER-ONLY SUPABASE APPROVAL STORAGE
// =====================================

// The Supabase anon key is intentionally public. Row Level Security and the
// verified owner access token protect approval records; never expose service keys.
app.get("/api/approvals/config", (req, res) => {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const anonKey = String(process.env.SUPABASE_ANON_KEY || "").trim();
  const ownerUserId = String(process.env.SUPABASE_OWNER_USER_ID || "").trim();

  if (!supabaseUrl || !anonKey || !ownerUserId) {
    return res.status(503).json({
      success: false,
      error: "Approval sign-in is not configured yet. Add the Supabase URL, anon key, and owner user ID in Render."
    });
  }

  return res.json({ success: true, supabaseUrl, anonKey });
});

const approvalHandlers = createSupabaseApprovalHandlers();

// Approval records and decisions are owner-only. Keep /config public because
// it exposes only the Supabase URL and anon key needed to render sign-in.
app.use("/api/approvals", requireOwner);
app.use("/api/approvals", auditOwnerRequests);
app.get("/api/approvals", approvalHandlers.list);
app.post("/api/approvals", approvalHandlers.create);
app.patch("/api/approvals/:id/decision", approvalHandlers.decide);

app.get("/api/repair-proposals", (req, res) => {
  const proposals = buildRepairProposals(selfHealingMonitor.snapshot());
  return res.json({
    success: true,
    generatedAt: new Date().toISOString(),
    activeProposals: proposals.length,
    approvalRequired: true,
    executionEnabled: false,
    proposals
  });
});

app.get("/api/health", (req, res) => {

  const monitor = selfHealingMonitor.snapshot();
  res.json({
    success: true,
    status: monitor.degraded > 0 ? "degraded" : "healthy",
    specialistHealth: {
      healthy: monitor.healthy,
      degraded: monitor.degraded,
      unknown: monitor.unknown,
      monitoredAgents: monitor.monitoredAgents
    },
    healthCheck: {
      mode: "local_readiness",
      intervalSeconds: HEALTH_CHECK_INTERVAL_MS / 1000,
      lastRunAt: healthCheckLastRunAt,
      checksExternalProviders: false
    }
  });

});

// =====================================
// STATUS API
// =====================================

app.get("/api/status", (req, res) => {

  function remaining(provider) {

    return isCoolingDown(provider)
      ? Math.ceil(
          (cooldowns[provider] - Date.now()) / 1000
        )
      : 0;
  }

  const providers = {
    gemini: {
      configured: Boolean(process.env.GEMINI_API_KEY),
      coolingDown: isCoolingDown("gemini"),
      cooldownRemainingSeconds: remaining("gemini")
    },

    groq: {
      configured: Boolean(process.env.GROQ_API_KEY),
      coolingDown: isCoolingDown("groq"),
      cooldownRemainingSeconds: remaining("groq")
    },

    openrouter: {
      configured: Boolean(process.env.OPENROUTER_API_KEY),
      coolingDown: isCoolingDown("openrouter"),
      cooldownRemainingSeconds: remaining("openrouter")
    }
  };

  res.json({
    success: true,
    message: "Master AI Bot server is running.",
    centralBrain: true,
    providers,
    models: {
      gemini: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      groq: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
      openrouter: process.env.OPENROUTER_MODEL || "openrouter/free"
    },
    providerOrder: ["Groq", "OpenRouter", "Gemini"],
    specialistHealth: selfHealingMonitor.snapshot(),
    healthCheck: {
      mode: "local_readiness",
      intervalSeconds: HEALTH_CHECK_INTERVAL_MS / 1000,
      lastRunAt: healthCheckLastRunAt,
      checksExternalProviders: false
    },
    approvalPolicy: "Proposal only: external actions require explicit user approval.",
    supabaseApprovalStorage: {
      configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_OWNER_USER_ID),
      authentication: "Supabase user access token + owner allowlist",
      executionEnabled: false
    },
    agentHistoryStorage: {
      configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      provider: "Supabase Postgres",
      table: "agent_task_history",
      ownerScoped: true
    },
    integrations: {
      youtube: {
        oauthConfigured: Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REDIRECT_URI && process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY),
        mode: "read_only"
      },
      agnesVideo: {
        apiKeyConfigured: Boolean(process.env.AGNES_API_KEY),
        enabled: String(process.env.AGNES_VIDEO_FREE_MODE_ENABLED || "").toLowerCase() === "true",
        model: "agnes-video-2.5-flash",
        requiresFreeTierVerification: true
      },
      affiliate: { campaignTrackingStorage: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), externalProgramApi: false },
      blogging: { draftStorage: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), cmsOAuth: false },
      seo: { searchConsoleOAuth: false },
      "app-development": { repositoryAutomation: false }
    },
    agents
  });

});

// =====================================
// WELCOME API
// =====================================

app.get("/api", (req, res) => {

  res.json({
    name: "Master AI Bot",
    message: "Welcome to your AI automation platform.",
    status: "Backend ready",
    centralBrain: true
  });

});

// =====================================
// CENTRAL BRAIN API
// =====================================

app.post("/api/brain", async (req, res) => {

  const task =
    typeof req.body?.task === "string"
      ? req.body.task.trim()
      : "";

  if (!task) {

    return res.status(400).json({
      success: false,
      error: "Please enter a task."
    });

  }

  if (task.length > 10000) {

    return res.status(400).json({
      success: false,
      error: "Please keep your task under 10,000 characters."
    });

  }

  if (
    !process.env.GEMINI_API_KEY &&
    !process.env.GROQ_API_KEY &&
    !process.env.OPENROUTER_API_KEY
  ) {

    return res.status(503).json({
      success: false,
      error: "No AI provider is configured."
    });

  }

  try {

    const reuseReportIds = parseSynthesisReuseRequest(task);
    const result = reuseReportIds
      ? await runSynthesisFromSavedReports(task, req.ownerUser?.id, reuseReportIds)
      : await runCentralBrain(task, req.ownerUser?.id, req.body?.channelId);
    await persistTaskHistory(req.ownerUser?.id, "master", task, result);

    return res.json(result);

  } catch (error) {

    console.error(
      "Central Brain failed:",
      error.message
    );
    await persistTaskHistory(req.ownerUser?.id, "master", task, null, error);

    return res.status(502).json({
      success: false,
      error: "The Central AI Brain could not complete this task.",
      details: error.message
    });

  }

});

// =====================================
// TASK API
// =====================================

app.post("/api/task", async (req, res) => {

  const task =
    typeof req.body?.task === "string"
      ? req.body.task.trim()
      : "";

  const agentId =
    typeof req.body?.agentId === "string"
      ? req.body.agentId
      : "master";

  if (!task) {

    return res.status(400).json({
      success: false,
      error: "Please enter a task."
    });

  }

  if (task.length > 10000) {

    return res.status(400).json({
      success: false,
      error: "Please keep your task under 10,000 characters."
    });

  }

  if (!agentInstructions[agentId]) {

    return res.status(400).json({
      success: false,
      error: "Invalid agent selected."
    });

  }

  if (
    !process.env.GEMINI_API_KEY &&
    !process.env.GROQ_API_KEY &&
    !process.env.OPENROUTER_API_KEY
  ) {

    return res.status(500).json({
  success: false,
  error: "No AI provider API key configured.",
  message: "Please configure GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY."
});
  }
  try {

    if (agentId === "master") {
      const result = await runCentralBrain(task, req.ownerUser?.id, req.body?.channelId);
      await persistTaskHistory(req.ownerUser?.id, agentId, task, result);
      return res.json(result);
    }

    let specialistTask = task;
    if (agentId === "youtube") {
      try {
        const channelContext = await getYoutubeAgentContext({ ownerId: req.ownerUser?.id, channelId: req.body?.channelId });
        if (channelContext) specialistTask = task + "\n\n" + channelContext;
      } catch (contextError) {
        console.log("YouTube channel context unavailable; continuing with the user request only:", contextError.message);
      }
    }

    const response = await generateAI(
      specialistTask,
      agentInstructions[agentId],
      2600
    );
    let specialistReport = response.result;
    let specialistProvider = response.provider;
    let qualityReview = reviewSpecialistReport(specialistReport);
    let reportRepaired = false;

    // Keep single-specialist mode consistent with Master Brain mode: make up
    // to two bounded attempts to fill missing required sections before review.
    for (let repairRound = 0; repairRound < 2 && (qualityReview.missingSections.length > 0 || qualityReview.thinSections.length > 0); repairRound += 1) {
      const repairSections = [...qualityReview.missingSections, ...qualityReview.thinSections.filter(section => !qualityReview.missingSections.includes(section))];
      const thinSections = [...qualityReview.thinSections];
      try {
        const repairInstructions = [
          "You are a specialist report completion editor.",
          "Do NOT rewrite, summarize, or repeat the original report.",
          "Generate ONLY the requested sections listed in the task, using the exact requested headings.",
          "For a missing section, add its heading and content. For a thin section, replace the empty or weak content under its existing heading with substantive content; do not duplicate its heading.",
          "Preserve the specialist role, original task, country, budget, device and skill constraints.",
          "Do not invent research, sources, prices, commissions, metrics, test results, or completed actions.",
          "When evidence is unavailable, state 'Needs live verification' and identify the source or measurement required.",
          "Return only the missing sections, with no introduction or conclusion."
        ].join("\n");
        const repairTask =
          "ORIGINAL SPECIALIST TASK:\n" + specialistTask.slice(0, 2500) +
          "\n\nSECTIONS TO COMPLETE (ONLY THESE):\n" +
          repairSections.map(section => "## " + section).join("\n") +
          "\n\nORIGINAL REPORT — PRESERVE IT, DO NOT REWRITE:\n" +
          compactReport(specialistReport, 5200);
        const repair = await generateAI(repairTask, repairInstructions, 1500);
        if (!repair.result || !repair.result.trim()) break;
        specialistReport = mergeMissingReportSections(specialistReport, repair.result, { replaceSections: thinSections });
        specialistProvider = [...new Set([specialistProvider, repair.provider])].join(" + ");
        qualityReview = reviewSpecialistReport(specialistReport);
        reportRepaired = true;
      } catch (repairError) {
        console.error(agentId + " missing-section repair failed:", repairError.message);
        break;
      }
    }

    const qualityPassed = qualityReview.status === "passed";
    const qualityFailure = qualityPassed
      ? undefined
      : "Report requires attention: " + [
          ...qualityReview.missingSections.map(section => "Missing section: " + section),
          ...qualityReview.warnings
        ].join("; ");
    selfHealingMonitor.record(agentId, {
      success: qualityPassed,
      failureType: "report_quality",
      error: qualityFailure
    });

    const taskResponse = {
      success: qualityPassed,
      needsAttention: !qualityPassed,
      ...(qualityFailure ? { error: qualityFailure } : {}),
      agent: agentId,
      provider: specialistProvider,
      reportRepaired,
      qualityReview,
      requiresHumanApproval: true,
      executionMode: "proposal_only",
      approvalNotice: "This is a draft. Review it before publishing, spending, sending, deleting, or deploying anything.",
      result: specialistReport
    };
    await persistTaskHistory(req.ownerUser?.id, agentId, task, taskResponse);
    return res.json(taskResponse);

  } catch (error) {

    console.error("Task API failed:", error.message);
    if (agentId !== "master") {
      selfHealingMonitor.record(agentId, {
        success: false,
        failureType: inferFailureType(error.message),
        error: error.message
      });
    }

    await persistTaskHistory(req.ownerUser?.id, agentId, task, null, error);
    return res.status(502).json({
      success: false,
      error: "The selected AI agent could not complete this task.",
      details: error.message
    });

  }

});

// =====================================
// START SERVER
// =====================================

app.listen(PORT, () => {
  console.log(`Master AI Bot running on port ${PORT}`);
});
