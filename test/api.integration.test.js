import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { spawn } from "node:child_process";

let child;
let baseUrl;
let authServer;
let authUrl;

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
  const authPort = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  authUrl = `http://127.0.0.1:${authPort}`;

  // Local Supabase Auth stub for protected-route integration tests.
  authServer = createHttpServer((req, res) => {
    if (req.url !== "/auth/v1/user" || req.headers.authorization !== "Bearer test-owner-token") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Invalid test session" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "test-owner-user" }));
  });
  await new Promise((resolve, reject) => {
    authServer.once("error", reject);
    authServer.listen(authPort, "127.0.0.1", resolve);
  });

  child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      GROQ_API_KEY: "",
      MISTRAL_API_KEY: "",
      OPENROUTER_API_KEY: "",
      SUPABASE_URL: authUrl,
      SUPABASE_ANON_KEY: "public-anon-key",
      SUPABASE_OWNER_USER_ID: "test-owner-user"
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

after(async () => {
  if (child && child.exitCode === null) child.kill();
  if (authServer) await new Promise((resolve) => authServer.close(resolve));
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
  assert.equal(data.providers.groq.configured, false);
  assert.equal(data.providers.openrouter.configured, false);
  assert.equal(data.providers.mistral.configured, false);
  assert.deepEqual(data.providerOrder, ["Groq", "OpenRouter", "Mistral"]);
});

test("Central Brain rejects an empty task with HTTP 400", async () => {
  const response = await fetch(`${baseUrl}/api/brain`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-owner-token" },
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
    headers: { "content-type": "application/json", authorization: "Bearer test-owner-token" },
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
    headers: { "content-type": "application/json", authorization: "Bearer test-owner-token" },
    body: JSON.stringify({ task: "Run a task", agentId: "unknown-agent" })
  });
  const data = await response.json();

  assert.equal(response.status, 400);
  assert.equal(data.success, false);
  assert.equal(data.error, "Invalid agent selected.");
});


test("approval config returns public sign-in settings without exposing owner identity", async () => {
  const response = await fetch(`${baseUrl}/api/approvals/config`);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.supabaseUrl, authUrl);
  assert.equal(data.anonKey, "public-anon-key");
  assert.equal(data.ownerUserId, undefined);
});


test("YouTube channel endpoints require the signed-in owner", async () => {
  const response = await fetch(`${baseUrl}/api/youtube/status`);
  const data = await response.json();

  assert.equal(response.status, 401);
  assert.equal(data.success, false);
});

test("YouTube status reports missing private configuration without exposing secrets", async () => {
  const response = await fetch(`${baseUrl}/api/youtube/status`, {
    headers: { authorization: "Bearer test-owner-token" }
  });
  const data = await response.json();

  assert.equal(response.status, 503);
  assert.equal(data.success, false);
  assert.equal(data.channel, undefined);
  assert.equal(data.refresh_token, undefined);
});
