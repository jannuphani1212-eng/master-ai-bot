import test from "node:test";
import assert from "node:assert/strict";
import { createSceneSvg, escapeXml, renderNurseryRhymeVideo } from "../lib/youtube-video-renderer.js";

function createTestNarrationWav(durationSeconds = 3, sampleRate = 22050) {
  const sampleCount = durationSeconds * sampleRate;
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * 440) * 2500);
    pcm.writeInt16LE(sample, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

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
    narrationText: "Little bird, fly up high. Rainbow colors fill the sky.",
    synthesizeNarration: async () => createTestNarrationWav(),
    onSceneRendered: async (index, bytes) => checkpoints.push([index, bytes])
  });
  assert.equal(checkpoints.length, 2);
  const saved = Object.fromEntries(checkpoints.map(([index, bytes]) => [index, bytes]));
  let rerendered = 0;
  const second = await renderNurseryRhymeVideo({
    title: "Checkpoint Test",
    scenes: [{ caption: "One" }, { caption: "Two" }],
    durationPerScene: 3,
    narrationText: "Little bird, fly up high. Rainbow colors fill the sky.",
    synthesizeNarration: async () => createTestNarrationWav(),
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
    durationPerScene: 3,
    narrationText: "Rainbow colors shine so bright. Little bird friends sing tonight.",
    synthesizeNarration: async () => createTestNarrationWav()
  });
  assert.ok(Buffer.isBuffer(result.video));
  assert.ok(result.video.length > 10000);
  assert.equal(result.video.subarray(4, 8).toString(), "ftyp");
  assert.ok(Buffer.isBuffer(result.thumbnail));
  assert.ok(Buffer.isBuffer(result.narration));
  assert.equal(result.narration.subarray(0, 4).toString(), "RIFF");
  assert.equal(result.sceneCount, 2);
  assert.equal(result.durationSeconds, 6);
  assert.equal(result.audio.music, "original_synthesized_instrumental");
  assert.equal(result.audio.narration, "offline_espeak_ng_synthesized_voice");
});


test("renderer still creates a playable MP4 when offline narration fails", async () => {
  const result = await renderNurseryRhymeVideo({
    title: "Narration fallback test",
    scenes: [{ caption: "A rainbow shines" }, { caption: "Little birds dance" }],
    durationPerScene: 3,
    narrationText: "This speech engine will fail in the test.",
    synthesizeNarration: async () => { throw new Error("simulated speech engine failure"); }
  });
  assert.ok(Buffer.isBuffer(result.video));
  assert.ok(result.video.length > 10000);
  assert.equal(result.video.subarray(4, 8).toString(), "ftyp");
  assert.equal(result.narration, null);
  assert.match(result.narrationError, /simulated speech engine failure/);
  assert.equal(result.audio.narration, "unavailable_rendered_with_instrumental_only");
});
