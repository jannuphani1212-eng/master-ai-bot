import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile(new URL("../public/script.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const agentIds = ["master", "youtube", "affiliate", "blogging", "app-development", "seo"];

test("dashboard defines all six distinct agent workspaces", () => {
  const profileStart = script.indexOf("const agentProfiles = {");
  const profileEnd = script.indexOf("const AGENT_HISTORY_KEY", profileStart);
  assert.ok(profileStart >= 0 && profileEnd > profileStart, "agent profile registry must exist");
  const profiles = script.slice(profileStart, profileEnd);
  for (const id of agentIds) {
    assert.match(profiles, new RegExp('(?:^|\\n)\\s*' + (id === "app-development" ? '"app-development"' : id) + '\\s*:'), id + " profile missing");
  }
  assert.match(html, /id="agentWorkspace"/, "workspace panel missing");
});

test("each agent card supports touch/click and keyboard activation", () => {
  assert.match(script, /const open=\(\)=>openAgentWorkspace\(id\)/);
  assert.match(script, /card\.addEventListener\("click",open\)/);
  assert.match(script, /card\.addEventListener\("keydown",event=>\{if\(event\.key==="Enter"\|\|event\.key===" "\)/);
  assert.match(script, /card\.setAttribute\("role","button"\)/);
  assert.match(script, /card\.tabIndex=0/);
});

test("each workspace has a dedicated task route and back/refresh navigation", () => {
  assert.match(script, /function openAgentWorkspace\(agentId\)/);
  assert.match(script, /agentSelect\.value=currentWorkspaceAgent/);
  assert.match(script, /workspaceBackButton/);
  assert.match(script, /workspaceRefreshButton/);
  assert.match(script, /loadPersistentAgentHistory\(agentId\)/);
  assert.match(script, /loadAgentPortfolio\(agentId\)/);
});

test("each specialist workspace has a dedicated dashboard and role-specific quick actions", () => {
  const profilesStart = script.indexOf("const specialistDashboardProfiles = {");
  const profilesEnd = script.indexOf("const AGENT_HISTORY_KEY", profilesStart);
  assert.ok(profilesStart >= 0 && profilesEnd > profilesStart, "specialist dashboard registry must exist");
  const profiles = script.slice(profilesStart, profilesEnd);
  for (const id of agentIds) assert.match(profiles, new RegExp(id === "app-development" ? '"app-development"\\s*:' : id + "\\s*:"), id + " dashboard profile missing");
  assert.match(html, /id="workspaceQuickActions"/);
  assert.match(script, /function prepareWorkspaceTask\(agentId,prompt\)/);
  assert.match(script, /dashboard\.actions\.forEach/);
});
