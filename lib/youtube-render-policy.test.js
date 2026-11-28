import test from "node:test";
import assert from "node:assert/strict";
import { evaluateYoutubeRenderRequest } from "./youtube-render-policy.js";

test("defaults YouTube production to true 3D and blocks the current 2D renderer", () => {
  const result = evaluateYoutubeRenderRequest({});
  assert.equal(result.allowed, false);
  assert.equal(result.renderStyle, "true_3d_required");
  assert.equal(result.code, "TRUE_3D_RENDERER_UNAVAILABLE");
  assert.match(result.message, /only creates 2D vector scene cards/);
});

test("explicit 3D requests never silently fall back to 2D", () => {
  const result = evaluateYoutubeRenderRequest({ visual_style: "3D" });
  assert.equal(result.allowed, false);
  assert.equal(result.explicitFallback, false);
});

test("legacy 2D rendering requires an explicit opt-in", () => {
  assert.equal(evaluateYoutubeRenderRequest({ visual_style: "2d" }).allowed, false);
  const result = evaluateYoutubeRenderRequest({ visual_style: "2d", allow_2d_fallback: true });
  assert.equal(result.allowed, true);
  assert.equal(result.renderStyle, "original_2d_vector_cartoon");
  assert.equal(result.explicitFallback, true);
});
