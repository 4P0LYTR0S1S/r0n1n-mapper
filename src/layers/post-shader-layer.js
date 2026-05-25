// Post-effect shader layer — applies a shader effect to the current surface
// accumulator (everything composited below this layer in the z-order stack).
//
// Architecture: unlike generator shaders that produce their own content and
// expose a `texture` for the compositor to blend in, post-effects flag
// `isPostEffect: true` and implement `apply(srcTex, dstFbo)`. The compositor
// detects the flag and instead of doing its normal blend pass calls
// `apply(acc, next)`, after which `next` becomes the new accumulator.
//
// `mv-smear` (the datamosh hybrid) needs a previous-frame buffer — handled
// via internal ping-pong here: we keep one local FBO that mirrors the last
// frame's output and pass it as `u_prev`.

import { POST_EFFECTS } from './shader-effects-post.js?v=2';

export function emptyPostShaderLayer(id, effect = 'rgb-shift') {
  const meta = POST_EFFECTS[effect];
  return {
    id,
    type: 'post-shader',
    name: `fx: ${effect}`,
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    effect,
    audioIntensity: 1.0,
    params: structuredClone(meta?.defaultParams ?? {}),
  };
}

export function attachPostShader(regl, layer, audioState) {
  const meta = POST_EFFECTS[layer.effect];
  if (!meta) throw new Error(`unknown post-effect: ${layer.effect}`);

  const W = 1024, H = 1024;
  const wantsFeedback = !!meta.feedback;

  // Local ping-pong for feedback post-effects (mv-smear etc). The compositor
  // gives us the most recent frame each apply(); we hold our own snapshot so
  // u_prev = the frame BEFORE the current source.
  let prevTex = null, prevFbo = null;
  if (wantsFeedback) {
    prevTex = regl.texture({ width: W, height: H, min: 'linear', mag: 'linear', wrap: 'clamp' });
    prevFbo = regl.framebuffer({ color: prevTex, depth: false });
    regl({ framebuffer: prevFbo, viewport: { x: 0, y: 0, width: W, height: H } })(() => regl.clear({ color: [0, 0, 0, 0] }));
  }

  const startTime = performance.now() / 1000;
  const ai = () => layer.audioIntensity ?? 1;

  const uniforms = {
    u_src:       () => srcInput,
    u_time:      () => performance.now() / 1000 - startTime,
    u_res:       () => [W, H],
    u_bass:      () => (audioState?.uniforms?.bass ?? 0) * ai(),
    u_mid:       () => (audioState?.uniforms?.mid  ?? 0) * ai(),
    u_high:      () => (audioState?.uniforms?.high ?? 0) * ai(),
    u_env:       () => (audioState?.uniforms?.env  ?? 0) * ai(),
    u_beat:      () => (audioState?.uniforms?.beat ?? 0) * ai(),
    u_bpm:       () => audioState?.uniforms?.bpm  ?? 0,
    u_sub:       () => (audioState?.uniforms?.sub     ?? 0) * ai(),
    u_kick:      () => (audioState?.uniforms?.kick    ?? 0) * ai(),
    u_lowMid:    () => (audioState?.uniforms?.lowMid  ?? 0) * ai(),
    u_highMid:   () => (audioState?.uniforms?.highMid ?? 0) * ai(),
    u_air:       () => (audioState?.uniforms?.air     ?? 0) * ai(),
    u_peakKick:  () => (audioState?.uniforms?.peakKick ?? 0) * ai(),
    u_peakAir:   () => (audioState?.uniforms?.peakAir  ?? 0) * ai(),
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
    uniforms.u_prev = () => prevTex;
  }

  // `srcInput` is set by apply() right before the draw, so the uniform thunk
  // captures the texture passed in by the compositor.
  let srcInput = null;

  const draw = regl({
    vert: meta.vert,
    frag: meta.frag,
    attributes: { a_pos: regl.buffer([-1, -1, 3, -1, -1, 3]) },
    uniforms,
    count: 3,
    depth: { enable: false },
    blend: { enable: false },
  });

  // Pass-through copy from dstFbo's color into our prevFbo (feedback effects).
  // Lazy-init: only built the first time a feedback effect needs it.
  // Declared BEFORE the return so it's reachable; previously these declarations
  // sat after `return {}` and `copyDraw` lived in permanent TDZ.
  let copyDraw = null;
  function copyToPrev(dstFbo, w, h) {
    if (!copyDraw) {
      copyDraw = regl({
        vert: meta.vert,
        frag: `precision highp float; varying vec2 v_uv; uniform sampler2D u_src; void main() { gl_FragColor = texture2D(u_src, v_uv); }`,
        attributes: { a_pos: regl.buffer([-1, -1, 3, -1, -1, 3]) },
        uniforms: { u_src: regl.prop('src') },
        count: 3,
        depth: { enable: false },
        blend: { enable: false },
      });
    }
    regl({ framebuffer: prevFbo, viewport: { x: 0, y: 0, width: w, height: h } })(() => {
      copyDraw({ src: dstFbo.color[0] });
    });
  }

  return {
    layer,
    isPostEffect: true,
    flipY: false,
    tick() { /* no-op — work happens in apply() */ },
    apply(srcTex, dstFbo, w, h) {
      srcInput = srcTex;
      regl({ framebuffer: dstFbo, viewport: { x: 0, y: 0, width: w, height: h } })(() => {
        regl.clear({ color: [0, 0, 0, 0] });
        draw();
      });
      if (wantsFeedback) {
        copyToPrev(dstFbo, w, h);
      }
    },
    dispose() {
      prevFbo?.destroy?.();
      prevTex?.destroy?.();
    },
  };
}
