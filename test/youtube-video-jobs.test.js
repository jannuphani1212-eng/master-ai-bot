import test from "node:test";
import assert from "node:assert/strict";
import { createYoutubeVideoJobStore } from "../lib/youtube-video-jobs.js";

const owner = "11111111-1111-4111-8111-111111111111";
const job = "22222222-2222-4222-8222-222222222222";
const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key" };

test("creates owner-scoped persistent jobs with publishing disabled", async () => {
  let request;
  const store = createYoutubeVideoJobStore({
    env,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify([{ id: job, owner_user_id: owner, status: "queued" }]), { status: 201 });
    }
  });
  const result = await store.create(owner, {
    rhyme_title: "Rainbow's Little Parade",
    script: "Original test lyrics",
    scenes: [{ caption: "one" }, { caption: "two" }],
    production_spec: { reviewRequired: true }
  });
  assert.equal(result.status, "queued");
  assert.match(request.url, /youtube_video_jobs/);
  assert.equal(request.options.method, "POST");
  const body = JSON.parse(request.options.body);
  assert.equal(body.owner_user_id, owner);
  assert.equal(body.rhyme_title, "Rainbow's Little Parade");
  assert.equal(body.total_scenes, 2);
  assert.equal(body.metadata.publishingEnabled, false);
});

test("rejects scene downloads outside the owner's job folder", async () => {
  let called = false;
  const store = createYoutubeVideoJobStore({
    env,
    fetchImpl: async () => { called = true; return new Response("no", { status: 404 }); }
  });
  await assert.rejects(store.download(owner, job, "another-owner/other-job/scene.png"), /Invalid private scene asset path/);
  assert.equal(called, false);
});

test("downloads saved private scene artwork as bytes", async () => {
  const expected = Buffer.from("png-scene-data");
  let requestedUrl = "";
  const store = createYoutubeVideoJobStore({
    env,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response(expected, { status: 200 });
    }
  });
  const actual = await store.download(owner, job, owner + "/" + job + "/scene-01.png");
  assert.deepEqual(actual, expected);
  assert.match(requestedUrl, /storage\/v1\/object\/youtube-production/);
});

test("pending job recovery query respects retry cooldown timestamps", async () => {
  let requestedUrl = "";
  const store = createYoutubeVideoJobStore({
    env,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return new Response("[]", { status: 200 });
    }
  });
  await store.listPending(5);
  assert.match(requestedUrl, /status=in\.\(queued,planning,rendering,uploading\)/);
  assert.match(requestedUrl, /retry_at\.is\.null/);
  assert.match(requestedUrl, /retry_at\.lte\./);
});
