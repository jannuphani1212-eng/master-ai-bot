import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const WIDTH = 1280;
const HEIGHT = 720;
const PALETTES = [
  ["#91D8FF", "#FFF0A8", "#FF8DB4"],
  ["#A8E6CF", "#FDFD96", "#8EC5FC"],
  ["#CDB4DB", "#FFC8DD", "#BDE0FE"],
  ["#B8F2E6", "#FDE2A7", "#F7A8B8"],
  ["#A0C4FF", "#FFD6A5", "#CAFFBF"],
  ["#FFC6FF", "#BDB2FF", "#9BF6FF"]
];

export function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[ch]);
}

function clampText(value, max = 150) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function createSceneSvg({ title, caption, index = 0, total = 1, width = WIDTH, height = HEIGHT }) {
  const [sky, sun, accent] = PALETTES[index % PALETTES.length];
  const safeTitle = escapeXml(clampText(title, 100));
  const safeCaption = escapeXml(clampText(caption, 140));
  const x = 210 + (index % 3) * 330;
  const y = 395 - (index % 2) * 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="#FFF8E8"/></linearGradient></defs>
    <rect width="1280" height="720" fill="url(#sky)"/>
    <circle cx="1050" cy="135" r="72" fill="${sun}" opacity=".95"/>
    <g fill="#fff" opacity=".82"><ellipse cx="240" cy="150" rx="82" ry="28"/><ellipse cx="290" cy="137" rx="58" ry="36"/><ellipse cx="345" cy="153" rx="68" ry="24"/><ellipse cx="780" cy="205" rx="70" ry="24"/><ellipse cx="825" cy="190" rx="48" ry="31"/><ellipse cx="870" cy="205" rx="62" ry="22"/></g>
    <path d="M0 500 Q230 390 470 505 T960 490 T1280 475 V720 H0Z" fill="#9AD9A4"/>
    <path d="M0 570 Q250 480 520 580 T1050 560 T1280 550 V720 H0Z" fill="#69BD87"/>
    <g transform="translate(${x} ${y})">
      <ellipse cx="0" cy="118" rx="112" ry="22" fill="#397B6A" opacity=".2"/>
      <path d="M-70 45 Q-100 -5 -64 -56 Q-15 -104 45 -55 Q88 -7 57 47Z" fill="${accent}" stroke="#6B5474" stroke-width="7"/>
      <circle cx="-22" cy="-24" r="10" fill="#493B50"/><circle cx="25" cy="-24" r="10" fill="#493B50"/>
      <path d="M-18 8 Q0 27 20 7" fill="none" stroke="#493B50" stroke-width="7" stroke-linecap="round"/>
      <path d="M-62 -47 Q-105 -102 -124 -54 Q-116 -9 -66 -4Z" fill="#FFD166" stroke="#6B5474" stroke-width="6"/>
      <path d="M54 -47 Q98 -102 120 -54 Q112 -8 61 -4Z" fill="#FFD166" stroke="#6B5474" stroke-width="6"/>
      <path d="M-55 45 L-90 102 M48 45 L82 102" stroke="#6B5474" stroke-width="13" stroke-linecap="round"/>
    </g>
    <g fill="#fff" stroke="#fff" opacity=".9"><path d="M90 420 l12 -25 12 25 25 12 -25 12 -12 25 -12 -25 -25 -12Z"/><path d="M1110 380 l9 -19 9 19 19 9 -19 9 -9 19 -9 -19 -19 -9Z"/></g>
    <rect x="54" y="34" width="1172" height="82" rx="28" fill="#24334D" opacity=".78"/>
    <text x="640" y="88" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" font-weight="700" fill="#fff">${safeTitle}</text>
    <rect x="70" y="602" width="1140" height="82" rx="24" fill="#19263D" opacity=".82"/>
    <text x="640" y="655" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#fff">${safeCaption}</text>
    <text x="1180" y="570" text-anchor="end" font-family="Arial,sans-serif" font-size="18" fill="#fff">Scene ${index + 1} / ${total}</text>
  </svg>`;
}

function createMusicWav(durationSeconds = 20, sampleRate = 22050) {
  const samples = Math.max(1, Math.floor(durationSeconds * sampleRate));
  const data = Buffer.alloc(samples * 2);
  const notes = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46];
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const beat = Math.floor(t * 2) % notes.length;
    const phase = (t * notes[beat]) % 1;
    const triangle = 1 - 4 * Math.abs(phase - 0.5);
    const envelope = Math.min(1, (t % 0.5) * 12) * Math.min(1, (0.5 - (t % 0.5)) * 12);
    const sample = Math.max(-1, Math.min(1, triangle * 0.14 * envelope));
    data.writeInt16LE(Math.round(sample * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function runFfmpeg(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error("FFmpeg failed (" + code + "): " + stderr.slice(-1200))));
  });
}

export async function renderNurseryRhymeVideo({
  title,
  scenes,
  durationPerScene = 5,
  ffmpegPath = ffmpegStatic,
  sceneImages = {},
  loadSceneImage = null,
  narrationText = "",
  onSceneRendered,
  synthesizeNarration = null
} = {}) {
  if (!ffmpegPath) throw new Error("Free FFmpeg binary is unavailable in this deployment.");
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 20) {
    throw new Error("Video production requires between 1 and 20 numbered scenes.");
  }
  const cleanTitle = clampText(title, 100);
  if (!cleanTitle) throw new Error("A rhyme title is required.");
  const safeDuration = Math.max(3, Math.min(12, Number(durationPerScene) || 5));
  let duration = safeDuration * scenes.length;
  const dir = await mkdtemp(path.join(os.tmpdir(), "master-ai-rhyme-"));
  try {
    const imagePaths = [];
    for (let i = 0; i < scenes.length; i++) {
      const caption = clampText(scenes[i]?.caption || scenes[i]?.description || ("Let's sing together!"), 140);
      const imagePath = path.join(dir, "scene-" + String(i).padStart(2, "0") + ".png");
      // Load persisted scene artwork one at a time. Keeping every downloaded
      // PNG Buffer in the API process caused avoidable memory pressure on the
      // 512 MiB free instance when a job resumed after a restart.
      const existing = Buffer.isBuffer(sceneImages?.[i]) && sceneImages[i].length > 0
        ? sceneImages[i]
        : typeof loadSceneImage === "function" ? await loadSceneImage(i) : null;
      const hasExisting = Buffer.isBuffer(existing) && existing.length > 0;
      if (hasExisting) {
        await writeFile(imagePath, existing);
      } else {
        const svg = createSceneSvg({ title: cleanTitle, caption, index: i, total: scenes.length });
        await sharp(Buffer.from(svg)).png().toFile(imagePath);
      }
      imagePaths.push(imagePath);
      if (typeof onSceneRendered === "function" && !hasExisting) {
        await onSceneRendered(i, await readFile(imagePath));
      }
    }
    const cleanNarration = clampText(narrationText, 12000);
    let narrationBytes = null;
    let narrationError = null;
    if (cleanNarration && typeof synthesizeNarration === "function") {
      try {
        narrationBytes = Buffer.from(await synthesizeNarration(cleanNarration, {
          voice: "en+f3", speed: 145, pitch: 65, amplitude: 100, wordGap: 3
        }));
        if (narrationBytes.length < 1000 || narrationBytes.subarray(0, 4).toString() !== "RIFF") {
          throw new Error("Offline speech synthesis did not return a valid WAV narration track.");
        }
      } catch (error) {
        narrationBytes = null;
        narrationError = String(error?.message || error).slice(0, 500);
      }
    } else {
      narrationError = cleanNarration
        ? "Offline narration is disabled on this memory-limited deployment to prevent process restarts."
        : "No narration text was supplied.";
    }
    let perSceneDuration = safeDuration;
    if (narrationBytes) {
      const sampleRate = narrationBytes.readUInt32LE(24);
      const channels = narrationBytes.readUInt16LE(22);
      const bitsPerSample = narrationBytes.readUInt16LE(34);
      const dataBytes = narrationBytes.readUInt32LE(40);
      const narrationDuration = dataBytes / (sampleRate * channels * (bitsPerSample / 8));
      perSceneDuration = Math.max(safeDuration, Math.min(12, Math.ceil((narrationDuration + 1) / scenes.length)));
    }
    duration = perSceneDuration * scenes.length;
    const narrationPath = path.join(dir, "narration.wav");
    if (narrationBytes) await writeFile(narrationPath, narrationBytes);
    const musicPath = path.join(dir, "original-instrumental.wav");
    await writeFile(musicPath, createMusicWav(duration));
    const thumb = await readFile(imagePaths[0]);
    // Encode one scene at a time, then concatenate the small MP4 segments.
    // The previous single filter graph opened every still-image input at once,
    // which caused memory spikes on Render's 512 MiB free web instance.
    const clipPaths = [];
    for (let i = 0; i < imagePaths.length; i += 1) {
      const clipPath = path.join(dir, "scene-clip-" + String(i).padStart(2, "0") + ".mp4");
      await runFfmpeg(ffmpegPath, [
        "-y",
        "-loop", "1",
        "-i", imagePaths[i],
        "-t", String(perSceneDuration),
        "-vf", "scale=854:480:flags=fast_bilinear,fps=15,setsar=1",
        "-an",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-threads", "1",
        "-filter_threads", "1",
        "-pix_fmt", "yuv420p",
        "-r", "15",
        "-g", "30",
        "-movflags", "+faststart",
        clipPath
      ]);
      clipPaths.push(clipPath);
    }

    const concatPath = path.join(dir, "scene-list.txt");
    await writeFile(concatPath, clipPaths.map(clipPath => "file '" + clipPath + "'").join("\n"), "utf8");
    const outputPath = path.join(dir, "rhyme.mp4");
    const args = ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-i", musicPath];
    let audioFilter;
    if (narrationBytes) {
      args.push("-i", narrationPath);
      audioFilter = "[1:a]volume=0.22[music];[2:a]volume=1.25[voice];[music][voice]amix=inputs=2:duration=longest:dropout_transition=2[aout]";
    } else {
      audioFilter = "[1:a]volume=0.22[aout]";
    }
    args.push(
      "-filter_complex", audioFilter,
      "-map", "0:v:0",
      "-map", "[aout]",
      "-t", String(duration),
      "-c:v", "copy",
      "-threads", "1",
      "-c:a", "aac",
      "-b:a", "96k",
      "-movflags", "+faststart",
      outputPath
    );
    await runFfmpeg(ffmpegPath, args);
    const video = await readFile(outputPath);
    if (video.length < 10000 || video.subarray(4, 8).toString() !== "ftyp") {
      throw new Error("FFmpeg output did not pass the MP4 container validation.");
    }
    return {
      video,
      thumbnail: thumb,
      narration: narrationBytes,
      narrationError,
      durationSeconds: duration,
      sceneCount: scenes.length,
      resolution: "854x480",
      frameRate: 15,
      audio: { music: "original_synthesized_instrumental", narration: narrationBytes ? "offline_espeak_ng_synthesized_voice" : "unavailable_rendered_with_instrumental_only" },
      renderStyle: "original_2d_vector_cartoon"
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
