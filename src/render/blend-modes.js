// Software blend modes. 10 modes implemented as a branchless GLSL switch over
// an integer uniform — single shader handles them all, no recompile on change.
// Formulas follow W3C Compositing & Blending Level 1.
//
// Composite order: result = blend(below, above) then alpha-over with above.alpha.
// Layers below are sampled from the accumulator texture (the surface's FBO so far).
// Layers above are the layer being added.

export const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay',
  'soft-light', 'color-dodge', 'linear-burn',
  'difference', 'add', 'exclusion',
];

export function blendIndex(name) {
  const i = BLEND_MODES.indexOf(name);
  return i < 0 ? 0 : i;
}

// GLSL helpers. Operations operate on premultiplied-undone color (straight RGB).
// The compositor stores premultiplied alpha in the accumulator; the helpers
// convert back to straight before blending and re-premultiply at output.
export const BLEND_GLSL = `
  // Per-channel ops. above = src (layer being added), below = dst (accumulator).
  float bm_normal     (float a, float b) { return a; }
  float bm_multiply   (float a, float b) { return a * b; }
  float bm_screen     (float a, float b) { return 1.0 - (1.0 - a) * (1.0 - b); }
  float bm_overlay    (float a, float b) { return b < 0.5 ? 2.0*a*b : 1.0 - 2.0*(1.0-a)*(1.0-b); }
  float bm_softlight  (float a, float b) {
    // Pegtop formulation
    return (1.0 - 2.0*a) * b * b + 2.0 * a * b;
  }
  float bm_colordodge (float a, float b) {
    return a >= 0.999 ? 1.0 : clamp(b / (1.0 - a), 0.0, 1.0);
  }
  float bm_linearburn (float a, float b) { return clamp(a + b - 1.0, 0.0, 1.0); }
  float bm_difference (float a, float b) { return abs(a - b); }
  float bm_add        (float a, float b) { return clamp(a + b, 0.0, 1.0); }
  float bm_exclusion  (float a, float b) { return a + b - 2.0*a*b; }

  vec3 blendRGB(int mode, vec3 above, vec3 below) {
    if (mode == 0) return above;
    if (mode == 1) return vec3(bm_multiply(above.r, below.r), bm_multiply(above.g, below.g), bm_multiply(above.b, below.b));
    if (mode == 2) return vec3(bm_screen(above.r, below.r),   bm_screen(above.g, below.g),   bm_screen(above.b, below.b));
    if (mode == 3) return vec3(bm_overlay(above.r, below.r),  bm_overlay(above.g, below.g),  bm_overlay(above.b, below.b));
    if (mode == 4) return vec3(bm_softlight(above.r, below.r),bm_softlight(above.g, below.g),bm_softlight(above.b, below.b));
    if (mode == 5) return vec3(bm_colordodge(above.r, below.r),bm_colordodge(above.g, below.g),bm_colordodge(above.b, below.b));
    if (mode == 6) return vec3(bm_linearburn(above.r, below.r),bm_linearburn(above.g, below.g),bm_linearburn(above.b, below.b));
    if (mode == 7) return vec3(bm_difference(above.r, below.r),bm_difference(above.g, below.g),bm_difference(above.b, below.b));
    if (mode == 8) return vec3(bm_add(above.r, below.r),      bm_add(above.g, below.g),      bm_add(above.b, below.b));
    if (mode == 9) return vec3(bm_exclusion(above.r, below.r),bm_exclusion(above.g, below.g),bm_exclusion(above.b, below.b));
    return above;
  }
`;
