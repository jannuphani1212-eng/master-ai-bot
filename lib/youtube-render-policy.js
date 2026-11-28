export function evaluateYoutubeRenderRequest(body = {}) {
  const requestedStyle = String(body.visual_style || body.visualStyle || body.render_style || "3d")
    .trim()
    .toLowerCase();

  // The current built-in renderer creates 2D SVG/vector scene cards. It must
  // never be selected implicitly for a request whose target is true 3D.
  if (requestedStyle === "2d" && body.allow_2d_fallback === true) {
    return {
      allowed: true,
      renderStyle: "original_2d_vector_cartoon",
      explicitFallback: true,
      message: "Owner explicitly requested the legacy 2D renderer."
    };
  }

  return {
    allowed: false,
    renderStyle: "true_3d_required",
    explicitFallback: false,
    code: "TRUE_3D_RENDERER_UNAVAILABLE",
    message: "True 3D video generation is not configured. The current built-in renderer only creates 2D vector scene cards, so no 2D substitute was generated. A verified free 3D video provider and render pipeline are required."
  };
}
