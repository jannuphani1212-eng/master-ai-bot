import express from "express";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { fallbackAgentSelection, requestsAllSpecialists } from "./lib/routing.js";
import { runProviderFallback } from "./lib/provider-fallback.js";

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

app.use(["/api/task", "/api/brain"], limitApiRequests);

app.use(express.json({ limit: "1mb" }));
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
  master:
    "You are the CEO and coordinator of Master AI Bot. Understand the goal, " +
    "delegate to the most relevant specialists, compare their work, resolve " +
    "conflicts, and deliver one practical plan. State assumptions and risks. " +
    "Never claim an external action was executed. All publishing, spending, " +
    "sending, deleting, account changes, and deployment require explicit user approval.",

  affiliate:
    "You are the Affiliate Marketing specialist for an India-first business. " +
    "Create ethical product-research plans, commission calculations, comparison " +
    "criteria, Telugu and English content angles when relevant, and clear affiliate " +
    "disclosures. Never invent current prices, commission rates, stock, or approvals. " +
    "Give a low-cost action plan and measurable conversion KPIs. Do not promise income.",

  youtube:
    "You are the YouTube specialist. Create original channel strategies, audience " +
    "ideas, scripts, hooks, titles, descriptions, thumbnail concepts, and retention " +
    "plans. Respect the requested language and audience. Flag copyright, child-safety, " +
    "and platform-policy risks. Never promise views or revenue.",

  blogging:
    "You are the Blogging specialist. Create original, useful, well-structured " +
    "articles with search intent, headings, internal-link ideas, and clear calls to " +
    "action. Do not fabricate research, citations, quotations, or statistics. Mark " +
    "facts that need verification before publication.",

  "app-development":
    "You are the App Development specialist. Prefer beginner-friendly, mobile-first " +
    "solutions when appropriate. Provide complete runnable files rather than fragments, " +
    "explain where each file goes, include validation and testing steps, and identify " +
    "security, hosting, and maintenance costs. Never claim code was tested unless it was.",

  seo:
    "You are the SEO specialist. Build practical keyword clusters, search-intent maps, " +
    "technical and on-page checklists, content briefs, and ethical link-building plans. " +
    "Do not guarantee rankings or invent search volumes. Separate verified facts from estimates."
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
      temperature: 0.4
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

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
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
          max_completion_tokens: maxTokens
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

    const result =
      data.choices?.[0]?.message?.content;

    if (!result) {
      throw new Error("Groq returned no text.");
    }

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
          max_tokens: maxTokens
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

    const result =
      data.choices?.[0]?.message?.content;

    if (!result) {
      throw new Error("OpenRouter returned no text.");
    }

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
  const providers = [
    {
      id: "gemini",
      name: "Gemini",
      key: "GEMINI_API_KEY",
      call: callGemini
    },
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
    }
  ].map((provider) => ({
    ...provider,
    available: Boolean(process.env[provider.key]),
    call: () => provider.call(task, instructions, maxTokens)
  }));

  return runProviderFallback(providers, {
    isCoolingDown,
    onFailure(provider, error) {
      console.error(`${provider.name} failed:`, error.message);

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

  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("AI did not return valid JSON.");
  }

  return JSON.parse(
    cleaned.slice(start, end + 1)
  );
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

async function runCentralBrain(task) {

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

      const conciseInstructions =
        agentInstructions[item.agentId] +
        " Keep your report concise, practical and structured. " +
        "Prioritise important findings and actionable recommendations. " +
        "Avoid repeating the user's task.";

      const response = await generateAI(
        item.task,
        conciseInstructions,
        700
      );

      providersUsed.add(response.provider);

      specialistResults.push({
        agentId: item.agentId,
        name: agent.name,
        success: true,
        result: response.result
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
      compactReport(item.result, 1800)
    )
    .join("\n\n--------------------\n\n");

  const synthesisInstructions =
    "You are the Master AI Bot. Combine the specialist " +
    "reports into one useful final answer. " +
    "Remove repetition. Compare recommendations. " +
    "Identify the best strategy. Provide practical next steps. " +
    "Preserve important facts. Never invent information. " +
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
// HEALTH API
// =====================================

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
    providerOrder: ["Gemini", "Groq", "OpenRouter"],
    approvalPolicy: "Proposal only: external actions require explicit user approval.",
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

    const result = await runCentralBrain(task);

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
      const result = await runCentralBrain(task);
      return res.json(result);
    }

    const response = await generateAI(
      task,
      agentInstructions[agentId],
      1200
    );

    return res.json({
      success: true,
      agent: agentId,
      provider: response.provider,
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
