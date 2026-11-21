import test from "node:test";
import assert from "node:assert/strict";
import { createAgnesVideoHandlers } from "./agnes-video.js";

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; }
  };
}

test("video creation stays locked unless free mode is explicitly enabled", async () => {
  let called = false;
  const handlers = createAgnesVideoHandlers({
    env: { AGNES_API_KEY: "secret" },
    fetchImpl: async () => { called = true; throw new Error("should not call"); }
  });
  const res = responseRecorder();
  await handlers.create({ body: { prompt: "A sufficiently long test video prompt for a nursery rhyme." } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(called, false);
});

test("video creation uses the free-tier flash model and keeps key in authorization header", async () => {
  let request;
  const handlers = createAgnesVideoHandlers({
    env: { AGNES_API_KEY: "secret", AGNES_VIDEO_FREE_MODE_ENABLED: "true" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ video_id: "video_12345", status: "queued" }) };
    }
  });
  const res = responseRecorder();
  await handlers.create({ body: { prompt: "A cute 3D animated yellow duck singing a happy original nursery rhyme." } }, res);
  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.videoId, "video_12345");
  assert.equal(request.url, "https://apihub.agnes-ai.com/v1/videos");
  assert.equal(request.options.headers.Authorization, "Bearer secret");
  assert.equal(JSON.parse(request.options.body).model, "agnes-video-2.5-flash");
});

test("video status polls by video_id and returns completed URL", async () => {
  let requestedUrl;
  const handlers = createAgnesVideoHandlers({
    env: { AGNES_API_KEY: "secret", AGNES_VIDEO_FREE_MODE_ENABLED: "true" },
    fetchImpl: async url => {
      requestedUrl = url;
      return { ok: true, status: 200, json: async () => ({ status: "completed", progress: 100, url: "https://example.com/video.mp4" }) };
    }
  });
  const res = responseRecorder();
  await handlers.status({ query: { video_id: "video_12345" } }, res);
  assert.equal(res.payload.status, "completed");
  assert.equal(res.payload.videoUrl, "https://example.com/video.mp4");
  assert.match(requestedUrl, /video_id=video_12345/);
  assert.match(requestedUrl, /model_name=agnes-video-2.5-flash/);
});
