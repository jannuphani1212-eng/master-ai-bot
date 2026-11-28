import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const MAX_VALIDATION_FILES = 40;
const MAX_VALIDATION_BYTES = 900_000;
const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const JSON_EXTENSIONS = new Set([".json"]);

function result(checks) {
  const failed = checks.filter(item => item.status === "failed");
  const passed = checks.filter(item => item.status === "passed");
  const skipped = checks.filter(item => item.status === "skipped");
  return {
    success: failed.length === 0,
    status: failed.length ? "failed" : "passed",
    summary: failed.length
      ? failed.length + " check(s) failed; " + passed.length + " passed."
      : passed.length + " check(s) passed; " + skipped.length + " check(s) skipped.",
    checks,
    executionPolicy: "Source code was parsed and inspected only. No project code, install scripts, build scripts, binaries, or network requests were executed."
  };
}

export function validateAppProjectFiles(files, options = {}) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_VALIDATION_FILES) {
    throw new Error("Validation requires between 1 and " + MAX_VALIDATION_FILES + " saved files.");
  }
  const totalBytes = files.reduce((sum, file) => sum + Buffer.byteLength(String(file?.content || ""), "utf8"), 0);
  if (totalBytes > MAX_VALIDATION_BYTES) throw new Error("Project source exceeds the 900 KB validation limit.");

  const checks = [];
  const availablePaths = new Set(files.map(file => String(file?.file_path || file?.filePath || "").replace(/\\/g, "/").replace(/^\.\//, "")));
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "master-ai-project-check-"));
  try {
    for (const file of files) {
      const filePath = String(file?.file_path || file?.filePath || "");
      const content = String(file?.content || "");
      const extension = path.extname(filePath).toLowerCase();
      if (JS_EXTENSIONS.has(extension)) {
        const tempFile = path.join(tempDir, "source-" + checks.length + ".mjs");
        writeFileSync(tempFile, content, "utf8");
        const parsed = spawnSync(process.execPath, ["--check", tempFile], {
          encoding: "utf8",
          timeout: 10000,
          maxBuffer: 64 * 1024
        });
        checks.push({
          file: filePath,
          type: "javascript-syntax",
          status: parsed.status === 0 ? "passed" : "failed",
          message: parsed.status === 0
            ? "JavaScript syntax is valid."
            : String(parsed.stderr || parsed.error?.message || "JavaScript syntax check failed.").trim().slice(0, 1200)
        });
      } else if (JSON_EXTENSIONS.has(extension)) {
        try {
          JSON.parse(content);
          checks.push({ file: filePath, type: "json-parse", status: "passed", message: "JSON is valid." });
        } catch (error) {
          checks.push({ file: filePath, type: "json-parse", status: "failed", message: String(error.message).slice(0, 500) });
        }
      } else if (extension === ".html" || extension === ".htm") {
        const hasDocumentRoot = /<html(?:\s|>)/i.test(content) && /<\/html\s*>/i.test(content);
        const hasHeadAndBody = /<head(?:\s|>)/i.test(content) && /<body(?:\s|>)/i.test(content);
        const localAssetRefs = [...content.matchAll(/(?:src|href)\s*=\s*["']([^"'#]+)["']/gi)]
          .map(match => match[1].trim())
          .filter(ref => !/^(?:[a-z]+:|\/\/|#|data:)/i.test(ref));
        const missingAssets = localAssetRefs.filter(ref => {
          const cleanRef = ref.split(/[?#]/)[0];
          const normalizedFile = filePath.replace(/\\/g, "/");
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(normalizedFile), cleanRef));
          return !availablePaths.has(resolved) && !availablePaths.has(cleanRef.replace(/^\.\//, ""));
        });
        const structureValid = hasDocumentRoot && hasHeadAndBody;
        checks.push({
          file: filePath,
          type: "html-document-structure",
          status: structureValid ? "passed" : "failed",
          message: structureValid
            ? "Basic HTML document structure is present (not a full HTML conformance check)."
            : "Expected html, head, and body document elements."
        });
        checks.push({
          file: filePath,
          type: "local-asset-integrity",
          status: missingAssets.length ? "failed" : "passed",
          message: missingAssets.length
            ? "Missing local asset file(s): " + missingAssets.join(", ")
            : "All referenced local script and stylesheet files are present."
        });
      } else if (extension === ".css") {
        let depth = 0;
        let invalid = false;
        for (const char of content) {
          if (char === "{") depth++;
          if (char === "}") depth--;
          if (depth < 0) invalid = true;
        }
        const valid = !invalid && depth === 0;
        checks.push({
          file: filePath,
          type: "css-brace-balance",
          status: valid ? "passed" : "failed",
          message: valid ? "CSS braces are balanced (not a full CSS conformance check)." : "CSS braces are unbalanced."
        });
      } else {
        checks.push({
          file: filePath,
          type: "file-review",
          status: "skipped",
          message: "No automated parser is configured for this file type; source was not executed."
        });
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (options.projectType === "game_3d") {
    const html = files.filter(file => /\\.html?$/i.test(String(file?.file_path || file?.filePath || ""))).map(file => String(file.content || "")).join("\\n");
    const scripts = files.filter(file => /\\.(?:m?js|cjs)$/i.test(String(file?.file_path || file?.filePath || ""))).map(file => String(file.content || "")).join("\\n");
    const hasCanvas = /<canvas\\b/i.test(html);
    const has3DContext = /\\.getContext\\s*\\(\\s*["'](?:webgl2?|webgpu)["']/i.test(scripts);
    const hasRenderLoop = /requestAnimationFrame\\s*\\(|setAnimationLoop\\s*\\(/i.test(scripts);
    const has3DRenderer = /createShader\\s*\\(|createProgram\\s*\\(|drawArrays\\s*\\(|drawElements\\s*\\(|WebGLRenderer|GPUCanvasContext|GPUDevice/i.test(scripts);
    const valid3DStructure = hasCanvas && has3DContext && hasRenderLoop && has3DRenderer;
    checks.push({
      file: "project",
      type: "3d-runtime-structure",
      status: valid3DStructure ? "passed" : "failed",
      message: valid3DStructure
        ? "A canvas, WebGL/WebGPU context, animation loop and 3D rendering API are present. This is structural validation only; the game was not executed or visually tested."
        : "A game_3d project must include a canvas, a real WebGL/WebGPU context, an animation loop, and a 3D rendering API such as shaders/draw calls or a supported renderer. A 2D canvas alone is not a 3D game."
    });
  }
  return result(checks);
}
