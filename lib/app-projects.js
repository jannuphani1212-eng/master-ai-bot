import { validateAppProjectFiles } from "./app-project-validation.js";
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_TYPES = new Set(["app", "game_2d", "game_3d"]);
const MAX_FILES = 40;
const MAX_FILE_BYTES = 180_000;
const MAX_TOTAL_BYTES = 900_000;

function config(env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("App project storage requires server-side Supabase credentials.");
  return { url, key };
}
async function parse(response) {
  const raw = await response.text();
  let value = null;
  try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
  if (!response.ok) throw new Error("App project storage request failed (" + response.status + "): " + String(raw).slice(0, 220));
  return value;
}
function safeProjectId(value) {
  if (!UUID.test(String(value || ""))) throw new Error("A valid project ID is required.");
  return String(value);
}
function normalizeFiles(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) {
    throw new Error("Provide between 1 and " + MAX_FILES + " source files.");
  }
  let totalBytes = 0;
  const seen = new Set();
  return value.map(file => {
    const filePath = String(file?.filePath || file?.file_path || "").trim();
    if (!filePath || filePath.length > 240 || filePath.startsWith("/") ||
        filePath.includes("\\") || filePath.split("/").some(part => !part || part === "." || part === "..") ||
        !/^[a-zA-Z0-9._@+/-]+$/.test(filePath)) {
      throw new Error("A source file has an unsafe or invalid relative path.");
    }
    if (seen.has(filePath)) throw new Error("Duplicate source file path: " + filePath);
    seen.add(filePath);
    if (typeof file?.content !== "string") throw new Error("Every source file must contain text content.");
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_FILE_BYTES) throw new Error("Source file exceeds the 180 KB per-file limit: " + filePath);
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Combined source files exceed the 900 KB request limit.");
    const language = String(file.language || "text").trim().slice(0, 40) || "text";
    return {
      file_path: filePath,
      language,
      content: file.content,
      content_sha256: createHash("sha256").update(file.content, "utf8").digest("hex")
    };
  });
}

function fieldValue(report, label) {
  const lines = String(report || "").split(/\r?\n/);
  const pattern = new RegExp("^\\s*(?:\\*\\*)?" + label + "(?:\\*\\*)?\\s*[:：-]\\s*(.*?)\\s*$", "i");
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*(?:\*\*)?FILE(?:\*\*)?\s*[:：]\s*(.+?)\s*(?:\*\*)?$/i);
    if (!match) continue;
    if (match[1].trim()) return match[1].trim().replace(/^`|`$/g, "").slice(0, 400);
    for (let j = i + 1; j < lines.length; j += 1) {
      const value = lines[j].trim();
      if (!value) continue;
      if (/^[A-Z][A-Z _-]{2,}:/.test(value) || value.startsWith("#")) break;
      return value.replace(/^`|`$/g, "").slice(0, 400);
    }
    return "";
  }
  return "";
}

export function extractAppProjectFiles(report) {
  const lines = String(report || "").split(/\r?\n/);
  const files = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*(?:\*\*)?FILE(?:\*\*)?\s*[:：]\s*(.+?)\s*(?:\*\*)?$/i);
    if (!match) continue;
    const filePath = match[1].trim().replace(/^`|`$/g, "");
    let fence = i + 1;
    while (fence < lines.length && !lines[fence].trim()) fence += 1;
    const fenceMatch = lines[fence]?.match(/^\s*```([a-zA-Z0-9_+-]*)\s*$/);
    if (!fenceMatch) continue;
    const contentLines = [];
    let end = fence + 1;
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) {
      contentLines.push(lines[end]);
      end += 1;
    }
    if (end >= lines.length) throw new Error("Unclosed source code fence for " + filePath + ".");
    const extension = filePath.split(".").pop().toLowerCase();
    const allowed = new Set(["html", "htm", "css", "js", "mjs", "json", "md", "svg"]);
    if (!allowed.has(extension)) throw new Error("Generated project file type is not allowed: " + filePath);
    const language = fenceMatch[1] || ({ html: "html", htm: "html", css: "css", js: "javascript", mjs: "javascript", json: "json", md: "markdown", svg: "xml" })[extension];
    files.push({ filePath, language, content: contentLines.join("\n") });
    i = end;
  }
  if (!files.length) throw new Error("The App Development report did not include any FILE: code blocks.");
  if (!files.some(file => /(^|\/)index\.html?$/i.test(file.filePath))) throw new Error("Generated web prototype must include index.html.");
  if (!files.some(file => /\.(?:js|mjs)$/i.test(file.filePath))) throw new Error("Generated web prototype must include at least one JavaScript source file.");
  return {
    name: fieldValue(report, "PROJECT NAME") || "AI Generated App Prototype",
    projectType: fieldValue(report, "PROJECT TYPE").toLowerCase(),
    description: fieldValue(report, "PROJECT DESCRIPTION") || "Generated Android-first web prototype.",
    files: normalizeFiles(files)
  };
}

export function createAppProjectHandlers({ env = process.env, fetchImpl = fetch } = {}) {
  async function request(path, ownerId, options = {}) {
    if (!UUID.test(String(ownerId || ""))) throw new Error("Owner authentication is required.");
    const c = config(env);
    return parse(await fetchImpl(c.url + "/rest/v1/" + path, {
      ...options,
      headers: {
        apikey: c.key,
        Authorization: "Bearer " + c.key,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: AbortSignal.timeout(20000)
    }));
  }

  async function list(ownerId) {
    const rows = await request("app_projects?select=id,name,project_type,description,status,repository_url,created_at,updated_at&owner_user_id=eq." +
      encodeURIComponent(ownerId) + "&order=updated_at.desc&limit=100", ownerId);
    return Array.isArray(rows) ? rows : [];
  }

  async function create(ownerId, input = {}) {
    const name = String(input.name || "").trim().slice(0, 160);
    if (!name) throw new Error("Project name is required.");
    const projectType = PROJECT_TYPES.has(input.projectType) ? input.projectType : "app";
    const description = String(input.description || "").trim().slice(0, 4000);
    const rows = await request("app_projects?select=*", ownerId, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        owner_user_id: ownerId,
        name,
        project_type: projectType,
        description,
        status: "planning"
      })
    });
    if (!Array.isArray(rows) || !rows[0]) throw new Error("The project could not be saved.");
    return rows[0];
  }

  async function get(ownerId, projectId) {
    const id = safeProjectId(projectId);
    const projects = await request("app_projects?select=*&id=eq." + encodeURIComponent(id) +
      "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&limit=1", ownerId);
    const project = Array.isArray(projects) ? projects[0] : null;
    if (!project) return null;
    const files = await request("app_project_files?select=id,file_path,language,content,content_sha256,created_at,updated_at&project_id=eq." +
      encodeURIComponent(id) + "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&order=file_path.asc&limit=100", ownerId);
    return { ...project, files: Array.isArray(files) ? files : [] };
  }

  async function saveFiles(ownerId, projectId, input = {}) {
    const id = safeProjectId(projectId);
    const files = normalizeFiles(input.files);
    const existing = await request("app_projects?select=id&id=eq." + encodeURIComponent(id) +
      "&owner_user_id=eq." + encodeURIComponent(ownerId) + "&limit=1", ownerId);
    if (!Array.isArray(existing) || !existing[0]) throw new Error("Project was not found for this owner.");
    const rows = await request("app_project_files?on_conflict=project_id,file_path", ownerId, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(files.map(file => ({
        ...file,
        project_id: id,
        owner_user_id: ownerId
      })))
    });
    await request("app_projects?id=eq." + encodeURIComponent(id) +
      "&owner_user_id=eq." + encodeURIComponent(ownerId), ownerId, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "in_progress", updated_at: new Date().toISOString() })
    });
    return Array.isArray(rows) ? rows.map(({ content, ...file }) => file) : [];
  }

  async function createFromGeneratedReport(ownerId, jobId, report) {
    if (!UUID.test(String(jobId || ""))) throw new Error("A valid source job ID is required.");
    const parsed = extractAppProjectFiles(report);
    const marker = "[master-ai-job:" + jobId + "]";
    const projectType = PROJECT_TYPES.has(parsed.projectType) ? parsed.projectType : "app";
    const existing = (await list(ownerId)).find(project => String(project.description || "").includes(marker));
    const description = (parsed.description + "\n\n" + marker + "\nGenerated source only. Static syntax checks are performed; project code is not executed or built on the server.").slice(0, 4000);
    const project = existing || await create(ownerId, { name: parsed.name, projectType, description });
    await saveFiles(ownerId, project.id, { files: parsed.files });
    const staticValidation = validateAppProjectFiles(parsed.files.map(file => ({ file_path: file.file_path, content: file.content })));
    const policyFindings = parsed.files.flatMap(file => {
      const extension = file.file_path.split(".").pop().toLowerCase();
      const content = String(file.content || "");
      const unsafeScript = ["js", "mjs"].includes(extension) && /\b(?:eval|Function)\s*\(|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|navigator\.sendBeacon/i.test(content);
      const remoteAsset = ["html", "htm", "css"].includes(extension) && /(?:src|href)\s*=\s*["']https?:|@import\s+url\(\s*["']?https?:|url\(\s*["']?https?:/i.test(content);
      return unsafeScript || remoteAsset ? [{ file: file.file_path, type: "no-external-network-or-dynamic-code", status: "failed", message: "Generated prototype must not execute dynamic code or call external network services." }] : [];
    });
    const checks = [...staticValidation.checks, ...policyFindings];
    const validationSuccess = staticValidation.success && policyFindings.length === 0;
    const validation = { ...staticValidation, success: validationSuccess, status: validationSuccess ? "passed" : "failed", checks, summary: checks.filter(item => item.status === "failed").length + " failed; " + checks.filter(item => item.status === "passed").length + " passed. No project code was executed or built." };
    const status = validationSuccess ? "ready_for_review" : "needs_fixes";
    await request("app_projects?id=eq." + encodeURIComponent(project.id) + "&owner_user_id=eq." + encodeURIComponent(ownerId), ownerId, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
    return { projectId: project.id, projectName: parsed.name, projectType, status, files: parsed.files.map(file => file.file_path), validation };
  }

  async function listHandler(req, res) {
    try { return res.json({ success: true, projects: await list(req.ownerUser.id) }); }
    catch (error) { return res.status(503).json({ success: false, error: error.message }); }
  }
  async function createHandler(req, res) {
    try { return res.status(201).json({ success: true, project: await create(req.ownerUser.id, req.body || {}) }); }
    catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  }
  async function getHandler(req, res) {
    try {
      const project = await get(req.ownerUser.id, req.params.id);
      if (!project) return res.status(404).json({ success: false, error: "Project not found." });
      return res.json({ success: true, project });
    } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  }
  async function validateHandler(req, res) {
    try {
      const project = await get(req.ownerUser.id, req.params.id);
      if (!project) return res.status(404).json({ success: false, error: "Project not found." });
      if (!Array.isArray(project.files) || project.files.length === 0) {
        return res.status(400).json({ success: false, error: "Save at least one source file before running validation." });
      }
      const validation = validateAppProjectFiles(project.files);
      return res.status(validation.success ? 200 : 422).json({
        success: validation.success,
        projectId: project.id,
        projectName: project.name,
        validation
      });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  async function saveFilesHandler(req, res) {
    try {
      const files = await saveFiles(req.ownerUser.id, req.params.id, req.body || {});
      return res.json({ success: true, savedFiles: files.length, files });
    } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  }
  return { list, create, get, saveFiles, createFromGeneratedReport, listHandler, createHandler, getHandler, saveFilesHandler, validateHandler };
}
