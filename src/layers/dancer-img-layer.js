// Dancer-image layer — 6 uploaded sprites (head, torso, arms, legs) driven
// by the same audio-reactive skeleton math as the SDF dancer. Each part is
// a textured rectangle whose anchor / rotation / scale is computed per
// frame from joint positions.
//
// Joint formulas mirror the SDF dancer in shader-effects.js so visually
// the two are equivalent up to "sticks vs sprites."

import { putImage, getImage } from '../storage/idb.js';

// Simple mode = the original 6-part rig. Complex mode = 14-part rig where
// each limb is split into anatomical segments + a hand/foot anchor sprite.
// PART_KEYS_ALL is the union used for storage; the renderer iterates the
// mode-specific subset.
export const PART_KEYS_SIMPLE = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
export const PART_KEYS_COMPLEX = [
  'head', 'torso',
  'upperArmL', 'forearmL', 'handL',
  'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
];
export const PART_KEYS_ALL = [...new Set([...PART_KEYS_SIMPLE, ...PART_KEYS_COMPLEX])];
// Back-compat: old callers reference PART_KEYS — point it at the simple set.
export const PART_KEYS = PART_KEYS_SIMPLE;

export const PART_LABELS = {
  head: 'HEAD', torso: 'TORSO',
  armL: 'ARM L', armR: 'ARM R',
  legL: 'LEG L', legR: 'LEG R',
  upperArmL: 'UPPER ARM L', forearmL: 'FOREARM L', handL: 'HAND L',
  upperArmR: 'UPPER ARM R', forearmR: 'FOREARM R', handR: 'HAND R',
  thighL: 'THIGH L', shinL: 'SHIN L', footL: 'FOOT L',
  thighR: 'THIGH R', shinR: 'SHIN R', footR: 'FOOT R',
};

function defaultPart() {
  return {
    imageId: null,
    name: '',
    // per-part overrides on top of the auto-computed transform
    rotation: 0,      // degrees, added to bone-derived rotation
    scale: 1.0,       // multiplier on bone length (height of sprite)
    widthScale: 1.0,  // multiplier on the layer's base width (head/limb/torso)
    offsetX: 0,       // offset added to anchor in canvas UV (-0.3 to 0.3)
    offsetY: 0,
    flipX: false,     // mirror image horizontally
    flipY: false,     // mirror image vertically (use if uploaded upside down)
    splitV: 0.5,      // v2 bend mode: where the elbow/knee is in the image (0..1).
                      // Only used for arms/legs when layer.bendLimbs is on.
                      // 0.5 = image middle (default); tune up/down to match the
                      // anatomy of your specific upload.
  };
}

export function emptyDancerImgLayer(id) {
  const parts = {};
  for (const k of PART_KEYS_ALL) parts[k] = defaultPart();
  return {
    id,
    type: 'dancer-img',
    name: 'dancer img',
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    parts,
    bg: [0.0, 0.0, 0.0],
    audioIntensity: 1.5,
    widthHead: 0.10,     // base sprite width relative to canvas
    widthLimb: 0.06,     // arm/leg sprite width (simple-mode whole-limb, complex-mode segment)
    widthTorso: 0.14,
    widthHand: 0.045,    // complex mode only — hand sprite anchored at wrist
    widthFoot: 0.05,     // complex mode only — foot sprite anchored at ankle
    // Simple mode (default): 6 parts, optionally with v2 bendLimbs (2 segments per limb sharing one image).
    // Complex mode: 14 parts, each anatomical segment uploaded separately. bendLimbs is a no-op here.
    complexBody: false,
    bendLimbs: true,
  };
}

// Defensive default-fill so old projects (without per-part overrides or
// without the new complex-mode parts) still render. Mutates layer in place.
export function fillPartDefaults(layer) {
  for (const k of PART_KEYS_ALL) {
    if (!layer.parts[k]) layer.parts[k] = defaultPart();
    else {
      const d = defaultPart();
      for (const f of Object.keys(d)) {
        if (layer.parts[k][f] === undefined) layer.parts[k][f] = d[f];
      }
    }
  }
  if (layer.widthHand === undefined) layer.widthHand = 0.045;
  if (layer.widthFoot === undefined) layer.widthFoot = 0.05;
  if (layer.complexBody === undefined) layer.complexBody = false;
}

async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function ingestPartImage(layer, partKey, file) {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  await putImage(hash, file, file.name);
  // Preserve existing per-part overrides (rotation, scale, flipX/Y, etc.) —
  // we're only swapping the imageId + name, not nuking the whole part.
  const existing = layer.parts[partKey] ?? defaultPart();
  layer.parts[partKey] = { ...defaultPart(), ...existing, imageId: hash, name: file.name };
  return hash;
}

// Procedural sample body — Canvas2D draws stylized neon-outlined cyberpunk
// body parts and saves them as PNG blobs in IDB. Called when the user
// toggles complexBody on and opts to fill missing parts with the sample
// rig. Each part is sized appropriately for its anchor (vertical limbs,
// square-ish hands/feet, oval head, tapered torso).
//
// Style: cyan outline, magenta-to-cyan gradient fill, subtle inner highlight.
// On-brand for r0n1n's cyberpunk aesthetic; NOT a stick figure.
function drawPart(name, canvas, ctx) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  // shared gradient — cyan top → magenta bottom
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,    'rgba(80,  240, 230, 0.92)');
  grad.addColorStop(0.5,  'rgba(180, 90,  220, 0.92)');
  grad.addColorStop(1,    'rgba(255, 40,  140, 0.92)');
  ctx.fillStyle = grad;
  ctx.strokeStyle = 'rgba(0, 255, 220, 1.0)';
  ctx.lineWidth = Math.max(3, W * 0.025);
  ctx.lineJoin = 'round';

  function capsule(cx, cy, halfW, halfH) {
    const r = Math.min(halfW, halfH) * 0.92;
    ctx.beginPath();
    ctx.moveTo(cx - halfW + r, cy - halfH);
    ctx.lineTo(cx + halfW - r, cy - halfH);
    ctx.arcTo(cx + halfW, cy - halfH, cx + halfW, cy - halfH + r, r);
    ctx.lineTo(cx + halfW, cy + halfH - r);
    ctx.arcTo(cx + halfW, cy + halfH, cx + halfW - r, cy + halfH, r);
    ctx.lineTo(cx - halfW + r, cy + halfH);
    ctx.arcTo(cx - halfW, cy + halfH, cx - halfW, cy + halfH - r, r);
    ctx.lineTo(cx - halfW, cy - halfH + r);
    ctx.arcTo(cx - halfW, cy - halfH, cx - halfW + r, cy - halfH, r);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  function oval(cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill(); ctx.stroke();
  }

  const cx = W / 2;
  if (name === 'head') {
    // oval head with eye + cheekbone hint
    oval(cx, H * 0.5, W * 0.36, H * 0.42);
    // eye accents
    ctx.fillStyle = 'rgba(20, 30, 40, 0.85)';
    ctx.beginPath(); ctx.ellipse(cx - W * 0.12, H * 0.42, W * 0.04, H * 0.025, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + W * 0.12, H * 0.42, W * 0.04, H * 0.025, 0, 0, TAU); ctx.fill();
    // mouth line
    ctx.beginPath(); ctx.moveTo(cx - W * 0.10, H * 0.66); ctx.lineTo(cx + W * 0.10, H * 0.66); ctx.stroke();
  } else if (name === 'torso') {
    // tapered trapezoid — wider at shoulders (top), narrower at hips (bottom)
    const topHalf = W * 0.40, botHalf = W * 0.28;
    ctx.beginPath();
    ctx.moveTo(cx - topHalf, H * 0.08);
    ctx.lineTo(cx + topHalf, H * 0.08);
    ctx.quadraticCurveTo(cx + topHalf * 0.92, H * 0.55, cx + botHalf, H * 0.92);
    ctx.lineTo(cx - botHalf, H * 0.92);
    ctx.quadraticCurveTo(cx - topHalf * 0.92, H * 0.55, cx - topHalf, H * 0.08);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // pec/abs hint — vertical centerline
    ctx.beginPath(); ctx.moveTo(cx, H * 0.18); ctx.lineTo(cx, H * 0.88); ctx.stroke();
  } else if (name.startsWith('upperArm') || name === 'armL' || name === 'armR' || name === 'forearm' || name.startsWith('forearm')) {
    // tall narrow capsule
    capsule(cx, H * 0.5, W * 0.28, H * 0.45);
  } else if (name.startsWith('thigh') || name === 'legL' || name === 'legR' || name.startsWith('shin')) {
    // thicker capsule for thigh; same shape function, slightly wider
    const wide = name.startsWith('thigh') ? 0.32 : 0.26;
    capsule(cx, H * 0.5, W * wide, H * 0.45);
  } else if (name.startsWith('hand')) {
    // small oval with three finger ridges
    oval(cx, H * 0.55, W * 0.32, H * 0.36);
    ctx.beginPath();
    ctx.moveTo(cx - W * 0.16, H * 0.20); ctx.lineTo(cx - W * 0.16, H * 0.08);
    ctx.moveTo(cx,             H * 0.16); ctx.lineTo(cx,             H * 0.02);
    ctx.moveTo(cx + W * 0.16, H * 0.20); ctx.lineTo(cx + W * 0.16, H * 0.08);
    ctx.stroke();
  } else if (name.startsWith('foot')) {
    // forward-pointing rounded shape
    ctx.beginPath();
    ctx.moveTo(cx - W * 0.30, H * 0.30);
    ctx.lineTo(cx + W * 0.30, H * 0.30);
    ctx.quadraticCurveTo(cx + W * 0.42, H * 0.55, cx + W * 0.22, H * 0.85);
    ctx.lineTo(cx - W * 0.22, H * 0.85);
    ctx.quadraticCurveTo(cx - W * 0.42, H * 0.55, cx - W * 0.30, H * 0.30);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
}

// Public: generate + persist the procedural sample body. Fills only parts
// without an existing image (won't clobber user uploads). Sets imageId on
// each part it generates. Caller should re-attach the layer runtime after.
export async function generateSampleBody(layer, mode = 'complex') {
  fillPartDefaults(layer);
  const keys = mode === 'complex' ? PART_KEYS_COMPLEX : PART_KEYS_SIMPLE;
  const sized = {
    head: [256, 256], torso: [256, 384],
    armL: [128, 512], armR: [128, 512], legL: [128, 512], legR: [128, 512],
    upperArmL: [128, 384], forearmL: [128, 384], handL: [192, 192],
    upperArmR: [128, 384], forearmR: [128, 384], handR: [192, 192],
    thighL:    [160, 384], shinL:    [128, 384], footL: [192, 192],
    thighR:    [160, 384], shinR:    [128, 384], footR: [192, 192],
  };
  for (const k of keys) {
    if (layer.parts[k]?.imageId) continue;  // don't clobber user uploads
    const [w, h] = sized[k] ?? [256, 384];
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    drawPart(k, canvas, ctx);
    // canvas → PNG blob → IDB
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const buf = await blob.arrayBuffer();
    const hash = await sha256Hex(buf);
    await putImage(hash, blob, `sample-${k}.png`);
    const existing = layer.parts[k] ?? defaultPart();
    layer.parts[k] = { ...defaultPart(), ...existing, imageId: hash, name: `sample-${k}.png` };
  }
}

const TAU = Math.PI * 2;

// Compute joint positions in 0..1 UV space using the same audio-reactive
// formulas as the SDF dancer. Returns { head, hip, spine, shldr, shldrL,
// shldrR, elbowL, elbowR, wristL, wristR, hipL, hipR, kneeL, kneeR,
// ankleL, ankleR }.
function computeJoints(t, audio, intensity) {
  const bass = (audio.bass ?? 0) * intensity;
  const mid  = (audio.mid  ?? 0) * intensity;
  const high = (audio.high ?? 0) * intensity;
  const env  = (audio.env  ?? 0) * intensity;
  const bpm  = Math.max(audio.bpm ?? 0, 90);
  const phi  = t * (bpm / 60) * TAU * 0.25;

  const scale = (0.40 + env * 0.05) / (1 + 0.2 * bass);
  const root  = [0.5, 0.30];

  // v0.4.2 wiggle pass: amplitudes ~2× v0.4.1, mirrors the SDF dancer in
  // shader-effects.js so the SDF + image dancers move in lockstep.
  const bounce = Math.sin(phi) * 0.035 - bass * 0.090;
  const hip   = [root[0],                                        root[1] + scale * 0.20 + bounce];
  const spine = [hip[0]   + Math.sin(phi * 0.5) * 0.030 * mid,   hip[1]   + scale * 0.20];
  const shldr = [spine[0] + Math.sin(phi * 0.5) * 0.012 * mid,   spine[1] + scale * 0.10];
  const head  = [shldr[0] + Math.sin(phi * 0.5) * 0.025,          shldr[1] + scale * 0.10 + env * 0.030];

  const armSwingL = Math.sin(phi + Math.PI) * (0.55 + mid * 1.8);
  const armSwingR = Math.sin(phi)           * (0.55 + mid * 1.8);
  const shldrL = [shldr[0] - scale * 0.07, shldr[1]];
  const shldrR = [shldr[0] + scale * 0.07, shldr[1]];
  const elbowL = [shldrL[0] + -scale * 0.05 * (1 + 0.65 * armSwingL), shldrL[1] + -scale * 0.10 * (1 + 0.65 * armSwingL)];
  const elbowR = [shldrR[0] +  scale * 0.05 * (1 + 0.65 * armSwingR), shldrR[1] + -scale * 0.10 * (1 + 0.65 * armSwingR)];
  const jitterAmp = 0.025 * high;
  const wristL = [elbowL[0] + -scale * 0.03 + Math.sin(phi * 1.7) * 0.045 + (Math.random() - 0.5) * jitterAmp,
                  elbowL[1] + -scale * 0.08                                + (Math.random() - 0.5) * jitterAmp];
  const wristR = [elbowR[0] +  scale * 0.03 + Math.sin(phi * 1.7) * 0.045 + (Math.random() - 0.5) * jitterAmp,
                  elbowR[1] + -scale * 0.08                                + (Math.random() - 0.5) * jitterAmp];

  const legSwingL = Math.sin(phi)           * (0.35 + mid * 0.8);
  const legSwingR = Math.sin(phi + Math.PI) * (0.35 + mid * 0.8);
  const kneeBend  = 0.5 + bass * 0.8;
  const hipL = [hip[0] - scale * 0.05, hip[1]];
  const hipR = [hip[0] + scale * 0.05, hip[1]];
  const kneeL = [hipL[0] + -scale * 0.04 + legSwingL * scale * 0.12, hipL[1] - scale * 0.13 * kneeBend];
  const kneeR = [hipR[0] +  scale * 0.04 + legSwingR * scale * 0.12, hipR[1] - scale * 0.13 * kneeBend];
  const ankleJ = 0.018 * high;
  const ankleL = [kneeL[0] + -scale * 0.02 + legSwingL * scale * 0.08 + (Math.random() - 0.5) * ankleJ,
                  kneeL[1] -  scale * 0.13 * kneeBend                  + (Math.random() - 0.5) * ankleJ];
  const ankleR = [kneeR[0] +  scale * 0.02 + legSwingR * scale * 0.08 + (Math.random() - 0.5) * ankleJ,
                  kneeR[1] -  scale * 0.13 * kneeBend                  + (Math.random() - 0.5) * ankleJ];

  return { head, hip, spine, shldr, shldrL, shldrR, elbowL, elbowR, wristL, wristR,
           hipL, hipR, kneeL, kneeR, ankleL, ankleR, scale };
}

// Compute transform for a segment of an image between two joints. The quad's
// local +Y points from end → start (image top = start). The uvMin/uvMax args
// let v2 bend-mode render only the top half or bottom half of the texture.
//
//   start/end   — joint positions in canvas UV
//   baseWidth   — layer base width for this part class (head/limb/torso)
//   ov          — per-part override block
//   uvMin/uvMax — texture v range to sample (default 0..1 = full image)
//
// Returns { anchor, rotation, size, flipX, flipY, uvMin, uvMax }.
function spriteFromBones(start, end, baseWidth, ov, uvMin = 0, uvMax = 1) {
  const baseLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const length = baseLength * (ov?.scale ?? 1);
  const angle = Math.atan2(start[1] - end[1], start[0] - end[0]);
  const rotation = angle - Math.PI / 2 + (ov?.rotation ?? 0) * Math.PI / 180;
  const anchor = [
    (start[0] + end[0]) * 0.5 + (ov?.offsetX ?? 0),
    (start[1] + end[1]) * 0.5 + (ov?.offsetY ?? 0),
  ];
  return {
    anchor,
    rotation,
    size: [baseWidth * (ov?.widthScale ?? 1), length],
    flipX: ov?.flipX ? 1 : 0,
    flipY: ov?.flipY ? 1 : 0,
    uvMin,
    uvMax,
  };
}

// Head — anchor centered on head joint. No auto-rotation but accepts the
// per-part rotation override + width-aspect-ratio.
function spriteFromHead(headPos, _figureScale, baseWidth, ov) {
  const w = baseWidth * (ov?.widthScale ?? 1);
  const h = w * 1.1 * (ov?.scale ?? 1);
  return {
    anchor: [headPos[0] + (ov?.offsetX ?? 0), headPos[1] + (ov?.offsetY ?? 0)],
    rotation: (ov?.rotation ?? 0) * Math.PI / 180,
    size: [w, h],
    flipX: ov?.flipX ? 1 : 0,
    flipY: ov?.flipY ? 1 : 0,
    uvMin: 0,
    uvMax: 1,
  };
}

export async function attachDancerImg(regl, layer, audioState) {
  fillPartDefaults(layer);
  const W = 1024, H = 1024;
  const colorTex = regl.texture({
    width: W, height: H, min: 'linear', mag: 'linear', wrap: 'clamp',
  });
  const fbo = regl.framebuffer({ color: colorTex, depth: false });

  // Lazy-load each part's image into a texture. Missing parts get a null texture
  // (those parts skip render).
  const textures = {};
  async function loadPart(key) {
    const imageId = layer.parts[key]?.imageId;
    if (!imageId) { textures[key] = null; return; }
    try {
      const rec = await getImage(imageId);
      if (!rec) { textures[key] = null; return; }
      const bitmap = await createImageBitmap(rec.blob);
      textures[key] = regl.texture({
        data: bitmap,
        min: 'linear', mag: 'linear', wrap: 'clamp', flipY: true,
      });
    } catch (e) {
      console.error(`[dancer-img] load failed for ${key}`, e);
      textures[key] = null;
    }
  }
  // Load textures for ALL keys (both simple + complex modes) so toggling the
  // complexBody flag mid-session shows the right parts without an attach round-trip.
  await Promise.all(PART_KEYS_ALL.map(loadPart));

  // Public method so the UI can trigger reload after an upload.
  async function reloadPart(key) {
    if (textures[key]) { try { textures[key].destroy?.(); } catch {} }
    await loadPart(key);
  }

  const startTime = performance.now() / 1000;

  // Single regl draw call, called once per body part per frame.
  const drawPart = regl({
    vert: `
      precision highp float;
      attribute vec2 a_pos;
      uniform vec2 u_anchor;
      uniform float u_rotation;
      uniform vec2 u_size;
      uniform float u_flipX;
      uniform float u_flipY;
      uniform float u_uvMin;
      uniform float u_uvMax;
      varying vec2 v_uv;
      void main() {
        // a_pos in [-0.5, +0.5] for both axes
        // Map quad-local Y to texture V band [u_uvMin .. u_uvMax]:
        //   quad bottom (a_pos.y=-0.5) → uv.y = u_uvMin
        //   quad top    (a_pos.y=+0.5) → uv.y = u_uvMax
        // For v2 bend mode: upper segment samples uv.y in [splitV..1.0],
        // lower segment samples uv.y in [0..splitV]. Single-segment v1/head/torso
        // pass uvMin=0, uvMax=1 (full image).
        float vRange = u_uvMax - u_uvMin;
        vec2 uv = vec2(a_pos.x + 0.5, (a_pos.y + 0.5) * vRange + u_uvMin);
        if (u_flipX > 0.5) uv.x = 1.0 - uv.x;
        if (u_flipY > 0.5) uv.y = (u_uvMax + u_uvMin) - uv.y;  // mirror within band
        v_uv = uv;
        vec2 scaled = a_pos * u_size;
        float c = cos(u_rotation), s = sin(u_rotation);
        vec2 rot = vec2(c * scaled.x - s * scaled.y,
                        s * scaled.x + c * scaled.y);
        vec2 pos = u_anchor + rot;
        vec2 clip = pos * 2.0 - 1.0;
        gl_Position = vec4(clip, 0.0, 1.0);
      }
    `,
    frag: `
      precision highp float;
      uniform sampler2D u_tex;
      varying vec2 v_uv;
      void main() {
        vec4 c = texture2D(u_tex, v_uv);
        if (c.a < 0.01) discard;
        gl_FragColor = c;
      }
    `,
    attributes: {
      a_pos: regl.buffer([
        [-0.5, -0.5], [ 0.5, -0.5], [ 0.5, 0.5],
        [-0.5, -0.5], [ 0.5,  0.5], [-0.5, 0.5],
      ]),
    },
    uniforms: {
      u_anchor:   regl.prop('anchor'),
      u_rotation: regl.prop('rotation'),
      u_size:     regl.prop('size'),
      u_tex:      regl.prop('tex'),
      u_flipX:    regl.prop('flipX'),
      u_flipY:    regl.prop('flipY'),
      u_uvMin:    regl.prop('uvMin'),
      u_uvMax:    regl.prop('uvMax'),
    },
    count: 6,
    depth: { enable: false },
    blend: {
      enable: true,
      func: { srcRGB: 'src alpha', srcAlpha: 1, dstRGB: 'one minus src alpha', dstAlpha: 1 },
    },
    framebuffer: fbo,
  });

  const clearCmd = regl({
    framebuffer: fbo,
    vert: 'precision highp float; void main() { gl_Position = vec4(0.0); }',
    frag: 'precision highp float; uniform vec4 u_color; void main() { gl_FragColor = u_color; }',
    uniforms: { u_color: () => [...(layer.bg ?? [0,0,0]), 1.0] },
    count: 0,
  });

  return {
    layer,
    texture: colorTex,
    flipY: false,
    tick() {
      const t = performance.now() / 1000 - startTime;
      const audio = audioState?.uniforms || { bass: 0, mid: 0, high: 0, env: 0, beat: 0, bpm: 0 };
      const intensity = layer.audioIntensity ?? 1;
      const j = computeJoints(t, audio, intensity);

      // Clear FBO to bg via regl clear
      regl.clear({ color: [...(layer.bg ?? [0,0,0]), 1.0], depth: 1, framebuffer: fbo });

      // Draw parts back-to-front. Two modes:
      //   simple  (6 parts):  optional v2 bend-mode splits each limb image into 2 rigid segments.
      //   complex (14 parts): each anatomical segment is its own uploaded image, no bend math needed.
      const drawCalls = [];
      const p = layer.parts;

      if (layer.complexBody) {
        // ── COMPLEX BODY: 14 parts ──
        // Legs first (back-to-front), then torso, then arms, then hands/feet, then head.
        if (textures.thighL)  drawCalls.push({ ...spriteFromBones(j.hipL,   j.kneeL,  layer.widthLimb,  p.thighL,  0, 1), tex: textures.thighL });
        if (textures.thighR)  drawCalls.push({ ...spriteFromBones(j.hipR,   j.kneeR,  layer.widthLimb,  p.thighR,  0, 1), tex: textures.thighR });
        if (textures.shinL)   drawCalls.push({ ...spriteFromBones(j.kneeL,  j.ankleL, layer.widthLimb,  p.shinL,   0, 1), tex: textures.shinL });
        if (textures.shinR)   drawCalls.push({ ...spriteFromBones(j.kneeR,  j.ankleR, layer.widthLimb,  p.shinR,   0, 1), tex: textures.shinR });
        if (textures.footL)   drawCalls.push({ ...spriteFromHead(j.ankleL,  j.scale,  layer.widthFoot,  p.footL),         tex: textures.footL });
        if (textures.footR)   drawCalls.push({ ...spriteFromHead(j.ankleR,  j.scale,  layer.widthFoot,  p.footR),         tex: textures.footR });
        if (textures.torso)   drawCalls.push({ ...spriteFromBones(j.hip,    j.shldr,  layer.widthTorso, p.torso,   0, 1), tex: textures.torso });
        if (textures.upperArmL) drawCalls.push({ ...spriteFromBones(j.shldrL, j.elbowL, layer.widthLimb, p.upperArmL, 0, 1), tex: textures.upperArmL });
        if (textures.upperArmR) drawCalls.push({ ...spriteFromBones(j.shldrR, j.elbowR, layer.widthLimb, p.upperArmR, 0, 1), tex: textures.upperArmR });
        if (textures.forearmL)  drawCalls.push({ ...spriteFromBones(j.elbowL, j.wristL, layer.widthLimb, p.forearmL,  0, 1), tex: textures.forearmL });
        if (textures.forearmR)  drawCalls.push({ ...spriteFromBones(j.elbowR, j.wristR, layer.widthLimb, p.forearmR,  0, 1), tex: textures.forearmR });
        if (textures.handL)   drawCalls.push({ ...spriteFromHead(j.wristL,  j.scale,  layer.widthHand,  p.handL),         tex: textures.handL });
        if (textures.handR)   drawCalls.push({ ...spriteFromHead(j.wristR,  j.scale,  layer.widthHand,  p.handR),         tex: textures.handR });
        if (textures.head)    drawCalls.push({ ...spriteFromHead(j.head,    j.scale,  layer.widthHead,  p.head),          tex: textures.head });
      } else {
        // ── SIMPLE BODY: 6 parts (with optional v2 bend mode) ──
        const bend = layer.bendLimbs !== false;
        function pushLimb(tex, start, mid, end, baseWidth, ov) {
          if (!tex) return;
          if (bend) {
            const splitV = ov?.splitV ?? 0.5;
            drawCalls.push({ ...spriteFromBones(start, mid, baseWidth, ov, splitV, 1.0), tex });
            drawCalls.push({ ...spriteFromBones(mid,   end, baseWidth, ov, 0.0, splitV), tex });
          } else {
            drawCalls.push({ ...spriteFromBones(start, end, baseWidth, ov, 0, 1), tex });
          }
        }
        pushLimb(textures.legL, j.hipL,   j.kneeL,  j.ankleL, layer.widthLimb,  p.legL);
        pushLimb(textures.legR, j.hipR,   j.kneeR,  j.ankleR, layer.widthLimb,  p.legR);
        if (textures.torso) drawCalls.push({ ...spriteFromBones(j.hip, j.shldr, layer.widthTorso, p.torso, 0, 1), tex: textures.torso });
        pushLimb(textures.armL, j.shldrL, j.elbowL, j.wristL, layer.widthLimb,  p.armL);
        pushLimb(textures.armR, j.shldrR, j.elbowR, j.wristR, layer.widthLimb,  p.armR);
        if (textures.head)  drawCalls.push({ ...spriteFromHead(j.head, j.scale, layer.widthHead, p.head), tex: textures.head });
      }

      if (drawCalls.length) drawPart(drawCalls);
    },
    reloadPart,
    dispose() {
      for (const t of Object.values(textures)) { try { t?.destroy?.(); } catch {} }
      fbo.destroy?.();
      colorTex.destroy?.();
    },
  };
}
