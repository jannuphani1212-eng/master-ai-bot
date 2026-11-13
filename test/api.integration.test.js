import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";

let child;
let baseUrl;

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

before(async () => {
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      GEMINI_API_KEY: "",
      GROQ_API_KEY: "",
      OPENROUTER_API_KEY: ""
    },
    stdio: "ignore"
  });

  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming ready (code ${child.exitCode}).`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // The server may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!ready) {
    child.kill();
    throw new Error("Server did not become ready within five seconds.");
  }
});

after(() => {
  if (child && child.exitCode === null) {
    child.kill();
  }
});

test("status endpoint reports the Central Brain and five specialists", async () => {
  const response = await fetch(`${baseUrl}/api/status`);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.centralBrain, true);
  assert.deepEqual(
    data.agents.filter((agent) => agent.id !== "master").map((agent) => agent.id),
    ["affiliate", "youtube", "blogging", "app-development", "seo"]
  );
  assert.equal(data.providers.gemini.configured, false);
  assert.equal(data.providers.groq.configured, false);
  assert.equal(data.providers.openrouter.configured, false);
});

test("Central Brain rejects an empty task with HTTP 400", async () => {
  const response = await fetch(`${baseUrl}/api/brain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.success, false);
  assert.equal(data.error, "Please enter a task.");
});

test("Central Brain reports missing provider configuration with HTTP 503", async () => {
  const response = await fetch(`${baseUrl}/api/brain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "Check all five specialists" })
  });
  const data = await response.json();

  assert.equal(response.status, 503);
  assert.equal(data.success, false);
  assert.equal(data.error, "No AI provider is configured.");
});

test("task endpoint rejects an unknown specialist with HTTP 400", async () => {
  const response = await fetch(`${baseUrl}/api/task`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: "Run a task", agentId: "unknown-agent" })
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.success, false);
  assert.equal(data.error, "Invalid agent selected.");
});


test("approval config endpoint does not expose private owner settings when unconfigured", async () => {
  const response = await fetch(`${baseUrl}/api/approvals/config`);
  const data = await response.json();

  assert.equal(response.status, 503);
  assert.equal(data.success, false);
  assert.equal(data.supabaseUrl, undefined);
  assert.equal(data.anonKey, undefined);
});
