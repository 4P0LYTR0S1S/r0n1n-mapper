// Post-effect shaders — operate on an INPUT texture (everything composited
// below them in the surface's layer stack) rather than generating their own
// content. Differs from shader-effects.js (generator effects) in:
//   - All effects receive `u_src` sampler2D = the surface accumulator
//   - No FBO managed by the layer runtime — the compositor's ping-pong
//     accumulator IS the working surface
//   - Audio uniform contract identical to shader-effects.js
//
// v0.7.0 — Glitch / datamosh lookalike pack. The shader stack here delivers
// ~80% of the perceptual "real datamosh" look at ~1 day/effect, without the
// 3-week WebCodecs bitstream-surgery build.

const COMMON_POST = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_src;
  uniform float u_time;
  uniform vec2  u_res;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_env;
  uniform float u_beat;
  uniform float u_bpm;
  uniform float u_sub;
  uniform float u_kick;
  uniform float u_lowMid;
  uniform float u_highMid;
  uniform float u_air;
  uniform float u_peakKick;
  uniform float u_peakAir;
  uniform float u_onset;
  uniform float u_beatMod4;
  uniform float u_barMod16;
  uniform float u_phrasePos;
  uniform float u_dropFlag;
`;

const VERT_POST = `
  precision highp float;
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const HASH_POST = `
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec2  hash22(vec2 p) { return vec2(hash21(p), hash21(p + 17.0)); }
`;

// ---- RGB Channel Shift ----
// Three-channel chromatic aberration pumped by onset + drop. Subtle by default,
// goes wild on transients. The "VHS tracking issue" classic.
const RGB_SHIFT_FRAG = `${COMMON_POST}
  uniform float u_amount;     // 0..0.05 base offset
  uniform float u_onsetGain;  // 0..3, how much onset multiplies the offset
  void main() {
    float a = u_amount + u_onset * u_amount * u_onsetGain + u_dropFlag * u_amount * 1.5;
    // R goes right, B goes left, G stays
    float r = texture2D(u_src, v_uv + vec2( a, 0.0)).r;
    float g = texture2D(u_src, v_uv                ).g;
    float b = texture2D(u_src, v_uv + vec2(-a, 0.0)).b;
    float al = texture2D(u_src, v_uv).a;
    gl_FragColor = vec4(r, g, b, al);
  }
`;

// ---- Scanline Tear ----
// Per-row hash-driven horizontal UV offset; sparse rows torn by threshold gate
// modulated by onset. Reads as broken signal / VHS tape damage.
const SCANLINE_TEAR_FRAG = `${COMMON_POST}${HASH_POST}
  uniform float u_density;    // 0..1, fraction of rows torn (default 0.1)
  uniform float u_maxOffset;  // 0..0.2 max horizontal shift in uv units
  void main() {
    float row = floor(v_uv.y * u_res.y);
    // Per-row noise — also varies slowly with time so the pattern evolves
    float rowSeed = hash21(vec2(row, floor(u_time * 8.0)));
    // Onset boosts density and amount
    float dens = u_density + u_onset * 0.5;
    float amt  = u_maxOffset * (1.0 + u_onset * 2.0 + u_dropFlag * 3.0);
    float tear = rowSeed < dens ? (hash21(vec2(row, floor(u_time * 16.0))) - 0.5) * amt : 0.0;
    vec4 c = texture2D(u_src, vec2(v_uv.x + tear, v_uv.y));
    gl_FragColor = c;
  }
`;

// ---- Block Displace ----
// Quantize UVs to N×N grid, hash each block → per-block UV offset. Mimics
// motion-vector corruption / macroblock artifacts in compressed video. THE
// signature datamosh look. Onset spikes the offset amplitude.
const BLOCK_DISPLACE_FRAG = `${COMMON_POST}${HASH_POST}
  uniform float u_blockSize;  // 0.02..0.2 (uv units) — bigger = chunkier
  uniform float u_amount;     // 0..0.2 — base displacement
  uniform float u_jitter;     // 0..1 — how often blocks displace (threshold)
  void main() {
    vec2 block = floor(v_uv / u_blockSize);
    // Quantize time so blocks "tick" rather than crawl continuously
    float t = floor(u_time * (4.0 + u_kick * 30.0));
    vec2 jitterVec = hash22(block + vec2(t)) - 0.5;
    float threshGate = hash21(block + vec2(t, 7.0));
    float gate = step(1.0 - u_jitter - u_onset * 0.5 - u_dropFlag * 0.6, threshGate);
    float amp = u_amount * (1.0 + u_onset * 2.0 + u_dropFlag * 1.5);
    vec2 offset = jitterVec * amp * gate;
    vec4 c = texture2D(u_src, v_uv + offset);
    gl_FragColor = c;
  }
`;

// ---- ASCII / Halftone ----
// Quantize source brightness to one of N characters (encoded as procedural
// SDF shapes — '·', '+', '*', '#'). Cell size + character set respond to bands.
// Gives any source a printed/terminal aesthetic identity.
const ASCII_FRAG = `${COMMON_POST}
  uniform float u_cellSize;   // 0.005..0.05 uv units (~6-50 px at 1024)
  uniform vec3  u_inkColor;
  uniform vec3  u_paperColor;
  // Procedural "character" — given cell-local uv in [0,1]² and intensity 0..1
  // returns 1 where the character ink is, 0 where paper.
  float drawChar(vec2 luv, float lum) {
    vec2 c = luv - 0.5;
    float dist = length(c);
    if (lum < 0.15) return 0.0;                            // space (paper)
    if (lum < 0.30) return step(0.07, 0.08 - dist);        // dot
    if (lum < 0.45) return max(step(0.04, abs(c.x)) * step(abs(c.y), 0.06) + step(0.04, abs(c.y)) * step(abs(c.x), 0.06), 0.0);  // + cross
    if (lum < 0.65) return step(0.07, 0.18 - dist);        // bigger dot
    if (lum < 0.85) return step(abs(c.x) - 0.05, abs(c.y)) * step(abs(c.y) - 0.05, abs(c.x)) * step(dist, 0.32);  // diamond-ish *
    return step(dist, 0.38);                                // full block #
  }
  void main() {
    float cell = u_cellSize * (1.0 + u_kick * 0.3);
    vec2 cellIdx  = floor(v_uv / cell);
    vec2 cellUv   = fract(v_uv / cell);
    vec2 sampleAt = (cellIdx + 0.5) * cell;
    vec4 src = texture2D(u_src, sampleAt);
    float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    // Onset pumps contrast — characters darken faster
    lum = pow(lum, 1.0 + u_onset * 0.5 + u_dropFlag * 0.7);
    float ink = drawChar(cellUv, lum);
    vec3 col = mix(u_paperColor, u_inkColor * (0.7 + lum), ink);
    gl_FragColor = vec4(col, src.a);
  }
`;

// ---- Pixel Sort ----
// Approximate pixel-sort: per-row, find a "max brightness within the row" and
// propagate it leftward for a stretch. Real pixel sort needs multi-pass; this
// single-pass version reads as a streaky/melty smear that beats well with music.
const PIXEL_SORT_FRAG = `${COMMON_POST}${HASH_POST}
  uniform float u_lengthBase;   // 0..0.3 base smear length in uv
  uniform float u_threshold;    // 0..1 luminance threshold to trigger smear
  void main() {
    vec4 base = texture2D(u_src, v_uv);
    float baseLum = dot(base.rgb, vec3(0.299, 0.587, 0.114));
    // Sample several pixels to the right looking for a brighter "seed"
    float smearLen = u_lengthBase * (1.0 + u_onset * 4.0 + u_dropFlag * 3.0);
    vec4 acc = base;
    float bestLum = baseLum;
    for (int i = 1; i <= 12; i++) {
      float dx = float(i) * smearLen / 12.0;
      vec4 s = texture2D(u_src, vec2(v_uv.x + dx, v_uv.y));
      float l = dot(s.rgb, vec3(0.299, 0.587, 0.114));
      if (l > bestLum && l > u_threshold) {
        bestLum = l;
        acc = s;
      }
    }
    gl_FragColor = acc;
  }
`;

// ---- Motion-Vector Smear (the datamosh hybrid) ----
// Combines feedback-style frame retention with block displacement. Holds the
// previous frame, displaces it block-wise, then mixes in the new frame at
// low alpha. Looks like real datamosh — frozen frame with drifting macroblocks.
// NOTE: this effect needs ping-pong access to its own previous frame. Since
// post-effects don't have their own FBO, we sample u_src (the just-composited
// stack below) and treat the most recent OUTPUT as the "prev frame" by reading
// the destination buffer's current contents (compositor uses ping-pong so this
// works if the destination isn't cleared before our draw — handled in
// post-shader-layer.js by NOT clearing the dst FBO for mv-smear).
const MV_SMEAR_FRAG = `${COMMON_POST}${HASH_POST}
  uniform sampler2D u_prev;     // previous frame's stack output
  uniform float u_decay;        // 0..1, retention factor (0.94 default)
  uniform float u_blockSize;    // 0..0.2 uv
  uniform float u_amount;       // 0..0.15 displacement
  void main() {
    // Block-displaced previous frame
    vec2 block = floor(v_uv / u_blockSize);
    float t = floor(u_time * 4.0);
    vec2 jit = (hash22(block + vec2(t)) - 0.5) * u_amount * (1.0 + u_onset * 2.0);
    vec4 prev = texture2D(u_prev, v_uv + jit);
    vec4 fresh = texture2D(u_src, v_uv);
    float decay = clamp(u_decay + u_onset * 0.04 + u_dropFlag * 0.05, 0.0, 0.998);
    vec3 col = prev.rgb * decay + fresh.rgb * (1.0 - decay);
    gl_FragColor = vec4(col, max(prev.a, fresh.a));
  }
`;

export const POST_EFFECTS = {
  'rgb-shift': {
    frag: RGB_SHIFT_FRAG, vert: VERT_POST,
    defaultParams: { amount: 0.004, onsetGain: 1.5 },
    schema: [
      { key: 'amount',    type: 'range', min: 0, max: 0.05, step: 0.001 },
      { key: 'onsetGain', type: 'range', min: 0, max: 4, step: 0.05 },
    ],
  },
  'scanline-tear': {
    frag: SCANLINE_TEAR_FRAG, vert: VERT_POST,
    defaultParams: { density: 0.1, maxOffset: 0.05 },
    schema: [
      { key: 'density',   type: 'range', min: 0, max: 0.8, step: 0.01 },
      { key: 'maxOffset', type: 'range', min: 0, max: 0.2, step: 0.005 },
    ],
  },
  'block-displace': {
    frag: BLOCK_DISPLACE_FRAG, vert: VERT_POST,
    defaultParams: { blockSize: 0.05, amount: 0.04, jitter: 0.5 },
    schema: [
      { key: 'blockSize', type: 'range', min: 0.01, max: 0.2, step: 0.005 },
      { key: 'amount',    type: 'range', min: 0, max: 0.2, step: 0.005 },
      { key: 'jitter',    type: 'range', min: 0, max: 1, step: 0.01 },
    ],
  },
  'ascii': {
    frag: ASCII_FRAG, vert: VERT_POST,
    defaultParams: {
      cellSize:   0.015,
      inkColor:   [0.0, 1.0, 0.85],
      paperColor: [0.02, 0.0, 0.05],
    },
    schema: [
      { key: 'cellSize',   type: 'range', min: 0.005, max: 0.05, step: 0.001 },
      { key: 'inkColor',   type: 'color' },
      { key: 'paperColor', type: 'color' },
    ],
  },
  'pixel-sort': {
    frag: PIXEL_SORT_FRAG, vert: VERT_POST,
    defaultParams: { lengthBase: 0.06, threshold: 0.5 },
    schema: [
      { key: 'lengthBase', type: 'range', min: 0, max: 0.3, step: 0.005 },
      { key: 'threshold',  type: 'range', min: 0, max: 1, step: 0.01 },
    ],
  },
  'mv-smear': {
    frag: MV_SMEAR_FRAG, vert: VERT_POST, feedback: true,
    defaultParams: { decay: 0.94, blockSize: 0.05, amount: 0.04 },
    schema: [
      { key: 'decay',     type: 'range', min: 0.7, max: 0.99, step: 0.005 },
      { key: 'blockSize', type: 'range', min: 0.01, max: 0.2, step: 0.005 },
      { key: 'amount',    type: 'range', min: 0, max: 0.2, step: 0.005 },
    ],
  },
};

export const POST_EFFECT_NAMES = Object.keys(POST_EFFECTS);
