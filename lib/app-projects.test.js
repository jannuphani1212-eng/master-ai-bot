import test from "node:test";
import assert from "node:assert/strict";
import { createAppProjectHandlers, extractAppProjectFiles } from "./app-projects.js";

const owner = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
function reply(body, ok = true) {
  return { ok, status: ok ? 200 : 400, text: async () => JSON.stringify(body) };
}

test("creates an owner-scoped app or game project with planning status", async () => {
  let request;
  const handlers = createAppProjectHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return reply([{ id: projectId, owner_user_id: owner, name: "Tiny Runner", project_type: "game_2d", status: "planning" }]);
    }
  });
  const project = await handlers.create(owner, { name: "Tiny Runner", projectType: "game_2d" });
  assert.equal(project.id, projectId);
  assert.match(request.url, /app_projects/);
  assert.equal(request.options.method, "POST");
  const body = JSON.parse(request.options.body);
  assert.equal(body.owner_user_id, owner);
  assert.equal(body.status, "planning");
  assert.equal(body.project_type, "game_2d");
});

test("saves only safe, size-limited source files to the matching owner project", async () => {
  const requests = [];
  const handlers = createAppProjectHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.includes("app_projects?select=id")) return reply([{ id: projectId }]);
      if (url.includes("app_project_files?")) return reply([{ id: "file-1", file_path: "src/App.js" }]);
      return reply(null);
    }
  });
  const saved = await handlers.saveFiles(owner, projectId, { files: [{ filePath: "src/App.js", language: "javascript", content: "export default 1;" }] });
  assert.equal(saved.length, 1);
  const fileRequest = requests.find(item => item.url.includes("app_project_files?"));
  const fileBody = JSON.parse(fileRequest.options.body);
  assert.equal(fileBody[0].owner_user_id, owner);
  assert.equal(fileBody[0].project_id, projectId);
  assert.match(fileBody[0].content_sha256, /^[a-f0-9]{64}$/);
  assert.ok(requests.some(item => item.options.method === "PATCH" && item.url.includes("app_projects?id=")));
});

test("rejects unsafe source paths before writing", async () => {
  let calls = 0;
  const handlers = createAppProjectHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async () => { calls += 1; return reply([]); }
  });
  await assert.rejects(
    handlers.saveFiles(owner, projectId, { files: [{ filePath: "../secrets.txt", content: "no" }] }),
    /unsafe or invalid relative path/
  );
  assert.equal(calls, 0);
});

test("rejects missing owner identity", async () => {
  const handlers = createAppProjectHandlers({ env: {}, fetchImpl: async () => reply([]) });
  await assert.rejects(handlers.list(""), /Owner authentication is required/);
});

test("extracts a complete owner-safe HTML app project from FILE code blocks", async () => {
  const report = [
    "PROJECT NAME: Tiny Runner",
    "PROJECT TYPE: game_2d",
    "PROJECT DESCRIPTION: A small touch-friendly canvas game.",
    "FILE: index.html",
    "```html",
    "<html><head><title>Tiny Runner</title></head><body><canvas id=\"game\"></canvas><script src=\"app.js\"></script></body></html>",
    "```",
    "FILE: app.js",
    "```javascript",
    "const canvas = document.querySelector('#game');",
    "canvas.width = 320;",
    "canvas.height = 480;",
    "```",
    "FILE: README.md",
    "```markdown",
    "# Tiny Runner",
    "Open index.html in a modern browser.",
    "```"
  ].join("\n");
  const requests = [];
  const handlers = createAppProjectHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.includes("app_projects?select=id,name")) return reply([]);
      if (url.includes("app_projects?select=*")) return reply([{ id: projectId, owner_user_id: owner, name: "Tiny Runner", project_type: "game_2d" }]);
      if (url.includes("app_projects?select=id&id=")) return reply([{ id: projectId }]);
      if (url.includes("app_project_files?")) return reply([{ id: "file-1", file_path: "index.html" }, { id: "file-2", file_path: "app.js" }]);
      return reply(null);
    }
  });
  const result = await handlers.createFromGeneratedReport(owner, "33333333-3333-4333-8333-333333333333", report);
  assert.equal(result.projectId, projectId);
  assert.equal(result.projectType, "game_2d");
  assert.deepEqual(result.files, ["index.html", "app.js", "README.md"]);
  assert.equal(result.validation.status, "passed");
  assert.equal(result.status, "ready_for_review");
  assert.ok(requests.some(item => item.url.includes("app_project_files?") && item.options.method === "POST"));
  assert.ok(requests.some(item => item.url.includes("app_projects?id=") && item.options.method === "PATCH"));
});

test("rejects generated projects that omit index.html or JavaScript source", () => {
  const report = ["PROJECT NAME: Broken", "FILE: README.md", "```markdown", "No runnable app", "```"].join("\n");
  assert.throws(() => extractAppProjectFiles(report), /must include index\.html/);
});

test("marks generated project files with external calls as needing fixes", async () => {
  const report = [
    "PROJECT NAME: Network App",
    "PROJECT TYPE: app",
    "FILE: index.html",
    "```html",
    "<html><head></head><body><script src=\"app.js\"></script></body></html>",
    "```",
    "FILE: app.js",
    "```javascript",
    "fetch('https://example.com/data');",
    "```"
  ].join("\n");
  const handlers = createAppProjectHandlers({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret" },
    fetchImpl: async (url, options = {}) => {
      if (url.includes("app_projects?select=id,name")) return reply([]);
      if (url.includes("app_projects?select=*")) return reply([{ id: projectId, name: "Network App" }]);
      if (url.includes("app_projects?select=id&id=")) return reply([{ id: projectId }]);
      if (url.includes("app_project_files?")) return reply([{ id: "file-1" }]);
      return reply(null);
    }
  });
  const result = await handlers.createFromGeneratedReport(owner, "33333333-3333-4333-8333-333333333333", report);
  assert.equal(result.status, "needs_fixes");
  assert.equal(result.validation.status, "failed");
  assert.ok(result.validation.checks.some(check => check.type === "no-external-network-or-dynamic-code"));
});
