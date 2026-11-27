import test from "node:test";
import assert from "node:assert/strict";
import { createAppProjectHandlers } from "./app-projects.js";

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
