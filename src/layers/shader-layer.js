// Shader layer — a generative layer that renders a chosen effect to an FBO
// each frame. Exposes the FBO's color attachment as the layer texture for
// the compositor to read.

import { EFFECTS } from './shader-effects.js';

export function emptyShaderLayer(id, effect = 'fbm') {
  const meta = EFFECTS[effect];
  return {
    id,
    type: 'shader',
    name: effect,
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    effect,
    params: structuredClone(meta?.defaultParams ?? {}),
  };
}

export function attachShader(regl, layer, audioState) {
  const meta = EFFECTS[layer.effect];
  if (!meta) throw new Error(`unknown effect: ${layer.effect}`);

  const W = 1024, H = 1024;
  const colorTex = regl.texture({ width: W, height: H, min: 'linear', mag: 'linear', wrap: 'clamp' });
  const fbo = regl.framebuffer({ color: colorTex, depth: false });

  const startTime = performance.now() / 1000;

  // Build uniforms map. Standard time/res/audio + per-param uniforms keyed `u_<paramName>`.
  const uniforms = {
    u_time: () => performance.now() / 1000 - startTime,
    u_res:  () => [W, H],
    u_bass: () => audioState?.uniforms?.bass ?? 0,
    u_mid:  () => audioState?.uniforms?.mid  ?? 0,
    u_high: () => audioState?.uniforms?.high ?? 0,
    u_env:  () => audioState?.uniforms?.env  ?? 0,
    u_beat: () => audioState?.uniforms?.beat ?? 0,
    u_bpm:  () => audioState?.uniforms?.bpm  ?? 0,
    u_fft:  () => audioState?.fftTexture ?? regl.texture({ width: 1, height: 1, format: 'luminance', type: 'uint8' }),
  };
  for (const s of meta.schema) {
    uniforms[`u_${s.key}`] = () => layer.params?.[s.key] ?? meta.defaultParams[s.key];
  }

  const draw = regl({
    vert: meta.vert,
    frag: meta.frag,
    attributes: { a_pos: regl.buffer([-1, -1, 3, -1, -1, 3]) },
    uniforms,
    count: 3,
    framebuffer: fbo,
    depth: { enable: false },
    blend: { enable: false },
  });

  return {
    layer,
    texture: colorTex,
    fbo,
    flipY: false,  // shader output is already in canvas orientation
    tick() {
      regl({ framebuffer: fbo, viewport: { x: 0, y: 0, width: W, height: H } })(() => {
        regl.clear({ color: [0, 0, 0, 1] });
        draw();
      });
    },
    dispose() {
      fbo.destroy?.();
      colorTex.destroy?.();
    },
  };
}
