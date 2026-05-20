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

export function emptyDancerImgLayer(id) {
  const parts = {};
  for (const k of PART_KEYS) parts[k] = { imageId: null, name: '' };
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
    widthHead: 0.10,    // sprite width relative to canvas
    widthLimb: 0.06,    // arm/leg sprite width
    widthTorso: 0.14,
  };
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

// Compute transform for a part rendered between two joints (start = top of
// image, end = bottom). Returns { anchor, rotation, size }.
//   anchor — midpoint in UV
//   rotation — radians; quad's local +Y will point from end → start
//   size — [width, height], height = length(start, end)
function spriteFromBones(start, end, width) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  // We want the quad's local +Y axis to point from end→start (image top = start).
  // Angle of (start - end) from +X:
  const angle = Math.atan2(start[1] - end[1], start[0] - end[0]);
  // Quad's local +Y is at angle π/2 from local +X; we want world rotation such
  // that local +Y becomes the world (start-end) direction.
  const rotation = angle - Math.PI / 2;
  const anchor = [(start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5];
  return { anchor, rotation, size: [width, length] };
}

// Head is a special case — no rotation, scaled by figure size.
function spriteFromHead(headPos, scale, width) {
  return { anchor: headPos, rotation: 0, size: [width, width * 1.1] };
}

export async function attachDancerImg(regl, layer, audioState) {
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
      varying vec2 v_uv;
      void main() {
        // a_pos in [-0.5, +0.5] for both axes
        v_uv = a_pos + 0.5;
        vec2 scaled = a_pos * u_size;
        float c = cos(u_rotation), s = sin(u_rotation);
        vec2 rot = vec2(c * scaled.x - s * scaled.y,
                        s * scaled.x + c * scaled.y);
        vec2 pos = u_anchor + rot;
        vec2 clip = pos * 2.0 - 1.0;
        // FBO y-up — keep clip.y as-is since textures load with flipY=true
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

      // Draw parts back-to-front: legs → torso → arms → head
      const drawCalls = [];
      if (textures.legL)  drawCalls.push({ ...spriteFromBones(j.hipL,   j.ankleL, layer.widthLimb),  tex: textures.legL });
      if (textures.legR)  drawCalls.push({ ...spriteFromBones(j.hipR,   j.ankleR, layer.widthLimb),  tex: textures.legR });
      if (textures.torso) drawCalls.push({ ...spriteFromBones(j.hip,    j.shldr,  layer.widthTorso), tex: textures.torso });
      if (textures.armL)  drawCalls.push({ ...spriteFromBones(j.shldrL, j.wristL, layer.widthLimb),  tex: textures.armL });
      if (textures.armR)  drawCalls.push({ ...spriteFromBones(j.shldrR, j.wristR, layer.widthLimb),  tex: textures.armR });
      if (textures.head)  drawCalls.push({ ...spriteFromHead(j.head,    j.scale,  layer.widthHead),  tex: textures.head });

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
