import test from "node:test";
import assert from "node:assert/strict";
import { createYoutubeRhymeMemory } from "../lib/youtube-rhyme-memory.js";

function createMemoryStore() {
  const rows = [];
  let nextId = 1;
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method || "GET";
    if (!url.pathname.endsWith("/youtube_rhyme_projects")) {
      return new Response("not found", { status: 404 });
    }

    if (method === "POST") {
      const row = {
        id: "rhyme-" + nextId++,
        created_at: new Date().toISOString(),
        ...JSON.parse(options.body)
      };
      rows.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }

    if (method === "PATCH") {
      const idFilter = url.searchParams.get("id") || "";
      const ownerFilter = url.searchParams.get("owner_user_id") || "";
      const row = rows.find(item =>
        idFilter === "eq." + item.id &&
        ownerFilter === "eq." + item.owner_user_id
      );
      if (!row) return new Response(JSON.stringify([]), { status: 200 });
      Object.assign(row, JSON.parse(options.body));
      return new Response(JSON.stringify([row]), { status: 200 });
    }

    const ownerFilter = url.searchParams.get("owner_user_id");
    const channelFilter = url.searchParams.get("channel_id");
    const titleFilter = url.searchParams.get("rhyme_title");
    const idFilter = url.searchParams.get("id");
    const filtered = rows.filter(row =>
      (!ownerFilter || ownerFilter === "eq." + row.owner_user_id) &&
      (!channelFilter || channelFilter === "eq." + row.channel_id) &&
      (!titleFilter || titleFilter === "eq." + row.rhyme_title) &&
      (!idFilter || idFilter === "eq." + row.id)
    ).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return new Response(JSON.stringify(filtered), { status: 200 });
  };

  return {
    rows,
    memory: createYoutubeRhymeMemory({
      env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key" },
      fetchImpl
    })
  };
}

function stateBlock(overrides = {}) {
  return "<RHYME_PRODUCTION_STATE>" + JSON.stringify({
    rhymeTitle: "Little Stars",
    script: "Twinkle, little stars, shine tonight.",
    totalScenes: 3,
    completedScenes: [1],
    remainingScenes: [2, 3],
    characterContinuity: { character: "Blue star with round eyes" },
    backgroundContinuity: { setting: "Night sky, purple clouds" },
    lastGeneratedClip: { clipId: "confirmed-clip-1" },
    nextScene: 2,
    cooldownStatus: "cooling_down",
    retryAt: "2026-11-23T20:00:00.000Z",
    failedClips: [{ scene: 2, category: "quota", attempts: 1 }],
    retryAttempts: 1,
    productionStatus: "cooldown",
    ...overrides
  }) + "</RHYME_PRODUCTION_STATE>";
}

test("persists complete rhyme state and restores the exact next unfinished scene", async () => {
  const { rows, memory } = createMemoryStore();
  const saved = await memory.persistReport("owner-1", "channel-1", stateBlock());

  assert.equal(rows.length, 1);
  assert.equal(saved.rhyme_title, "Little Stars");
  assert.deepEqual(saved.completed_scenes, [1]);
  assert.deepEqual(saved.remaining_scenes, [2, 3]);
  assert.equal(saved.next_scene, 2);
  assert.equal(saved.cooldown_status, "cooling_down");
  assert.equal(saved.retry_at, "2026-11-23T20:00:00.000Z");

  const context = await memory.context("owner-1", "channel-1");
  assert.match(context, /Full script: Twinkle, little stars/);
  assert.match(context, /Completed scenes: \[1\]/);
  assert.match(context, /Remaining scenes: \[2,3\]/);
  assert.match(context, /Next scene: 2/);
  assert.match(context, /Character continuity:/);
  assert.match(context, /Background continuity:/);
  assert.match(context, /Failed clips:/);
});

test("updates the existing rhyme instead of creating a duplicate when production resumes", async () => {
  const { rows, memory } = createMemoryStore();
  await memory.persistReport("owner-1", "channel-1", stateBlock());
  const updated = await memory.persistReport("owner-1", "channel-1", stateBlock({
    completedScenes: [1, 2],
    remainingScenes: [3],
    nextScene: 3,
    cooldownStatus: "ready",
    retryAt: null,
    productionStatus: "generating",
    retryAttempts: 2
  }));

  assert.equal(rows.length, 1);
  assert.equal(updated.next_scene, 3);
  assert.deepEqual(updated.completed_scenes, [1, 2]);
  assert.deepEqual(updated.remaining_scenes, [3]);
  assert.equal(updated.cooldown_status, "ready");
  assert.equal(updated.retry_attempts, 2);
});
