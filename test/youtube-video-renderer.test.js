import test from "node:test";
import assert from "node:assert/strict";
import { createSceneSvg, escapeXml, renderNurseryRhymeVideo } from "../lib/youtube-video-renderer.js";

test("escapeXml protects text inserted into the SVG artwork", () => {
  assert.equal(escapeXml("<Bird & Friends>"), "&lt;Bird &amp; Friends&gt;");
});

test("createSceneSvg creates a consistent, numbered 16:9 cartoon scene", () => {
  const svg = createSceneSvg({ title: "Rainbow Parade", caption: "Little birds sing!", index: 1, total: 6 });
  assert.match(svg, /width="1280" height="720"/);
  assert.match(svg, /Rainbow Parade/);
  assert.match(svg, /Little birds sing!/);
  assert.match(svg, /Scene 2 \/ 6/);
});

test("renderer reuses saved scene artwork and checkpoints newly rendered scenes", async () => {
  const checkpoints = [];
  const first = await renderNurseryRhymeVideo({
    title: "Checkpoint Test",
    scenes: [{ caption: "One" }, { caption: "Two" }],
    durationPerScene: 3,
    onSceneRendered: async (index, bytes) => checkpoints.push([index, bytes])
  });
  assert.equal(checkpoints.length, 2);
  const saved = Object.fromEntries(checkpoints.map(([index, bytes]) => [index, bytes]));
  let rerendered = 0;
  const second = await renderNurseryRhymeVideo({
    title: "Checkpoint Test",
    scenes: [{ caption: "One" }, { caption: "Two" }],
    durationPerScene: 3,
    sceneImages: saved,
    onSceneRendered: async () => { rerendered++; }
  });
  assert.equal(rerendered, 0);
  assert.equal(second.sceneCount, first.sceneCount);
  assert.ok(second.video.length > 10000);
});

test("renderer rejects missing scene cards before starting FFmpeg", async () => {
  await assert.rejects(
    renderNurseryRhymeVideo({ title: "Test", scenes: [] }),
    /between 1 and 20/
  );
});

test("renderer creates a playable MP4, thumbnail, and original instrumental track", async () => {
  const result = await renderNurseryRhymeVideo({
    title: "Rainbow's Little Parade",
    scenes: [
      { caption: "Rainbow colors shine so bright!" },
      { caption: "Little bird friends dance tonight!" }
    ],
    durationPerScene: 3
  });
  assert.ok(Buffer.isBuffer(result.video));
  assert.ok(result.video.length > 10000);
  assert.equal(result.video.subarray(4, 8).toString(), "ftyp");
  assert.ok(Buffer.isBuffer(result.thumbnail));
  assert.equal(result.sceneCount, 2);
  assert.equal(result.durationSeconds, 6);
  assert.equal(result.audio.music, "original_synthesized_instrumental");
  assert.equal(result.audio.narration, "not_generated");
});
