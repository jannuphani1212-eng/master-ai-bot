import test from "node:test";
import assert from "node:assert/strict";
import { validateAppProjectFiles } from "./app-project-validation.js";

test("validates JavaScript syntax without executing project code", () => {
  const result = validateAppProjectFiles([
    { file_path: "src/main.js", content: "const answer = 42; export default answer;" }
  ]);
  assert.equal(result.success, true);
  assert.equal(result.checks[0].status, "passed");
  assert.match(result.executionPolicy, /No project code/);
});

test("reports JavaScript syntax errors", () => {
  const result = validateAppProjectFiles([
    { file_path: "src/main.js", content: "function broken( {" }
  ]);
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
  assert.deepEqual(result.checks.map(item => item.status), ["passed", "passed", "skipped"]);
});

test("rejects empty or oversized validation input", () => {
  assert.throws(() => validateAppProjectFiles([]), /between 1 and/);
  assert.throws(() => validateAppProjectFiles([{ file_path: "large.txt", content: "x".repeat(900001) }]), /900 KB/);
});
