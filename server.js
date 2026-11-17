import express from "express";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { fallbackAgentSelection, requestsAllSpecialists } from "./lib/routing.js";
import { runProviderFallback } from "./lib/provider-fallback.js";
import { resolveProviderOrder } from "./lib/provider-order.js";
import { getOpenRouterMaxTokens } from "./lib/openrouter-request.js";
import { extractCompletionText } from "./lib/completion-text.js";
import { getMasterInstructions, getSpecialistInstructions } from "./lib/specialist-prompts.js";
import { reviewSpecialistReport } from "./lib/quality-review.js";
import { createSupabaseApprovalHandlers } from "./lib/supabase-approvals.js";
import { createOwnerAuthMiddleware } from "./lib/owner-auth.js";
import { createYoutubeIntegrationHandlers, getYoutubeAgentContext } from "./lib/youtube-integration.js";
import { createAffiliateCampaignHandlers } from "./lib/affiliate-campaigns.js";
import { createInstagramIntegrationHandlers } from "./lib/instagram-integration.js";
import { createSearchConsoleHandlers } from "./lib/search-console-integration.js";
import { createBlogDraftHandlers } from "./lib/blog-drafts.js";
import { createBlogCmsHandlers } from "./lib/blog-cms-integration.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Render runs behind a trusted reverse proxy. This allows req.ip to identify
// the originating client for the lightweight API request limit below.
app.set("trust proxy", 1);

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
app.use(["/api/task", "/api/brain"], requireOwner);
app.use(["/api/task", "/api/brain"], limitApiRequests);
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

function getRetrySeconds(message) {
  const match = String(message).match(
    /try again in ([\d.]+)\s*s/i
  );

  if (match) {
    return Math.min(
      120,
      Math.max(10, Math.ceil(Number(match[1])))
    );
  }

  return 60;
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
      httpOptions: { timeout: 45000 }
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
    45000
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
        setCooldown("groq", getRetrySeconds(details));
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
    45000
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
          max_tokens: getOpenRouterMaxTokens(maxTokens)
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {

      const details = await response.text();

      if (response.status === 429) {
        setCooldown("openrouter", getRetrySeconds(details));
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
  const providerCatalog = {
    groq: {
      id: "groq",
      name: "Groq",
      key: "GROQ_API_KEY",
      call: callGroq
    },
    openrouter: {
      id: "openrouter",
      name: "OpenRouter",
      key: "OPENROUTER_API_KEY",
      call: callOpenRouter
    },
    gemini: {
      id: "gemini",
      name: "Gemini",
      key: "GEMINI_API_KEY",
      call: callGemini
    }
  };
  const providerOrder = resolveProviderOrder(
    process.env.AI_PROVIDER_ORDER,
    Object.keys(providerCatalog)
  );
  const providers = providerOrder.map(id => providerCatalog[id]).map(provider => ({
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
    return {
      tasks: specialistAgents.map(agent => ({
        agentId: agent.id,
        task
      })),
      provider: "Fallback selection"
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
    throw new Error("No suitable specialist selected.");
  }

  return {
    tasks: validTasks,
    provider: response.provider
  };
}

// =====================================
// LIMIT SPECIALIST REPORT SIZE
// =====================================

function compactReport(text, maxLength = 1800) {

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

async function runCentralBrain(task, ownerUserId, youtubeChannelId) {

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

  if (planningProvider !== "Fallback selection") {
    providersUsed.add(planningProvider);
  }

  // Execute specialists sequentially.
  for (const item of plan.tasks) {

    const agent = specialistAgents.find(
      a => a.id === item.agentId
    );

    if (!agent) continue;

    try {

      let specialistTask = item.task;
      if (item.agentId === "youtube" && ownerUserId) {
        try {
          const channelContext = await getYoutubeAgentContext({ ownerId: ownerUserId, channelId: youtubeChannelId });
          if (channelContext) {
            specialistTask = item.task + "\n\n" + channelContext;
          }
        } catch (contextError) {
          console.log("YouTube channel context unavailable; continuing with the user request only:", contextError.message);
        }
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
        700
      );

      let specialistReport = response.result;
      let specialistProvider = response.provider;
      let qualityReview = reviewSpecialistReport(specialistReport);
      let reportRepaired = false;

      // Automatically repair incomplete reports once before showing them to the user.
      // The repair prompt forbids inventing evidence, metrics, research or completed actions.
      if (qualityReview.missingSections.length > 0 || qualityReview.riskyClaims?.length > 0 || !qualityReview.evidenceAware || !qualityReview.actionable) {
        try {
          const repairInstructions = [
            "You are a strict specialist report editor.",
            "Rewrite the supplied specialist draft into the exact eight-section report format below.",
            "Keep the original task and specialist role. Do not invent facts, research, sources, prices, commissions, metrics, test results or completed actions.",
            "If information is missing, explicitly write 'Not provided' or 'Needs live verification' and state a reasonable assumption only when clearly labelled.",
            "Make the report useful and specific. Include concrete deliverables and exactly three next actions.",
            "Use these exact Markdown headings, each on its own line:",
            "## 1. Executive summary",
            "## 2. Audience and assumptions",
            "## 3. Research and evidence",
            "## 4. Recommended strategy",
            "## 5. Concrete deliverables",
            "## 6. Measurement and KPIs",
            "## 7. Risks and quality checks",
            "## 8. Next three actions",
            "Return only the completed report."
          ].join("\n");

          const repair = await generateAI(
            "ORIGINAL TASK:\\n" + item.task.slice(0, 2500) +
            "\\n\\nSPECIALIST DRAFT TO IMPROVE:\\n" + compactReport(specialistReport, 3500),
            repairInstructions,
            1100
          );

          if (repair.result && repair.result.trim()) {
            specialistReport = repair.result.trim();
            specialistProvider = [...new Set([response.provider, repair.provider])].join(" + ");
            qualityReview = reviewSpecialistReport(specialistReport);
            reportRepaired = true;
            providersUsed.add(repair.provider);
          }
        } catch (repairError) {
          console.error(agent.name + " report repair failed:", repairError.message);
        }
      }

      providersUsed.add(response.provider);

      specialistResults.push({
        agentId: item.agentId,
        name: agent.name,
        success: true,
        provider: specialistProvider,
        reportRepaired,
        qualityReview,
        result: specialistReport
      });

    } catch (error) {

      console.error(
        `${agent.name} failed:`,
        error.message
      );

      specialistResults.push({
        agentId: item.agentId,
        name: agent.name,
        success: false,
        provider: null,
        error: String(error.message || "Unknown provider error").slice(0, 300),
        result: "This specialist could not complete the task."
      });
    }
  }

  const successfulResults =
    specialistResults.filter(item => item.success);

  if (successfulResults.length === 0) {
    throw new Error(
      "The specialist bots could not complete the task."
    );
  }

  const specialistSummary = successfulResults
    .map(item =>
      `SPECIALIST: ${item.name}\n` +
      `VERIFIED PROVIDER: ${item.provider || "Not available"}\n` +
      `STRUCTURAL QUALITY REVIEW: ${item.qualityReview?.score ?? "Not scored"}/100 (${item.qualityReview?.status || "not available"})\n` +
      (item.qualityReview?.warnings?.length
        ? `QUALITY WARNINGS: ${item.qualityReview.warnings.join("; ")}\n`
        : "") +
      compactReport(item.result, 1800)
    )
    .join("\n\n--------------------\n\n");

  const synthesisInstructions =
    "You are the Master AI Bot. Combine the specialist " +
    "reports into one useful final answer. " +
    "Remove repetition. Compare recommendations. " +
    "Identify the best strategy. Provide practical next steps. " +
    "Preserve important facts. Never invent information. " +
    "Do not guess or invent AI provider names. Provider identity is supplied " +
    "separately by verified server metadata; do not claim a provider unless " +
    "that exact name appears in the metadata. " +
    "Do not mark a missing or failed specialist as successful. " +
    "Keep the final answer clear and concise.";

  let finalResult;

  try {

    const synthesis = await generateAI(
      "ORIGINAL USER TASK:\n" +
      task.slice(0, 2500) +
      "\n\nSPECIALIST REPORTS:\n" +
      specialistSummary,
      synthesisInstructions,
      1200
    );

    providersUsed.add(synthesis.provider);

    finalResult = synthesis.result;

    console.log("Final AI synthesis successful.");

  } catch (error) {

    console.error(
      "Final synthesis failed:",
      error.message
    );

    finalResult =
      "The specialist bots completed their reports, " +
      "but the final AI synthesis was unavailable. " +
      "Here are the collected reports:\n\n" +
      specialistSummary;
  }

  const failedResults = specialistResults.filter(item => !item.success);

  // Build the audit from actual server results, not model-generated claims.
  const executionAudit = [
    "",
    "## Verified specialist execution audit",
    "| Specialist | Result | Actual provider | Structural quality |",
    "|---|---|---|---|",
    ...specialistResults.map(item =>
      `| ${item.name} | ${item.success ? "Success" : "Failed"} | ${item.provider || "No successful provider"} | ${item.qualityReview ? item.qualityReview.score + "/100 (" + item.qualityReview.status + ")" : "Not scored"} |`
    ),
    "",
    `**Verified totals:** ${successfulResults.length}/${specialistResults.length} requested specialists succeeded; ${failedResults.length} failed.`,
    `**Average structural quality:** ${successfulResults.length ? Math.round(successfulResults.reduce((sum, item) => sum + (item.qualityReview?.score || 0), 0) / successfulResults.length) + "/100" : "Not available"} (structure-only; factual accuracy is not independently verified).`,
    failedResults.length
      ? "**Overall status:** Partial completion. Do not treat this task as fully completed."
      : "**Overall status:** All requested specialists completed successfully."
  ].join("\n");

  finalResult = finalResult + "\n\n" + executionAudit;

  return {
    success: failedResults.length === 0 && specialistResults.length > 0,
    partialSuccess: successfulResults.length > 0 && failedResults.length > 0,
    agent: "master",
    provider: [...providersUsed].join(" + ") || "Unknown",
    totalSpecialists: specialistResults.length,
    successfulSpecialists: successfulResults.length,
    failedSpecialists: failedResults.length,
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

// =====================================
// OWNER-ONLY YOUTUBE CHANNEL INTEGRATION
// =====================================

const youtubeHandlers = createYoutubeIntegrationHandlers();

// OAuth callback is intentionally public, but accepts only a short-lived,
// HMAC-signed state created after a verified owner session.
app.get("/api/youtube/oauth/callback", youtubeHandlers.callback);
app.use("/api/youtube", requireOwner);
app.use("/api/youtube", limitApiRequests);
app.get("/api/youtube/connect-url", youtubeHandlers.connectUrl);
app.get("/api/youtube/status", youtubeHandlers.status);
app.get("/api/youtube/channel", youtubeHandlers.channel);
app.get("/api/youtube/videos", youtubeHandlers.videos);
app.get("/api/youtube/analytics", youtubeHandlers.analytics);

// =====================================
// OWNER-ONLY AFFILIATE CAMPAIGN STUDIO
// =====================================

const affiliateHandlers = createAffiliateCampaignHandlers({ generateAI });

// Public redirect endpoint only redirects to an owner-approved HTTPS URL
// stored in the database; it never accepts an arbitrary destination URL.
app.get("/r/:campaignId", limitApiRequests, affiliateHandlers.trackClick);

app.use("/api/affiliate", requireOwner);
app.use("/api/affiliate", limitApiRequests);
app.get("/api/affiliate/campaigns", affiliateHandlers.list);
app.post("/api/affiliate/campaigns", affiliateHandlers.generate);
app.post("/api/affiliate/campaigns/:id/approve", affiliateHandlers.approve);
app.get("/api/affiliate/campaigns/:id/clicks", affiliateHandlers.clicks);
app.get("/api/affiliate/commissions", affiliateHandlers.listCommissions);
app.post("/api/affiliate/commissions/import", affiliateHandlers.importCommissions);
app.post("/api/affiliate/commissions/:id/verify", affiliateHandlers.verifyCommission);

// =====================================
// INSTAGRAM PROFESSIONAL ACCOUNT LINK
// =====================================

const instagramHandlers = createInstagramIntegrationHandlers();

// OAuth callback is public but state-signed and rate-limited.
app.get("/api/instagram/oauth/callback", limitApiRequests, instagramHandlers.callback);
app.use("/api/instagram", requireOwner);
app.use("/api/instagram", limitApiRequests);
app.get("/api/instagram/connect-url", instagramHandlers.connectUrl);
app.get("/api/instagram/status", instagramHandlers.status);
app.post("/api/instagram/publish-requests", instagramHandlers.createPublishRequest);
app.get("/api/instagram/publish-requests", instagramHandlers.listPublishRequests);
app.post("/api/instagram/publish-requests/:id/prepare", instagramHandlers.prepareApprovedReel);
app.get("/api/instagram/publish-requests/:id/status", instagramHandlers.publishStatus);
app.post("/api/instagram/publish-requests/:id/publish", instagramHandlers.publishApprovedReel);

// =====================================
// GOOGLE SEARCH CONSOLE — READ ONLY
// =====================================

const searchConsoleHandlers = createSearchConsoleHandlers();
app.get("/api/seo/search-console/oauth/callback", limitApiRequests, searchConsoleHandlers.callback);
app.use("/api/seo/search-console", requireOwner);
app.use("/api/seo/search-console", limitApiRequests);
app.get("/api/seo/search-console/connect-url", searchConsoleHandlers.connectUrl);
app.get("/api/seo/search-console/sites", searchConsoleHandlers.sites);
app.post("/api/seo/search-console/query", searchConsoleHandlers.query);

// =====================================
// OWNER-ONLY BLOG DRAFT STUDIO
// =====================================

const blogDraftHandlers = createBlogDraftHandlers({ generateAI });
app.use("/api/blog/drafts", requireOwner);
app.use("/api/blog/drafts", limitApiRequests);
app.get("/api/blog/drafts", blogDraftHandlers.list);
app.post("/api/blog/drafts", blogDraftHandlers.generate);
app.patch("/api/blog/drafts/:id", blogDraftHandlers.update);
app.post("/api/blog/drafts/:id/decision", blogDraftHandlers.decide);

// =====================================
// BLOGGER + WORDPRESS.COM DRAFT CONNECTORS
// =====================================

const blogCmsHandlers = createBlogCmsHandlers();
app.get("/api/blog/cms/:provider/callback", limitApiRequests, blogCmsHandlers.callback);
app.use("/api/blog/cms", requireOwner);
app.use("/api/blog/cms", limitApiRequests);
app.get("/api/blog/cms/:provider/connect-url", blogCmsHandlers.connectUrl);
app.get("/api/blog/cms/connections", blogCmsHandlers.connections);
app.post("/api/blog/cms/:provider/select", blogCmsHandlers.selectSite);
app.post("/api/blog/cms/drafts/:id/save", blogCmsHandlers.saveDraft);

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

app.use("/api/approvals", limitApiRequests);
app.get("/api/approvals", approvalHandlers.list);
app.post("/api/approvals", approvalHandlers.create);
app.patch("/api/approvals/:id/decision", approvalHandlers.decide);

app.get("/api/health", (req, res) => {

  res.json({
    success: true,
    status: "healthy"
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
    providerOrder: resolveProviderOrder(process.env.AI_PROVIDER_ORDER, ["groq", "openrouter", "gemini"]).map(id => ({ groq: "Groq", openrouter: "OpenRouter", gemini: "Gemini" })[id]),
    approvalPolicy: "Proposal only: external actions require explicit user approval.",
    supabaseApprovalStorage: {
      configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_OWNER_USER_ID),
      authentication: "Supabase user access token + owner allowlist",
      executionEnabled: false
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

    const result = await runCentralBrain(task, req.ownerUser?.id);

    return res.json(result);

  } catch (error) {

    console.error(
      "Central Brain failed:",
      error.message
    );

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
  const youtubeChannelId =
    typeof req.body?.youtubeChannelId === "string" &&
    req.body.youtubeChannelId.length <= 128
      ? req.body.youtubeChannelId
      : undefined;

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
      const result = await runCentralBrain(task, req.ownerUser?.id, youtubeChannelId);
      return res.json(result);
    }

    let specialistTask = task;
    if (agentId === "youtube") {
      try {
        const channelContext = await getYoutubeAgentContext({ ownerId: req.ownerUser?.id, channelId: youtubeChannelId });
        if (channelContext) specialistTask = task + "\n\n" + channelContext;
      } catch (contextError) {
        console.log("YouTube channel context unavailable; continuing with the user request only:", contextError.message);
      }
    }

    const response = await generateAI(
      specialistTask,
      agentInstructions[agentId],
      1200
    );

    return res.json({
      success: true,
      agent: agentId,
      provider: response.provider,
      qualityReview: reviewSpecialistReport(response.result),
      requiresHumanApproval: true,
      executionMode: "proposal_only",
      approvalNotice: "This is a draft. Review it before publishing, spending, sending, deleting, or deploying anything.",
      result: response.result
    });

  } catch (error) {

    console.error("Task API failed:", error.message);

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
