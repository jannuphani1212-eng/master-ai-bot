import test from "node:test";
import assert from "node:assert/strict";
import { validateAppProjectFiles } from "./app-project-validation.js";

test("validates JavaScript syntax without executing project code", () => {
  const result = validateAppProjectFiles([{ file_path: "src/main.js", content: "const answer = 42; export default answer;" }]);
  assert.equal(result.success, true);
  assert.equal(result.checks[0].status, "passed");
  assert.match(result.executionPolicy, /No project code/);
});

test("reports JavaScript syntax errors", () => {
  const result = validateAppProjectFiles([{ file_path: "src/main.js", content: "function broken( {" }]);
  assert.equal(result.success, false);
  assert.equal(result.checks[0].status, "failed");
});

test("validates JSON and reports malformed manifests", () => {
  const good = validateAppProjectFiles([{ file_path: "package.json", content: '{"name":"demo"}' }]);
  const bad = validateAppProjectFiles([{ file_path: "package.json", content: '{"name":' }]);
  assert.equal(good.success, true);
  assert.equal(bad.success, false);
});

test("checks basic HTML and CSS structure and marks unsupported files as skipped", () => {
  const result = validateAppProjectFiles([
    { file_path: "index.html", content: "<html><head></head><body></body></html>" },
    { file_path: "style.css", content: "body { color: red; }" },
    { file_path: "README.md", content: "# Demo" }
  ]);
  assert.deepEqual(result.checks.map(item => item.status), ["passed", "passed", "passed", "skipped"]);
});

test("requires a genuine WebGL/WebGPU rendering structure for game_3d projects", () => {
  const valid = validateAppProjectFiles([
    { file_path: "index.html", content: "<html><head></head><body><canvas id='game'></canvas><script src='game.js'></script></body></html>" },
    { file_path: "game.js", content: "const canvas = document.querySelector('canvas'); const gl = canvas.getContext('webgl2'); const shader = gl.createShader(gl.VERTEX_SHADER); function frame(){ gl.drawArrays(gl.TRIANGLES,0,3); requestAnimationFrame(frame); } requestAnimationFrame(frame);" }
  ], { projectType: "game_3d" });
  assert.equal(valid.success, true);
  assert.ok(valid.checks.some(item => item.type === "3d-runtime-structure" && item.status === "passed"));
});

test("rejects a 2D canvas prototype labelled as game_3d", () => {
  const invalid = validateAppProjectFiles([
    { file_path: "index.html", content: "<html><head></head><body><canvas id='game'></canvas><script src='game.js'></script></body></html>" },
    { file_path: "game.js", content: "const canvas = document.querySelector('canvas'); const ctx = canvas.getContext('2d'); function frame(){ ctx.fillRect(0,0,10,10); requestAnimationFrame(frame); } requestAnimationFrame(frame);" }
  ], { projectType: "game_3d" });
  assert.equal(invalid.success, false);
  assert.ok(invalid.checks.some(item => item.type === "3d-runtime-structure" && item.status === "failed"));
});

test("rejects empty or oversized validation input", () => {
  assert.throws(() => validateAppProjectFiles([]), /between 1 and/);
  assert.throws(() => validateAppProjectFiles([{ file_path: "large.txt", content: "x".repeat(900001) }]), /900 KB/);
});


test("detects missing local scripts and stylesheets referenced by HTML", () => {
  const broken = validateAppProjectFiles([
    { file_path: "index.html", content: '<html><head><link rel="stylesheet" href="styles.css"><script src="game.js"></script></head><body></body></html>' }
  ]);
  assert.equal(broken.success, false);
  assert.ok(broken.checks.some(item => item.type === "local-asset-integrity" && item.status === "failed"));
});

test("accepts local scripts and stylesheets when the files are saved", () => {
  const valid = validateAppProjectFiles([
    { file_path: "index.html", content: '<html><head><link rel="stylesheet" href="./styles.css"><script src="./game.js"></script></head><body></body></html>' },
    { file_path: "styles.css", content: "body { margin: 0; }" },
    { file_path: "game.js", content: "const ready = true;" }
  ]);
  assert.equal(valid.success, true);
  assert.ok(valid.checks.some(item => item.type === "local-asset-integrity" && item.status === "passed"));
});
