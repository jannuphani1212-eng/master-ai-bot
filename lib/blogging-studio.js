function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw new Error(key + " is not configured on the server.");
  return value;
}

function config(env) {
  return {
    supabaseUrl: required(env, "SUPABASE_URL").replace(/\/+$/, ""),
    serviceKey: required(env, "SUPABASE_SERVICE_ROLE_KEY")
  };
}

async function supabaseRequest(cfg, path, options = {}) {
  const response = await fetch(cfg.supabaseUrl + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: cfg.serviceKey,
      Authorization: "Bearer " + cfg.serviceKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    await response.text();
    throw new Error("Blog draft storage request failed (" + response.status + ").");
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function parseJsonObject(value) {
  const cleaned = String(value || "").replace(/`{3}(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("The blogging specialist did not return JSON.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const parsed = JSON.parse(cleaned.slice(start, i + 1));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Blog content must be a JSON object.");
        }
        return parsed;
      }
    }
  }
  throw new Error("The blogging specialist returned incomplete JSON.");
}

export function createBloggingStudioHandlers({ env = process.env, generateAI } = {}) {
  if (typeof generateAI !== "function") throw new Error("An AI generation function is required.");

  return {
    async list(req, res) {
      try {
        const cfg = config(env);
        const rows = await supabaseRequest(
          cfg,
          "blog_drafts?select=id,topic,language,audience,target_keyword,content_json,generation_provider,status,decision_note,approved_at,created_at,updated_at&owner_user_id=eq." +
            encodeURIComponent(req.ownerUser.id) + "&order=created_at.desc&limit=50"
        );
        return res.json({ success: true, drafts: Array.isArray(rows) ? rows : [] });
      } catch (error) {
        console.error("Blog draft list failed:", error.message);
        return res.status(503).json({ success: false, error: "Blog drafts are temporarily unavailable." });
      }
    },

    async generate(req, res) {
      try {
        const topic = String(req.body?.topic || "").trim();
        const language = String(req.body?.language || "English").trim();
        const audience = String(req.body?.audience || "").trim().slice(0, 200);
        const targetKeyword = String(req.body?.targetKeyword || "").trim().slice(0, 100);
        if (topic.length < 3 || topic.length > 180) {
          return res.status(400).json({ success: false, error: "Enter a topic between 3 and 180 characters." });
        }
        if (!["English", "Telugu", "Bilingual"].includes(language)) {
          return res.status(400).json({ success: false, error: "Choose English, Telugu or Bilingual." });
        }
        const task = [
          "Create a helpful, search-friendly article draft using the brief below.",
          "Return ONLY a valid JSON object with this shape:",
          '{"researchStatus":"needs_source_verification","title":"","slugSuggestion":"","metaDescription":"","articleMarkdown":"","outline":[],"faq":[{"question":"","answer":""}],"internalLinkSuggestions":[],"sourcesToVerify":[],"seoChecklist":[]}',
          "Use the selected language exactly: English, Telugu or Bilingual (separate clearly labelled language sections).",
          "Do not invent facts, statistics, quotes, source URLs, testimonials, product prices, legal or medical advice, or search rankings.",
          "If current facts or sources are needed, mark them in sourcesToVerify instead of inventing a citation.",
          "Write naturally for people first; use the target keyword only where it fits, avoid keyword stuffing, and include a useful introduction, descriptive headings and conclusion.",
          "Do not publish the article. This is an editorial draft for owner review.",
          "Brief:",
          JSON.stringify({ topic, language, audience: audience || "General readers", targetKeyword: targetKeyword || "Not provided" })
        ].join("\n");
        const instructions = [
          "You are the Master AI Bot Blogging specialist.",
          "Create original, useful editorial drafts and on-page SEO metadata.",
          "Do not invent research, source citations or performance metrics.",
          "Return only the requested JSON object."
        ].join("\n");
        const generated = await generateAI(task, instructions, 2200);
        const content = parseJsonObject(generated.result);
        const cfg = config(env);
        const rows = await supabaseRequest(cfg, "blog_drafts", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            owner_user_id: req.ownerUser.id,
            topic,
            language,
            audience,
            target_keyword: targetKeyword,
            content_json: content,
            generation_provider: generated.provider || "unknown",
            status: "draft",
            updated_at: new Date().toISOString()
          })
        });
        const draft = Array.isArray(rows) ? rows[0] : null;
        if (!draft) throw new Error("Blog draft was generated but could not be saved.");
        return res.status(201).json({ success: true, draft });
      } catch (error) {
        console.error("Blog draft generation failed:", error.message);
        const status = /Enter a topic|Choose English|Choose Telugu|Choose Bilingual/i.test(error.message) ? 400 : 502;
        return res.status(status).json({
          success: false,
          error: status === 400 ? error.message : "The blog draft could not be generated or saved."
        });
      }
    },

    async approve(req, res) {
      try {
        const cfg = config(env);
        const rows = await supabaseRequest(
          cfg,
          "blog_drafts?id=eq." + encodeURIComponent(req.params.id) +
            "&owner_user_id=eq." + encodeURIComponent(req.ownerUser.id),
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              status: "approved",
              approved_at: new Date().toISOString(),
              decision_note: null,
              updated_at: new Date().toISOString()
            })
          }
        );
        const draft = Array.isArray(rows) ? rows[0] : null;
        if (!draft) return res.status(404).json({ success: false, error: "Blog draft was not found." });
        return res.json({ success: true, draft, message: "Draft approved for editorial use only; it has not been published." });
      } catch (error) {
        console.error("Blog draft approval failed:", error.message);
        return res.status(503).json({ success: false, error: "The blog draft could not be approved." });
      }
    },

    async reject(req, res) {
      try {
        const cfg = config(env);
        const note = String(req.body?.decisionNote || "").trim().slice(0, 500);
        const rows = await supabaseRequest(
          cfg,
          "blog_drafts?id=eq." + encodeURIComponent(req.params.id) +
            "&owner_user_id=eq." + encodeURIComponent(req.ownerUser.id),
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              status: "rejected",
              decision_note: note || "Rejected by owner.",
              approved_at: null,
              updated_at: new Date().toISOString()
            })
          }
        );
        const draft = Array.isArray(rows) ? rows[0] : null;
        if (!draft) return res.status(404).json({ success: false, error: "Blog draft was not found." });
        return res.json({ success: true, draft });
      } catch (error) {
        console.error("Blog draft rejection failed:", error.message);
        return res.status(503).json({ success: false, error: "The blog draft could not be rejected." });
      }
    }
  };
}
