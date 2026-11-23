import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/script.js", import.meta.url), "utf8");

test("private blog and Instagram integration panels expose every control used by the dashboard script", () => {
  const requiredIds = [
    "blogPanel",
    "connectBloggerButton",
    "connectWordPressButton",
    "refreshBlogConnectionsButton",
    "blogConnectionStatus",
    "blogConnectionList",
    "instagramPanel",
    "connectInstagramButton",
    "refreshInstagramButton",
    "instagramConnectionStatus",
    "instagramConnectionList"
  ];
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  for (const id of requiredIds) {
    assert.equal(allIds.filter(candidate => candidate === id).length, 1, "HTML must define exactly one #" + id);
    assert.ok(script.includes('getElementById("' + id + '")') || script.includes('getElementById("' + id + '")'), "dashboard script should reference #" + id);
  }
});

test("integration panels remain hidden until owner sign-in and use authenticated API calls", () => {
  assert.match(script, /blogPanel\.hidden=!visible/);
  assert.match(script, /instagramPanel\.hidden=!visible/);
  assert.match(script, /approvalApi\("\/api\/blog\/status\?provider=blogger"\)/);
  assert.match(script, /approvalApi\("\/api\/instagram\/status"\)/);
  assert.match(script, /approvalApi\("\/api\/instagram\/connect-url"\)/);
});
