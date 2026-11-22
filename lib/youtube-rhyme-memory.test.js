import test from "node:test";
import assert from "node:assert/strict";
import { createYoutubeRhymeMemory, extractRhymeProductionState } from "./youtube-rhyme-memory.js";

test("extracts a complete rhyme continuity record from a specialist report", () => {
  const report = "Done\\n<RHYME_PRODUCTION_STATE>{\"rhymeTitle\":\"Happy Rainbow\",\"script\":\"A rainbow sings\",\"totalScenes\":3,\"completedScenes\":[1],\"remainingScenes\":[2,3],\"nextScene\":2,\"cooldownStatus\":\"cooling_down\",\"retryAt\":\"2026-11-22T12:00:00Z\",\"retryAttempts\":1}</RHYME_PRODUCTION_STATE>";
  const state = extractRhymeProductionState(report);
  assert.equal(state.rhyme_title, "Happy Rainbow");
  assert.deepEqual(state.completed_scenes, [1]);
  assert.equal(state.next_scene, 2);
  assert.equal(state.cooldown_status, "cooling_down");
  assert.equal(state.retry_attempts, 1);
});
test("rejects malformed or missing state blocks", () => {
  assert.equal(extractRhymeProductionState("No state here"), null);
  assert.equal(extractRhymeProductionState("<RHYME_PRODUCTION_STATE>{bad}</RHYME_PRODUCTION_STATE>"), null);
});
test("persists owner-scoped rhyme progress and resumes it after a fresh handler instance", async () => {
  const rows = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    if (method === "POST") {
      const row = { id: "rhyme-1", ...JSON.parse(options.body) };
      rows.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    if (method === "PATCH") {
      const urlObj = new URL(url);
      const id = urlObj.searchParams.get("id")?.replace(/^eq\\./, "");
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) return new Response("[]", { status: 200 });
      rows[index] = { ...rows[index], ...JSON.parse(options.body) };
      return new Response(JSON.stringify([rows[index]]), { status: 200 });
    }
    const urlObj = new URL(url);
    const title = urlObj.searchParams.get("rhyme_title")?.replace(/^eq\\./, "");
    const result = rows.filter(row => row.owner_user_id === urlObj.searchParams.get("owner_user_id")?.replace(/^eq\\./, "") &&
      (!title || row.rhyme_title === title)).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
    return new Response(JSON.stringify(result), { status: 200 });
  };
  const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key" };
  const first = createYoutubeRhymeMemory({ env, fetchImpl });
  const saved = await first.save("owner-1", {
    rhymeTitle: "Happy Rainbow", script: "Full rhyme", totalScenes: 4,
    completedScenes: [1,2], remainingScenes: [3,4], nextScene: 3,
    characterContinuity: { rainbow: "same face" }, backgroundContinuity: { garden: "same colours" },
    lastGeneratedClip: { scene: 2, url: "https://example.test/clip.mp4" },
    cooldownStatus: "cooling_down", retryAt: "2026-11-22T12:00:00Z",
    failedClips: [{ scene: 3, reason: "rate limit" }], retryAttempts: 1, productionStatus: "cooldown"
  });
  assert.equal(saved.id, "rhyme-1");
  const restarted = createYoutubeRhymeMemory({ env, fetchImpl });
  const context = await restarted.context("owner-1");
  assert.match(context, /Next scene: 3/);
  assert.match(context, /Full rhyme/);
  assert.match(context, /cooling_down/);
});
