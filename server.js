import express from "express";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

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

const agentInstructions = {
  master:
    "You are the Master AI Bot. Break tasks into clear steps. " +
    "Identify relevant specialist agents. Be realistic and never " +
    "claim work was executed or tested unless it actually was.",

  affiliate:
    "You are the Affiliate Marketing specialist. Help with ethical " +
    "product research, commission calculations, content planning, " +
    "and affiliate disclosures. Never invent live prices or rates.",

  youtube:
    "You are the YouTube specialist. Create original video ideas, " +
    "scripts, titles, descriptions, and channel plans.",

  blogging:
    "You are the Blogging specialist. Create original, useful " +
    "article outlines and drafts. Do not invent sources.",

  "app-development":
    "You are the App Development specialist. Explain architecture, " +
    "generate code when requested, and provide testing steps.",

  seo:
    "You are the SEO specialist. Suggest keywords, useful content, " +
    "site structure, and ethical search optimisation. Never " +
    "guarantee rankings."
};

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy"
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    message: "Master AI Bot server is running.",
    providers: {
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      groqConfigured: Boolean(process.env.GROQ_API_KEY),
      geminiModel:
        process.env.GEMINI_MODEL || "gemini-3.8-flash"
    },
    agents
  });
});

app.get("/api", (req, res) => {
  res.json({
    name: "Master AI Bot",
    message: "Welcome to your AI automation platform.",
    status: "Backend ready"
  });
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTemporaryError(error) {
  const message = String(error?.message || error);

  return (
    /\b(429|500|502|503|504)\b/.test(message) ||
    /UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|timed out|timeout/i
      .test(message)
  );
}

async function callGemini(task, instructions) {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });

  let lastError;

  // Two attempts: original request plus one retry.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
        contents: task,
        config: {
          systemInstruction: instructions
        }
      });

      const result = response.text;

      if (!result) {
        throw new Error("Gemini returned no text.");
      }

      return result;
    } catch (error) {
      lastError = error;

      if (!isTemporaryError(error) || attempt === 1) {
        break;
      }

      await wait(1500);
    }
  }

  throw lastError;
}

async function callGroq(task, instructions) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Groq backup is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

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
          model:
            process.env.GROQ_MODEL || "openai/gpt-oss-20b",
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
          temperature: 0.7,
          max_completion_tokens: 2048
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      const details = await response.text();

      // Log diagnostic information without printing API keys.
      console.error("Groq API error:", response.status, details);

      throw new Error(`Groq API returned HTTP ${response.status}.`);
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content;

    if (!result) {
      throw new Error("Groq returned no text.");
    }

    return result;
  } finally {
    clearTimeout(timeout);
  }
}

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
      error: "Unknown agent selected."
    });
  }

  if (
    !process.env.GEMINI_API_KEY &&
    !process.env.GROQ_API_KEY
  ) {
    return res.status(503).json({
      success: false,
      error: "No AI provider is configured."
    });
  }

  const instructions = agentInstructions[agentId];
  const failures = [];

  // Try Gemini first.
  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await callGemini(task, instructions);

      return res.json({
        success: true,
        agent: agentId,
        provider: "Gemini",
        result
      });
    } catch (error) {
      console.error("Gemini failed:", error.message);
      failures.push("Gemini: " + error.message);
    }
  }

  // Automatically try Groq if Gemini fails.
  if (process.env.GROQ_API_KEY) {
    try {
      const result = await callGroq(task, instructions);

      return res.json({
        success: true,
        agent: agentId,
        provider: "Groq (backup)",
        result
      });
    } catch (error) {
      console.error("Groq failed:", error.message);
      failures.push("Groq: " + error.message);
    }
  }

  return res.status(502).json({
    success: false,
    error:
      "All configured AI providers failed. Please try again later.",
    details: failures
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Master AI Bot running on port ${PORT}`);
});
