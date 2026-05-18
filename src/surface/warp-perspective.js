// Perspective warp for a quad surface — 4-corner homography.
// Heckbert's closed-form solve for unit-square → arbitrary quad maps.
//
// Source UV space: corners at (0,0) (1,0) (1,1) (0,1) — ordered BL, BR, TR, TL in texture
// coords (y-up). Destination corners are in clip space (-1..1), matching the same ordering.
//
// The returned 3x3 matrix H satisfies: H * (u, v, 1) → (x*w, y*w, w) in clip space,
// where dividing by w gives the on-screen position. By writing gl_Position = vec4(q.xy, 0, q.z)
// in the vertex shader, the rasterizer applies the perspective divide AND interpolates
// varyings with perspective correction — so the diagonal pinch never appears, no
// tessellation needed.

export const CORNER_COUNT = 4;

// Default unit-square in clip space (full canvas).
export function defaultCorners() {
  return [
    [-1, -1],  // 0 BL
    [ 1, -1],  // 1 BR
    [ 1,  1],  // 2 TR
    [-1,  1],  // 3 TL
  ];
}

// Heckbert 1989 §3.3 — solve homography from unit-square to arbitrary quad.
// Returns a flat 9-element row-major Float32Array suitable for regl mat3 uniforms.
export function solveHomography(dst) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = dst;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const sx  = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sy  = y0 - y1 + y2 - y3;

  // Determinant of the 2x2 system for (h31, h32). If zero the four points are
  // collinear or coincident — return identity to keep render finite.
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-12) return identity();

  const h31 = (sx * dy2 - dx2 * sy) / det;
  const h32 = (dx1 * sy - sx * dy1) / det;
  const h11 = x1 - x0 + h31 * x1;
  const h12 = x3 - x0 + h32 * x3;
  const h13 = x0;
  const h21 = y1 - y0 + h31 * y1;
  const h22 = y3 - y0 + h32 * y3;
  const h23 = y0;

  // Row-major, but WebGL/regl mat3 uniforms expect column-major. Pack as column-major.
  // | h11 h12 h13 |       col0 = h11, h21, h31
  // | h21 h22 h23 |  -->  col1 = h12, h22, h32
  // | h31 h32  1  |       col2 = h13, h23, 1
  const out = new Float32Array(9);
  out[0] = h11; out[1] = h21; out[2] = h31;
  out[3] = h12; out[4] = h22; out[5] = h32;
  out[6] = h13; out[7] = h23; out[8] = 1.0;
  return out;
}

export function identity() {
  const m = new Float32Array(9);
  m[0] = 1; m[4] = 1; m[8] = 1;
  return m;
}

// Pick the nearest corner to a screen-space (clip) point within hitRadius.
// Returns the corner index 0..3 or -1.
export function pickCorner(corners, x, y, hitRadius = 0.04) {
  let best = -1;
  let bestD2 = hitRadius * hitRadius;
  for (let i = 0; i < CORNER_COUNT; i++) {
    const dx = corners[i][0] - x;
    const dy = corners[i][1] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  return best;
}

// GLSL strings — exported so the regl warp command can compile them.
// We use a single quad of 4 vertices with srcUV = unit square corners.
// gl_Position.w = q.z makes interpolation perspective-correct automatically.

export const WARP_VERT = `
  precision highp float;
  attribute vec2 a_srcUV;
  uniform mat3 u_H;
  varying vec2 v_uv;
  void main() {
    vec3 q = u_H * vec3(a_srcUV, 1.0);
    gl_Position = vec4(q.xy, 0.0, q.z);
    v_uv = a_srcUV;
  }
`;

export const WARP_FRAG = `
  precision highp float;
  uniform sampler2D u_tex;
  uniform float u_opacity;
  varying vec2 v_uv;
  void main() {
    // Sampling the compositor's FBO which is already in canvas orientation
    // (compositor handled the video y-flip via its u_flipY uniform per-layer).
    vec4 c = texture2D(u_tex, v_uv);
    gl_FragColor = vec4(c.rgb, c.a * u_opacity);
  }
`;

// Source UV attribute data for the warp quad — matches dst-corner ordering.
export const WARP_QUAD_UV = new Float32Array([
  0, 0,   // BL
  1, 0,   // BR
  1, 1,   // TR
  0, 1,   // TL
]);
// Two triangles, CCW from BL.
export const WARP_QUAD_ELEMENTS = new Uint16Array([0, 1, 2, 0, 2, 3]);
