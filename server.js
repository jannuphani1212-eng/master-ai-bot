import express from "express";
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
import { createSupabaseApprovalHandlers } from "./lib/supabase-approvals.js";
import { createOwnerAuthMiddleware } from "./lib/owner-auth.js";
import { createYoutubeIntegrationHandlers, getYoutubeAgentContext } from "./lib/youtube-integration.js";
import { createAgentHistoryHandlers } from "./lib/supabase-task-history.js";
import { parseSynthesisReuseRequest, validateSavedSpecialistReports } from "./lib/synthesis-reuse.js";
import { createAgentPortfolioHandlers } from "./lib/agent-portfolio.js";
import { createAuditMiddleware } from "./lib/audit-log.js";

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
const agentPortfolioHandlers = createAgentPortfolioHandlers();
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
          metadata: { qualityReview: item.qualityReview || null }
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
        specialistReportIds: data?.reusedReports ? data.reusedReportIds : specialistReportIds
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
app.use(["/api/task", "/api/brain", "/api/repair-proposals", "/api/agent-history", "/api/agent-portfolio", "/api/youtube", "/api/approvals"], limitApiRequests);
app.use(["/api/task", "/api/brain", "/api/repair-proposals", "/api/agent-history", "/api/agent-portfolio"], requireOwner);
app.use(["/api/task", "/api/brain", "/api/repair-proposals", "/api/agent-history", "/api/agent-portfolio"], auditOwnerRequests);
app.get("/api/agent-history", agentHistoryHandlers.list);
app.get("/api/agent-portfolio", agentPortfolioHandlers.get);
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

async function runCentralBrain(task, ownerUserId) {

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
      if (item.agentId === "youtube" && ownerUserId) {
        try {
          const channelContext = await getYoutubeAgentContext({ ownerId: ownerUserId });
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
        2600
      );

      let specialistReport = response.result;
      let specialistProvider = response.provider;
      let qualityReview = reviewSpecialistReport(specialistReport);
      let reportRepaired = false;

      // Repair only absent sections. Use at most two bounded passes so a
      // short or partially truncated repair cannot leave easy omissions behind.
      // Each pass recalculates missing sections and preserves the original draft.
      for (let repairRound = 0; repairRound < 2 && qualityReview.missingSections.length > 0; repairRound += 1) {
        const missingSections = qualityReview.missingSections;
        try {
          const repairInstructions = [
            "You are a specialist report completion editor.",
            "Do NOT rewrite, summarize, or repeat the original report.",
            "Generate ONLY the missing sections listed in the task, using the exact requested headings.",
            "Preserve the specialist's original role, task context, and constraints.",
            "Do not invent research, sources, prices, commissions, metrics, test results, or completed actions.",
            "When evidence is unavailable, state 'Needs live verification' and specify exactly what source or measurement is required.",
            "When a KPI baseline is unavailable, describe how to measure it first; do not invent a target.",
            "Complete every listed section in this response. Keep each section concise but useful.",
            "Return only the missing sections, with no introduction or conclusion."
          ].join("\\n");

          const repairTask =
            "ORIGINAL SPECIALIST TASK:\\n" + item.task.slice(0, 2500) +
            "\\n\\nMISSING SECTIONS TO GENERATE (ONLY THESE):\\n" +
            missingSections.map(section => "## " + section).join("\\n") +
            "\\n\\nORIGINAL REPORT — PRESERVE IT, DO NOT REWRITE:\\n" +
            compactReport(specialistReport, 5200);

          const repair = await generateAI(repairTask, repairInstructions, 1500);
          if (!repair.result || !repair.result.trim()) break;

          specialistReport = mergeMissingReportSections(specialistReport, repair.result);
          specialistProvider = [...new Set([specialistProvider, repair.provider])].join(" + ");
          providersUsed.add(repair.provider);
          qualityReview = reviewSpecialistReport(specialistReport);
          reportRepaired = true;
        } catch (repairError) {
          console.error(agent.name + " missing-section repair pass " + (repairRound + 1) + " failed:", repairError.message);
          break;
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

  try {

    const synthesis = await generateAI(
      "ORIGINAL USER TASK:\n" +
      task.slice(0, 2500) +
      "\n\nSPECIALIST REPORTS:\n" +
      specialistSummary,
      synthesisInstructions,
      2000
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
    `**Average structural quality:** ${scoredResults.length ? Math.round(scoredResults.reduce((sum, item) => sum + (item.qualityReview?.score || 0), 0) / scoredResults.length) + "/100" : "Not available"} (structure-only; factual accuracy is not independently verified).`,
    nonPassingResults.length
      ? "**Overall status:** Partial completion / needs attention. Do not treat this task as fully completed."
      : "**Overall status:** All requested specialists passed execution and structural quality checks."
  ].join("\n");

  finalResult = finalResult + "\n\n" + executionAudit;

  return {
    success: nonPassingResults.length === 0 && specialistResults.length > 0,
    partialSuccess: successfulResults.length > 0 && nonPassingResults.length > 0,
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
    "ORIGINAL REPORT:\n" + compactReport(item.result, 5200)
  ).join("\n\n--------------------\n\n");
  const synthesis = await generateAI(
    "SYNTHESIS ONLY. Do not execute, plan, or rerun specialists.\n" +
    "Owner synthesis request:\n" + task.replace(/^\s*SYNTHESIS_ONLY_REPORT_IDS\s*:.*$/im, "").slice(0, 3000) +
    "\n\nEXACTLY FIVE OWNER-VERIFIED SAVED REPORTS:\n" + reportContext,
    "Synthesize only the five supplied saved reports. Do not invent sources or claim research not present in them. Resolve conflicts, prioritize India and zero-investment constraints where stated, separate verified facts from assumptions, and identify unsupported claims. Do not claim any specialist was executed. Return a useful unified plan.",
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
app.get("/api/youtube/oauth/callback", youtubeHandlers.callback);
// OAuth callback is public but rate-limited; every other YouTube route is owner-only.
app.use("/api/youtube", requireOwner);
app.use("/api/youtube", auditOwnerRequests);
app.get("/api/youtube/connect-url", youtubeHandlers.connectUrl);
app.get("/api/youtube/status", youtubeHandlers.status);
app.get("/api/youtube/channel", youtubeHandlers.channel);
app.get("/api/youtube/videos", youtubeHandlers.videos);
app.get("/api/youtube/analytics", youtubeHandlers.analytics);

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
      : await runCentralBrain(task, req.ownerUser?.id);
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
      const result = await runCentralBrain(task, req.ownerUser?.id);
      await persistTaskHistory(req.ownerUser?.id, agentId, task, result);
      return res.json(result);
    }

    let specialistTask = task;
    if (agentId === "youtube") {
      try {
        const channelContext = await getYoutubeAgentContext({ ownerId: req.ownerUser?.id });
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
    for (let repairRound = 0; repairRound < 2 && qualityReview.missingSections.length > 0; repairRound += 1) {
      const missingSections = qualityReview.missingSections;
      try {
        const repairInstructions = [
          "You are a specialist report completion editor.",
          "Do NOT rewrite, summarize, or repeat the original report.",
          "Generate ONLY the missing sections listed in the task, using the exact requested headings.",
          "Preserve the specialist role, original task, country, budget, device and skill constraints.",
          "Do not invent research, sources, prices, commissions, metrics, test results, or completed actions.",
          "When evidence is unavailable, state 'Needs live verification' and identify the source or measurement required.",
          "Return only the missing sections, with no introduction or conclusion."
        ].join("\n");
        const repairTask =
          "ORIGINAL SPECIALIST TASK:\n" + specialistTask.slice(0, 2500) +
          "\n\nMISSING SECTIONS TO GENERATE (ONLY THESE):\n" +
          missingSections.map(section => "## " + section).join("\n") +
          "\n\nORIGINAL REPORT — PRESERVE IT, DO NOT REWRITE:\n" +
          compactReport(specialistReport, 5200);
        const repair = await generateAI(repairTask, repairInstructions, 1500);
        if (!repair.result || !repair.result.trim()) break;
        specialistReport = mergeMissingReportSections(specialistReport, repair.result);
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
