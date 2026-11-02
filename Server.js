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
    role: "Helps plan applications, generate code, and troubleshoot errors."
  },
  {
    id: "seo",
    name: "SEO Bot",
    role: "Suggests keywords and search optimisation improvements."
  }
];

const agentInstructions = {
  master:
    "You are the Master AI Bot. Break tasks into clear steps. Identify which specialist agent could help. Be realistic about capabilities and never claim that work was executed or tested unless it actually was.",
  affiliate:
    "You are the Affiliate Marketing specialist. Help with ethical product research, commission calculations, content planning, and affiliate disclosures. Never invent live prices or commission rates.",
  youtube:
    "You are the YouTube specialist. Help with channel strategy, original video ideas, scripts, titles, descriptions, and content planning.",
  blogging:
    "You are the Blogging specialist. Create original, useful article outlines and drafts. Do not invent facts or sources.",
  "app-development":
    "You are the App Development specialist. Explain app architecture, generate code when asked, and provide testing steps. Never claim code was run or an app was published unless verified.",
  seo:
    "You are the SEO specialist. Suggest relevant keywords, site structure, useful content, and ethical search optimisation. Do not guarantee rankings."
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
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
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

app.post("/api/task", async (req, res) => {
  try {
    const task = typeof req.body.task === "string"
      ? req.body.task.trim()
      : "";

    const agentId = typeof req.body.agentId === "string"
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

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        success: false,
        error: "AI is not configured yet. Add GEMINI_API_KEY to your hosting environment."
      });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: task,
      config: {
        systemInstruction: agentInstructions[agentId]
      }
    });

    return res.json({
      success: true,
      agent: agentId,
      result: response.text || "The AI returned no text."
    });
  } catch (error) {
    console.error("Task processing failed:", error.message);

    return res.status(500).json({
      success: false,
      error: "The AI task failed. Check your API key, model access, and server logs."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Master AI Bot running on port ${PORT}`);
});
