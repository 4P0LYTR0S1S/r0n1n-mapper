// Shader layer — a generative layer that renders a chosen effect to an FBO
// each frame. Exposes the FBO's color attachment as the layer texture for
// the compositor to read.
//
// v0.6.1 — feedback ping-pong support. Effects with `meta.feedback === true`
// get TWO color textures + FBOs that alternate as render-target / sample-source
// each frame, plus a `u_prev` sampler2D uniform pointing at the previous
// frame's color. This unlocks trails, shockwave rings, motion smear, and
// every other "this frame depends on the last frame" idiom without each
// shader having to manage FBO state itself.

import { EFFECTS } from './shader-effects.js?v=6';

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
  const wantsFeedback = !!meta.feedback;

  // Ping-pong pair (or single buffer for non-feedback effects). Each "pair"
  // is one render target + its color texture; we alternate which we render
  // INTO and which we sample as u_prev.
  function makePair() {
    const tex = regl.texture({ width: W, height: H, min: 'linear', mag: 'linear', wrap: 'clamp' });
    const fb  = regl.framebuffer({ color: tex, depth: false });
    regl({ framebuffer: fb, viewport: { x: 0, y: 0, width: W, height: H } })(() => regl.clear({ color: [0, 0, 0, 1] }));
    return { tex, fb };
  }
  const pairA = makePair();
  const pairB = wantsFeedback ? makePair() : null;

  // After each tick:
  //   `current` = pair we JUST rendered into (compositor reads its tex)
  //   `prev`    = pair we sampled last frame (next tick's render target)
  let current = pairA;
  let prev    = pairB ?? pairA;  // for non-feedback, current==prev (unused for sampling)

  const startTime = performance.now() / 1000;

  // Per-layer audioIntensity scales reactive bands. Onset/phrase/drop are
  // rhythmic gates, not band levels — NOT scaled by audioIntensity so the
  // operator can dial bands down without losing rhythmic structure.
  const ai = () => layer.audioIntensity ?? 1;
  const uniforms = {
    u_time:      () => performance.now() / 1000 - startTime,
    u_res:       () => [W, H],
    // Legacy 3-band
    u_bass:      () => (audioState?.uniforms?.bass ?? 0) * ai(),
    u_mid:       () => (audioState?.uniforms?.mid  ?? 0) * ai(),
    u_high:      () => (audioState?.uniforms?.high ?? 0) * ai(),
    u_env:       () => (audioState?.uniforms?.env  ?? 0) * ai(),
    u_beat:      () => (audioState?.uniforms?.beat ?? 0) * ai(),
    u_bpm:       () => audioState?.uniforms?.bpm  ?? 0,
    u_fft:       () => audioState?.fftTexture ?? regl.texture({ width: 1, height: 1, format: 'luminance', type: 'uint8' }),
    // v0.6.0 5-band
    u_sub:       () => (audioState?.uniforms?.sub     ?? 0) * ai(),
    u_kick:      () => (audioState?.uniforms?.kick    ?? 0) * ai(),
    u_lowMid:    () => (audioState?.uniforms?.lowMid  ?? 0) * ai(),
    u_highMid:   () => (audioState?.uniforms?.highMid ?? 0) * ai(),
    u_air:       () => (audioState?.uniforms?.air     ?? 0) * ai(),
    u_peakKick:  () => (audioState?.uniforms?.peakKick ?? 0) * ai(),
    u_peakAir:   () => (audioState?.uniforms?.peakAir  ?? 0) * ai(),
    // v0.6.0 rhythmic gates (unscaled)
    u_onset:     () => audioState?.uniforms?.onset     ?? 0,
    u_beatMod4:  () => audioState?.uniforms?.beatMod4  ?? 0,
    u_barMod16:  () => audioState?.uniforms?.barMod16  ?? 0,
    u_phrasePos: () => audioState?.uniforms?.phrasePos ?? 0,
    u_dropFlag:  () => audioState?.uniforms?.dropFlag  ?? 0,
  };
  for (const s of meta.schema) {
    uniforms[`u_${s.key}`] = () => layer.params?.[s.key] ?? meta.defaultParams[s.key];
  }
  if (wantsFeedback) {
    // u_prev = the texture from the OTHER pair (last frame's render)
    uniforms.u_prev = () => prev.tex;
  }

  // No fixed framebuffer in the draw command — we set it per-tick from the
  // swap state so the same draw handles both single-buffer and ping-pong modes.
  const draw = regl({
    vert: meta.vert,
    frag: meta.frag,
    attributes: { a_pos: regl.buffer([-1, -1, 3, -1, -1, 3]) },
    uniforms,
    count: 3,
    depth: { enable: false },
    blend: { enable: false },
  });

  return {
    layer,
    // Compositor reads `texture` each frame — point it at the most recently
    // rendered pair so the displayed image is always THIS frame's output.
    get texture() { return current.tex; },
    flipY: false,
    tick() {
      // For feedback effects, swap roles BEFORE drawing: the "current" target
      // from last frame becomes this frame's "prev" source, and vice versa.
      if (wantsFeedback) {
        const tmp = current; current = prev; prev = tmp;
      }
      regl({ framebuffer: current.fb, viewport: { x: 0, y: 0, width: W, height: H } })(() => {
        regl.clear({ color: [0, 0, 0, 1] });
        draw();
      });
    },
    dispose() {
      pairA.fb.destroy?.();
      pairA.tex.destroy?.();
      pairB?.fb.destroy?.();
      pairB?.tex.destroy?.();
    },
  };
}
