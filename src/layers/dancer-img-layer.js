// Dancer-image layer — 6 uploaded sprites (head, torso, arms, legs) driven
// by the same audio-reactive skeleton math as the SDF dancer. Each part is
// a textured rectangle whose anchor / rotation / scale is computed per
// frame from joint positions.
//
// Joint formulas mirror the SDF dancer in shader-effects.js so visually
// the two are equivalent up to "sticks vs sprites."

import { putImage, getImage } from '../storage/idb.js';

export const PART_KEYS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
export const PART_LABELS = {
  head: 'HEAD', torso: 'TORSO',
  armL: 'ARM L', armR: 'ARM R',
  legL: 'LEG L', legR: 'LEG R',
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
  for (const k of PART_KEYS) parts[k] = defaultPart();
  return {
    id,
    type: 'dancer-img',
    name: 'dancer img',
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    parts,
    bg: [0.0, 0.0, 0.0],
    audioIntensity: 1.0,
    widthHead: 0.10,    // base sprite width relative to canvas
    widthLimb: 0.06,    // arm/leg sprite width
    widthTorso: 0.14,
    // v2 — when true, arms render as 2 rigid segments (shoulder→elbow + elbow→wrist)
    // and legs render as (hip→knee + knee→ankle). Each segment samples half of the
    // limb's image, split at per-part splitV. False = v1 single-segment rigid sprites.
    bendLimbs: true,
  };
}

// Defensive default-fill so old projects (without per-part overrides) still
// render. Mutates the layer in place; called on attach.
export function fillPartDefaults(layer) {
  for (const k of PART_KEYS) {
    if (!layer.parts[k]) layer.parts[k] = defaultPart();
    else {
      const d = defaultPart();
      for (const f of Object.keys(d)) {
        if (layer.parts[k][f] === undefined) layer.parts[k][f] = d[f];
      }
    }
  }
}

async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function ingestPartImage(layer, partKey, file) {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  await putImage(hash, file, file.name);
  layer.parts[partKey] = { imageId: hash, name: file.name };
  return hash;
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

  const bounce = Math.sin(phi) * 0.018 - bass * 0.045;
  const hip   = [root[0],                                       root[1] + scale * 0.20 + bounce];
  const spine = [hip[0]   + Math.sin(phi * 0.5) * 0.015 * mid,  hip[1]   + scale * 0.20];
  const shldr = [spine[0],                                       spine[1] + scale * 0.10];
  const head  = [shldr[0] + Math.sin(phi * 0.5) * 0.012,         shldr[1] + scale * 0.10 + env * 0.015];

  const armSwingL = Math.sin(phi + Math.PI) * (0.35 + mid);
  const armSwingR = Math.sin(phi)           * (0.35 + mid);
  const shldrL = [shldr[0] - scale * 0.07, shldr[1]];
  const shldrR = [shldr[0] + scale * 0.07, shldr[1]];
  const elbowL = [shldrL[0] + -scale * 0.05 * (1 + 0.4 * armSwingL), shldrL[1] + -scale * 0.10 * (1 + 0.4 * armSwingL)];
  const elbowR = [shldrR[0] +  scale * 0.05 * (1 + 0.4 * armSwingR), shldrR[1] + -scale * 0.10 * (1 + 0.4 * armSwingR)];
  const jitterAmp = 0.012 * high;
  const wristL = [elbowL[0] + -scale * 0.03 + Math.sin(phi * 1.7) * 0.02 + (Math.random() - 0.5) * jitterAmp,
                  elbowL[1] + -scale * 0.08                              + (Math.random() - 0.5) * jitterAmp];
  const wristR = [elbowR[0] +  scale * 0.03 + Math.sin(phi * 1.7) * 0.02 + (Math.random() - 0.5) * jitterAmp,
                  elbowR[1] + -scale * 0.08                              + (Math.random() - 0.5) * jitterAmp];

  const legSwingL = Math.sin(phi)           * (0.20 + mid * 0.4);
  const legSwingR = Math.sin(phi + Math.PI) * (0.20 + mid * 0.4);
  const kneeBend  = 0.5 + bass * 0.4;
  const hipL = [hip[0] - scale * 0.05, hip[1]];
  const hipR = [hip[0] + scale * 0.05, hip[1]];
  const kneeL = [hipL[0] + -scale * 0.04 + legSwingL * scale * 0.06, hipL[1] - scale * 0.13 * kneeBend];
  const kneeR = [hipR[0] +  scale * 0.04 + legSwingR * scale * 0.06, hipR[1] - scale * 0.13 * kneeBend];
  const ankleJ = 0.008 * high;
  const ankleL = [kneeL[0] + -scale * 0.02 + legSwingL * scale * 0.04 + (Math.random() - 0.5) * ankleJ,
                  kneeL[1] -  scale * 0.13 * kneeBend                  + (Math.random() - 0.5) * ankleJ];
  const ankleR = [kneeR[0] +  scale * 0.02 + legSwingR * scale * 0.04 + (Math.random() - 0.5) * ankleJ,
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
  await Promise.all(PART_KEYS.map(loadPart));

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

      // Draw parts back-to-front: legs → torso → arms → head.
      // v2 bend mode (layer.bendLimbs): each limb splits into two rigid
      // segments meeting at the elbow/knee. Each segment samples half of the
      // limb's texture (split at part.splitV). Texture bands meet at the
      // image's splitV row so the joint appears continuous.
      const drawCalls = [];
      const p = layer.parts;
      const bend = layer.bendLimbs !== false;  // default on

      function pushLimb(tex, start, mid, end, baseWidth, ov) {
        if (!tex) return;
        if (bend) {
          const splitV = ov?.splitV ?? 0.5;
          // upper segment: top of image (splitV..1.0) → start → mid
          drawCalls.push({ ...spriteFromBones(start, mid, baseWidth, ov, splitV, 1.0), tex });
          // lower segment: bottom of image (0..splitV) → mid → end
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
