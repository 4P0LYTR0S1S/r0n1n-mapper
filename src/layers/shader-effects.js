// Shader effects registry. Each is a fullscreen fragment shader producing
// color from time + audio uniforms + per-effect params. Effects flagged
// `feedback: true` opt into the ping-pong FBO path in shader-layer.js and
// receive `u_prev` (the previous frame's color as a sampler2D).
//
// Uniform contract (all effects, supplied by shader-layer.js):
//   Time / resolution
//     u_time      float        seconds since session start
//     u_res       vec2         render resolution
//   Legacy 3-band (backward-compat with pre-v0.6.0 shaders)
//     u_bass      float        [0..1]
//     u_mid       float        [0..1]
//     u_high      float        [0..1]
//     u_env       float        [0..1] (full-spectrum envelope)
//     u_beat      float        0 or 1 (one-frame pulse on bass-spike beat)
//     u_bpm       float        live BPM (MIDI clock or tap-tempo)
//   v0.6.0 — 5-band split (musically-tuned)
//     u_sub       float        [0..1] 20-60 Hz, weight
//     u_kick      float        [0..1] 60-120 Hz, the thump
//     u_lowMid    float        [0..1] 120-500 Hz, bass body
//     u_highMid   float        [0..1] 2-4 kHz, snare/clap/vocal presence
//     u_air       float        [0..1] 8-16 kHz, hi-hat/cymbal sparkle
//   v0.6.0 — peak hold (slow decay)
//     u_peakKick  float        [0..1]
//     u_peakAir   float        [0..1]
//   v0.6.0 — onset / phrase / drop
//     u_onset     float        0 or 1 (cleaner than u_beat — fires on any transient)
//     u_beatMod4  float        [0..4) continuous, floor() = beat-in-bar
//     u_barMod16  float        [0..16) continuous, floor() = bar-in-phrase
//     u_phrasePos float        [0..1] ramp inside an 8-bar phrase
//     u_dropFlag  float        0 or 1 (held for 800ms after a detected drop)
//   Feedback effects only:
//     u_prev      sampler2D    previous frame's color attachment (for trails / smear / shockwave)
//
// Effect-specific params come from layer.params and are documented per-effect.

const COMMON = `
  precision highp float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec2  u_res;
  // Legacy 3-band
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_env;
  uniform float u_beat;
  uniform float u_bpm;
  // v0.6.0 5-band
  uniform float u_sub;
  uniform float u_kick;
  uniform float u_lowMid;
  uniform float u_highMid;
  uniform float u_air;
  // v0.6.0 peak hold
  uniform float u_peakKick;
  uniform float u_peakAir;
  // v0.6.0 onset / phrase / drop
  uniform float u_onset;
  uniform float u_beatMod4;
  uniform float u_barMod16;
  uniform float u_phrasePos;
  uniform float u_dropFlag;
`;

const VERT = `
  precision highp float;
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const NOISE = `
  // 2D hash + value noise + FBM. iq-style.
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec2  hash22(vec2 p) { return vec2(hash21(p), hash21(p + 17.0)); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float amp = 0.5;
    for (int i = 0; i < 5; i++) { v += amp * noise(p); p *= 2.0; amp *= 0.5; }
    return v;
  }
`;

// ---- FBM (domain-warped noise) ----
const FBM_FRAG = `${COMMON}${NOISE}
  uniform float u_scale;
  uniform vec3  u_tint;
  void main() {
    vec2 p = (v_uv - 0.5) * u_scale + vec2(u_time * 0.05);
    float warp = fbm(p + vec2(fbm(p + u_time * 0.3), fbm(p - u_time * 0.2)));
    float v = fbm(p * 1.5 + warp);
    vec3 col = mix(vec3(0.02, 0.03, 0.08), u_tint, v + u_bass * 0.4);
    col += u_high * 0.2 * smoothstep(0.4, 0.9, fract(v * 4.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---- FFT bars (audio reactive) ----
const FFT_FRAG = `${COMMON}
  uniform sampler2D u_fft;
  uniform vec3 u_color;
  void main() {
    float bar = texture2D(u_fft, vec2(v_uv.x, 0.5)).r;
    float h = bar * 1.5;
    float a = step(1.0 - h, v_uv.y);
    vec3 col = mix(vec3(0.02), u_color, a);
    col += step(1.0 - h - 0.01, v_uv.y) * (1.0 - a) * u_color * u_beat;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---- Kaleidoscope (radial mirror over an internal pattern) ----
const KALEIDO_FRAG = `${COMMON}${NOISE}
  uniform float u_segments;
  void main() {
    vec2 p = (v_uv - 0.5) * 2.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float seg = 6.2831853 / u_segments;
    a = abs(mod(a, seg) - seg * 0.5);
    p = vec2(cos(a), sin(a)) * r;
    float v = fbm(p * 3.0 + u_time * 0.2 + u_mid * 2.0);
    vec3 col = vec3(v * 0.4 + u_bass * 0.5, v * 0.7, 1.0 - v) * (0.5 + u_env);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---- VHS (chromatic aberration + scanlines + noise) ----
const VHS_FRAG = `${COMMON}${NOISE}
  uniform float u_aberration;
  uniform vec3  u_tint;
  void main() {
    vec2 uv = v_uv;
    float dy = (sin(u_time * 2.0 + uv.y * 30.0) * 0.5 + 0.5) * 0.003 * u_high;
    uv.x += dy;
    float jit = (hash21(vec2(floor(uv.y * 360.0), floor(u_time * 30.0))) - 0.5) * 0.01;
    vec2 base = uv + vec2(jit, 0.0);
    float r = noise(base * 12.0 + u_time);
    float g = noise(base * 12.0 + u_time + 1.7);
    float b = noise(base * 12.0 + u_time + 3.1);
    vec3 col = vec3(r, g, b) * u_tint;
    // chromatic aberration
    col.r = noise((base + vec2(u_aberration, 0.0)) * 12.0 + u_time);
    col.b = noise((base - vec2(u_aberration, 0.0)) * 12.0 + u_time + 3.1);
    // scanlines
    col *= 0.7 + 0.3 * sin(uv.y * u_res.y * 1.5);
    // noise grain
    col += (hash21(uv * u_res + u_time) - 0.5) * 0.15;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---- Plasma (classic sin-wave plasma) ----
const PLASMA_FRAG = `${COMMON}
  uniform vec3 u_colorA;
  uniform vec3 u_colorB;
  void main() {
    vec2 p = (v_uv - 0.5) * 6.0;
    float t = u_time * 0.6;
    float v = sin(p.x + t) + sin(p.y + t * 1.1) + sin((p.x + p.y) * 0.5 + t) + sin(length(p) * 0.8 - t);
    v = v * 0.25 + u_bass * 0.3;
    vec3 col = mix(u_colorA, u_colorB, 0.5 + 0.5 * sin(v * 3.14159));
    gl_FragColor = vec4(col * (0.5 + u_env * 0.5), 1.0);
  }
`;

// ---- Raymarched SDF scene ----
const RAYMARCH_FRAG = `${COMMON}
  float sdSphere(vec3 p, float r) { return length(p) - r; }
  float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
  float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0 - h); }
  float scene(vec3 p) {
    float t = u_time * 0.5;
    p.xz *= mat2(cos(t), -sin(t), sin(t), cos(t));
    float s = sdSphere(p - vec3(sin(t) * 0.6, 0.0, 0.0), 0.5 + u_bass * 0.2);
    float b = sdBox(p + vec3(0.6, 0.0, 0.0), vec3(0.4));
    return smin(s, b, 0.4);
  }
  vec3 normalAt(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
      scene(p + e.xyy) - scene(p - e.xyy),
      scene(p + e.yxy) - scene(p - e.yxy),
      scene(p + e.yyx) - scene(p - e.yyx)
    ));
  }
  void main() {
    vec2 uv = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0) * 2.0;
    vec3 ro = vec3(0.0, 0.5, 2.5);
    vec3 rd = normalize(vec3(uv, -1.5));
    float tot = 0.0;
    for (int i = 0; i < 64; i++) {
      vec3 p = ro + rd * tot;
      float d = scene(p);
      if (d < 0.001 || tot > 20.0) break;
      tot += d;
    }
    vec3 col = vec3(0.02, 0.02, 0.05);
    if (tot < 20.0) {
      vec3 p = ro + rd * tot;
      vec3 n = normalAt(p);
      float diff = max(dot(n, normalize(vec3(0.5, 0.8, 0.6))), 0.0);
      col = mix(vec3(0.1, 0.3, 0.9), vec3(1.0, 0.4, 0.6), 0.5 + 0.5 * n.y);
      col *= (0.3 + 0.7 * diff);
      col += u_high * vec3(0.4, 0.6, 1.0) * pow(max(dot(reflect(rd, n), normalize(vec3(0.5, 0.8, 0.6))), 0.0), 16.0);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Wire Frame Dancer — procedural stick figure animated by audio bands.
//   u_bass    → hip vertical bounce + knee bend (kick = squat)
//   u_mid     → shoulder/elbow swing amplitude (torso sway)
//   u_high    → wrist/ankle jitter (hi-hat = twitch)
//   u_beat    → joint flash + 1-frame limb-length pop
//   u_bpm     → phase clock for limb sway (locks dance to grid)
//   u_env     → overall figure scale
// Params:
//   bones (color)  — tint of bones
//   joints (color) — tint of joints (also drives beat flash)
//   bg (color)     — background fill
//   thick (float)  — bone capsule thickness in screen-uv units
const DANCER_FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform vec2 u_res;
  uniform float u_time;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_env;
  uniform float u_beat;
  uniform float u_bpm;
  uniform vec3  u_bones;
  uniform vec3  u_joints;
  uniform vec3  u_bg;
  uniform float u_thick;

  const float TAU = 6.2831853;

  float sdSegment(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  vec2 hash22(vec2 p) { return vec2(hash21(p), hash21(p + 17.0)); }

  void main() {
    // aspect-correct uv centered on figure, y up
    vec2 uv = v_uv;
    uv.x = (uv.x - 0.5) * (u_res.x / u_res.y) + 0.5;

    // phase clock: locks to BPM when present, else free-runs at 2Hz
    float bpm = max(u_bpm, 90.0);
    float phi = u_time * (bpm / 60.0) * TAU * 0.25;  // quarter-note dance bounce

    // Figure scale grows slightly with envelope
    float scale = (0.40 + u_env * 0.05) / (1.0 + 0.2 * u_bass);

    // Anchor at lower-center; bass pushes hips DOWN (squat into kick)
    vec2 root = vec2(0.5, 0.30);
    // v0.4.2 wiggle pass: amplitudes ~2× v0.4.1. Joints have more visible
    // travel + bass + beat reaction. Combined with default audioIntensity 1.5,
    // the figure noticeably grooves instead of swaying.
    float bounce = sin(phi) * 0.035 - u_bass * 0.090;
    vec2 hip   = root + vec2(0.0, scale * 0.20 + bounce);
    vec2 spine = hip  + vec2(sin(phi * 0.5) * 0.030 * u_mid, scale * 0.20);
    vec2 shldr = spine + vec2(sin(phi * 0.5) * 0.012 * u_mid, scale * 0.10);
    vec2 head  = shldr + vec2(sin(phi * 0.5) * 0.025, scale * 0.10 + u_env * 0.030);

    // Arms — left and right phase-offset by π (natural opposite-arm swing)
    float armSwingL = sin(phi + 3.14159) * (0.55 + u_mid * 1.8);
    float armSwingR = sin(phi)           * (0.55 + u_mid * 1.8);
    vec2 shldrL = shldr + vec2(-scale * 0.07, 0.0);
    vec2 shldrR = shldr + vec2( scale * 0.07, 0.0);
    vec2 elbowL = shldrL + vec2(-scale * 0.05, -scale * 0.10) * (1.0 + 0.65 * armSwingL);
    vec2 elbowR = shldrR + vec2( scale * 0.05, -scale * 0.10) * (1.0 + 0.65 * armSwingR);
    vec2 wristL = elbowL + vec2(-scale * 0.03 + sin(phi * 1.7) * 0.045, -scale * 0.08)
                  + hash22(vec2(phi, 1.0)) * 0.025 * u_high;
    vec2 wristR = elbowR + vec2( scale * 0.03 + sin(phi * 1.7) * 0.045, -scale * 0.08)
                  + hash22(vec2(phi, 2.0)) * 0.025 * u_high;

    // Legs — opposite phase to arms for walking-style gait
    float legSwingL = sin(phi)           * (0.35 + u_mid * 0.8);
    float legSwingR = sin(phi + 3.14159) * (0.35 + u_mid * 0.8);
    // Knee bend deepens with bass — proper squat on kicks
    float kneeBend = 0.5 + u_bass * 0.8;
    vec2 hipL = hip + vec2(-scale * 0.05, 0.0);
    vec2 hipR = hip + vec2( scale * 0.05, 0.0);
    vec2 kneeL = hipL + vec2(-scale * 0.04 + legSwingL * scale * 0.12, -scale * 0.13 * kneeBend);
    vec2 kneeR = hipR + vec2( scale * 0.04 + legSwingR * scale * 0.12, -scale * 0.13 * kneeBend);
    vec2 ankleL = kneeL + vec2(-scale * 0.02 + legSwingL * scale * 0.08, -scale * 0.13 * kneeBend)
                  + hash22(vec2(phi, 3.0)) * 0.018 * u_high;
    vec2 ankleR = kneeR + vec2( scale * 0.02 + legSwingR * scale * 0.08, -scale * 0.13 * kneeBend)
                  + hash22(vec2(phi, 4.0)) * 0.018 * u_high;

    // Bones — union of capsule SDFs
    float t = u_thick * (1.0 + 0.3 * u_beat);
    float d = 1e9;
    d = min(d, sdSegment(uv, hip, spine, t));          // lower spine
    d = min(d, sdSegment(uv, spine, shldr, t));        // upper spine
    d = min(d, sdSegment(uv, shldr, head, t));         // neck
    d = min(d, sdSegment(uv, shldrL, elbowL, t));      // upper arm L
    d = min(d, sdSegment(uv, elbowL, wristL, t));      // forearm L
    d = min(d, sdSegment(uv, shldrR, elbowR, t));      // upper arm R
    d = min(d, sdSegment(uv, elbowR, wristR, t));      // forearm R
    d = min(d, sdSegment(uv, hipL, kneeL, t));         // thigh L
    d = min(d, sdSegment(uv, kneeL, ankleL, t));       // shin L
    d = min(d, sdSegment(uv, hipR, kneeR, t));         // thigh R
    d = min(d, sdSegment(uv, kneeR, ankleR, t));       // shin R

    // Head — solid disc
    float dHead = length(uv - head) - scale * 0.06;
    d = min(d, dHead);

    // AA bone mask
    float bone = smoothstep(0.003, 0.0, d);

    // Joint glows — bigger on beat
    float jointR = scale * 0.018 * (1.0 + u_beat * 1.5);
    float joints = 0.0;
    joints = max(joints, smoothstep(jointR, 0.0, length(uv - elbowL)));
    joints = max(joints, smoothstep(jointR, 0.0, length(uv - elbowR)));
    joints = max(joints, smoothstep(jointR, 0.0, length(uv - kneeL)));
    joints = max(joints, smoothstep(jointR, 0.0, length(uv - kneeR)));
    joints = max(joints, smoothstep(jointR, 0.0, length(uv - shldr)));
    joints = max(joints, smoothstep(jointR, 0.0, length(uv - hip)));

    vec3 col = u_bg;
    col = mix(col, u_bones, bone);
    col = mix(col, u_joints, joints * (0.6 + u_beat));

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ============================================================================
// v0.6.1 — Cheap-wow shader pack
// ============================================================================

// Feedback Trails — frame retention with fade decay. Each frame the previous
// frame is sampled at a slight zoom + rotation + fade, then a new pattern is
// drawn on top driven by audio bands. Builds standing wave patterns + droste
// tunnels automatically. Foundation effect for v0.6.1: every other feedback
// shader leans on this same ping-pong infrastructure.
const FEEDBACK_TRAILS_FRAG = `${COMMON}${NOISE}
  uniform sampler2D u_prev;
  uniform float u_decay;     // 0..1, how strong the previous frame persists (default 0.93)
  uniform float u_zoom;      // -0.2..0.2, per-frame zoom-in/out (default 0.005)
  uniform float u_rotate;    // -1..1 radians/sec rotation rate (default 0.1)
  uniform vec3  u_tint;
  uniform vec3  u_bgTint;
  void main() {
    // Sample previous frame with a slight zoom + rotation toward center.
    // The decay anchors how long trails persist; bass momentarily pushes
    // decay toward 1.0 (frozen frame) so kicks "freeze the moment."
    vec2 c = v_uv - 0.5;
    float r = u_rotate * 0.016 + u_kick * 0.04;  // rotation per frame, kick adds spin
    float z = u_zoom + u_lowMid * 0.012;          // mid-band swells the zoom
    float ca = cos(r), sa = sin(r);
    vec2 p = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y) * (1.0 - z) + 0.5;
    vec4 prev = texture2D(u_prev, p);

    // Effective decay — bumped on bass for momentary frame-freeze
    float decay = clamp(u_decay + u_kick * 0.07 + u_dropFlag * 0.06, 0.0, 0.999);
    vec3 retained = prev.rgb * decay;

    // New paint — fbm flowing field tinted by u_tint, energized by env
    vec2 q = (v_uv - 0.5) * 4.0 + vec2(u_time * 0.15);
    float v = fbm(q + vec2(fbm(q + u_time * 0.4), fbm(q - u_time * 0.3)));
    vec3 fresh = mix(u_bgTint, u_tint, v + u_env * 0.6) * (0.15 + u_env * 0.5);

    // Strobe-on-snare: u_onset jolt fully overrides retained frame for 1 frame.
    fresh += u_onset * u_air * 0.4;

    gl_FragColor = vec4(retained + fresh, 1.0);
  }
`;

// Shockwave — concentric rings radiating from center on every onset. Each
// ring is tracked as a (radius, age) pair encoded into the previous frame's
// alpha channel; on onset we inject a fresh ring. Reads as direct
// cause-and-effect with the music (the most legible beat-sync effect).
const SHOCKWAVE_FRAG = `${COMMON}
  uniform sampler2D u_prev;
  uniform vec3  u_ringColor;
  uniform vec3  u_bgColor;
  uniform float u_ringWidth;   // 0.005..0.05
  uniform float u_speed;       // 0.1..1.0, expansion rate
  void main() {
    // Read previous frame — use it as background canvas that gradually fades
    vec3 prev = texture2D(u_prev, v_uv).rgb * 0.94;

    // Distance from center, aspect-corrected
    vec2 c = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
    float r = length(c) * 2.0;

    // Phase clock drives ring 1 — expands from 0 over time, wraps at 1.5
    float t1 = fract(u_time * u_speed);
    float ring1 = smoothstep(u_ringWidth, 0.0, abs(r - t1)) * (1.0 - t1);

    // Bar-aligned ring 2 — fires on every beat (u_beatMod4 floor change)
    float beatPhase = fract(u_beatMod4);
    float ring2 = smoothstep(u_ringWidth, 0.0, abs(r - beatPhase)) * (1.0 - beatPhase) * 0.6;

    // Drop ring 3 — triggers on dropFlag, big and slow
    float dropPhase = u_dropFlag * (1.0 - fract(u_time * 0.5));
    float ring3 = smoothstep(u_ringWidth * 2.0, 0.0, abs(r - dropPhase * 1.5)) * dropPhase;

    vec3 col = mix(u_bgColor, prev, 0.7);
    col += u_ringColor * ring1 * (0.5 + u_kick * 1.5);
    col += u_ringColor * ring2 * (0.5 + u_highMid * 1.0);
    col += vec3(1.0, 0.3, 0.9) * ring3 * 1.5;

    // Onset flash — full-screen white pop on transients, very brief
    col += vec3(u_onset * u_highMid * 0.3);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// Truchet Tiles — wall of randomly-rotated arc tiles forming continuous curves
// and mazes. Lines pulse-glow on beat. Mathematically pristine, infinite
// without seams, projection-map-friendly on rectangular surfaces.
const TRUCHET_FRAG = `${COMMON}${NOISE}
  uniform float u_density;     // tile size in screen-uv (0.05..0.3)
  uniform vec3  u_lineColor;
  uniform vec3  u_bgColor;
  void main() {
    vec2 uv = v_uv * vec2(u_res.x / u_res.y, 1.0);
    float s = u_density;
    vec2 cell = floor(uv / s);
    vec2 f = fract(uv / s);

    // Random rotation per cell (4 possible) — also shifts by bar mod
    float rnd = hash21(cell + floor(u_barMod16 * 0.5));
    if (rnd < 0.5) f = vec2(1.0 - f.x, f.y);

    // Distance to two arcs forming this tile's curve
    float r1 = length(f) - 0.5;
    float r2 = length(f - vec2(1.0)) - 0.5;
    float d = min(abs(r1), abs(r2));

    // Line thickness pulses with kick + onset
    float thick = 0.05 + u_kick * 0.08 + u_onset * 0.12;
    float line = smoothstep(thick, 0.0, d);

    // Color shift per bar — hue rotates through colors on each new bar
    float barHue = floor(u_barMod16);
    vec3 lc = u_lineColor * (0.5 + 0.5 * cos(barHue * 1.5 + vec3(0.0, 2.094, 4.188)));

    vec3 col = mix(u_bgColor, lc * (0.6 + u_env * 0.8), line);
    // Drop invert
    col = mix(col, vec3(1.0) - col, u_dropFlag * 0.7);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Voronoi Shatter — plane fractures into cellular shards. Each cell jitters
// outward on transients; iridesces with phrase position. Glass-breaking read.
const VORONOI_FRAG = `${COMMON}${NOISE}
  uniform float u_scale;       // 4..32 cells across
  uniform vec3  u_colorA;
  uniform vec3  u_colorB;
  void main() {
    vec2 uv = v_uv * vec2(u_res.x / u_res.y, 1.0) * u_scale;
    vec2 cell = floor(uv);
    vec2 f = fract(uv);

    // Find nearest cell point — standard Voronoi
    float minDist = 99.0;
    vec2 cellOff;
    vec2 nearest;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 site = o + hash22(cell + o);
        // Site jitters outward on onset
        site += (hash22(cell + o + 17.0) - 0.5) * u_onset * 0.6;
        float d = length(site - f);
        if (d < minDist) {
          minDist = d;
          cellOff = o;
          nearest = site;
        }
      }
    }

    // Cell ID drives color — also phrasePos shifts the palette
    float id = hash21(cell + cellOff + floor(u_phrasePos * 4.0));
    vec3 col = mix(u_colorA, u_colorB, id);
    col *= (0.4 + u_env * 0.9);

    // Cell border on kick — edge brightness from distance-to-second-closest
    float second = 99.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 site = o + hash22(cell + o);
        site += (hash22(cell + o + 17.0) - 0.5) * u_onset * 0.6;
        float d = length(site - f);
        if (d > minDist + 0.001 && d < second) second = d;
      }
    }
    float edge = smoothstep(0.06, 0.0, second - minDist);
    col += edge * (0.3 + u_kick * 1.5);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Effect registry. Each entry: { frag, vert?, defaultParams, schema, feedback? }
// `feedback: true` opts into the ping-pong FBO path in shader-layer.js, which
// supplies the `u_prev` sampler2D uniform with the previous frame's color.
export const EFFECTS = {
  fbm: {
    frag: FBM_FRAG, vert: VERT,
    defaultParams: { scale: 4.0, tint: [1.0, 0.4, 0.8] },
    schema: [
      { key: 'scale', type: 'range', min: 1, max: 16, step: 0.1 },
      { key: 'tint',  type: 'color' },
    ],
  },
  'fft-bars': {
    frag: FFT_FRAG, vert: VERT,
    defaultParams: { color: [0.0, 1.0, 0.8] },
    schema: [
      { key: 'color', type: 'color' },
    ],
  },
  kaleido: {
    frag: KALEIDO_FRAG, vert: VERT,
    defaultParams: { segments: 8 },
    schema: [
      { key: 'segments', type: 'range', min: 2, max: 24, step: 1 },
    ],
  },
  vhs: {
    frag: VHS_FRAG, vert: VERT,
    defaultParams: { aberration: 0.01, tint: [1.0, 0.85, 0.9] },
    schema: [
      { key: 'aberration', type: 'range', min: 0, max: 0.05, step: 0.001 },
      { key: 'tint', type: 'color' },
    ],
  },
  plasma: {
    frag: PLASMA_FRAG, vert: VERT,
    defaultParams: { colorA: [0.1, 0.0, 0.4], colorB: [1.0, 0.6, 0.0] },
    schema: [
      { key: 'colorA', type: 'color' },
      { key: 'colorB', type: 'color' },
    ],
  },
  raymarch: {
    frag: RAYMARCH_FRAG, vert: VERT,
    defaultParams: {},
    schema: [],
  },
  dancer: {
    frag: DANCER_FRAG, vert: VERT,
    defaultParams: {
      bones:  [0.0, 1.0, 0.66],
      joints: [1.0, 0.66, 0.20],
      bg:     [0.02, 0.0, 0.05],
      thick:  0.008,
    },
    schema: [
      { key: 'bones',  type: 'color' },
      { key: 'joints', type: 'color' },
      { key: 'bg',     type: 'color' },
      { key: 'thick',  type: 'range', min: 0.002, max: 0.020, step: 0.0005 },
    ],
  },
  // ---------------- v0.6.1 cheap-wow shader pack ----------------
  'feedback-trails': {
    frag: FEEDBACK_TRAILS_FRAG, vert: VERT, feedback: true,
    defaultParams: {
      decay:  0.93,
      zoom:   0.005,
      rotate: 0.1,
      tint:   [0.0, 1.0, 0.85],
      bgTint: [0.02, 0.0, 0.05],
    },
    schema: [
      { key: 'decay',  type: 'range', min: 0.7, max: 0.99, step: 0.005 },
      { key: 'zoom',   type: 'range', min: -0.05, max: 0.05, step: 0.001 },
      { key: 'rotate', type: 'range', min: -1, max: 1, step: 0.01 },
      { key: 'tint',   type: 'color' },
      { key: 'bgTint', type: 'color' },
    ],
  },
  shockwave: {
    frag: SHOCKWAVE_FRAG, vert: VERT, feedback: true,
    defaultParams: {
      ringColor: [0.0, 1.0, 0.85],
      bgColor:   [0.02, 0.0, 0.06],
      ringWidth: 0.012,
      speed:     0.4,
    },
    schema: [
      { key: 'ringColor', type: 'color' },
      { key: 'bgColor',   type: 'color' },
      { key: 'ringWidth', type: 'range', min: 0.003, max: 0.04, step: 0.001 },
      { key: 'speed',     type: 'range', min: 0.1, max: 1.5, step: 0.05 },
    ],
  },
  truchet: {
    frag: TRUCHET_FRAG, vert: VERT,
    defaultParams: {
      density:   0.1,
      lineColor: [1.0, 0.4, 0.85],
      bgColor:   [0.02, 0.02, 0.06],
    },
    schema: [
      { key: 'density',   type: 'range', min: 0.03, max: 0.3, step: 0.005 },
      { key: 'lineColor', type: 'color' },
      { key: 'bgColor',   type: 'color' },
    ],
  },
  voronoi: {
    frag: VORONOI_FRAG, vert: VERT,
    defaultParams: {
      scale:  8,
      colorA: [0.1, 0.2, 0.6],
      colorB: [1.0, 0.4, 0.85],
    },
    schema: [
      { key: 'scale',  type: 'range', min: 2, max: 32, step: 1 },
      { key: 'colorA', type: 'color' },
      { key: 'colorB', type: 'color' },
    ],
  },
};

export const EFFECT_NAMES = Object.keys(EFFECTS);
