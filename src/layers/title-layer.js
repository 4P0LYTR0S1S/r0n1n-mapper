// Title layer — canvas-baked text rendered with audio-reactive bloom, beat-
// locked scale pop, and BPM-driven character-by-character reveal. Designed
// for demo intros / outros and for self-referential overlays in the projection
// pipeline. The text is rasterized to a 2D canvas at attach time (and when
// the text/font params change), then sampled in a fragment shader for the
// reactive effects.

import { createAudioState } from '../audio/uniforms.js';

export function emptyTitleLayer(id) {
  return {
    id,
    type: 'title',
    name: 'title',
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    text: 'r0n1n // mapper',
    font: 'monospace',
    fontSize: 96,           // px
    color: [0.0, 1.0, 0.85],   // primary text color
    glowColor: [1.0, 0.20, 0.85],  // glow / bloom color
    glow: 1.0,              // base glow intensity 0..3
    audioIntensity: 1.8,    // multiplier on reactive bands
    revealMode: 1,          // 0=instant, 1=char-by-char, 2=word-by-word, 3=fade-in
    revealSpeed: 4,         // chars per beat at BPM
    scale: 1.0,             // base scale
    rotation: 0,            // base rotation in degrees
    yPos: 0.5,              // 0..1, vertical center
    xPos: 0.5,              // 0..1, horizontal center
  };
}

const TAU = Math.PI * 2;

// Bake the text into a 2D canvas. Returns { canvas, charPositions }.
// charPositions is an array of cumulative widths (in canvas px) — used to
// compute the reveal point for char-by-char mode.
function bakeText(text, font, fontSize) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  // Measure first at a temp size to compute final canvas dimensions.
  ctx.font = `bold ${fontSize}px ${font}`;
  const metrics = ctx.measureText(text);
  const padding = Math.max(20, Math.floor(fontSize * 0.3));
  c.width = Math.ceil(metrics.width) + padding * 2;
  c.height = Math.ceil(fontSize * 1.4) + padding * 2;
  // Re-set font after canvas resize (canvas resets context state).
  ctx.font = `bold ${fontSize}px ${font}`;
  ctx.fillStyle = 'white';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, padding, c.height / 2);
  // Compute cumulative widths so the shader can mask by characters revealed.
  const charPositions = new Array(text.length + 1).fill(0);
  let cumWidth = 0;
  for (let i = 0; i < text.length; i++) {
    cumWidth = ctx.measureText(text.slice(0, i + 1)).width;
    charPositions[i + 1] = (padding + cumWidth) / c.width;  // normalized 0..1
  }
  charPositions[0] = padding / c.width;
  return { canvas: c, charPositions, charCount: text.length };
}

export async function attachTitle(regl, layer, audioState) {
  let baked = bakeText(layer.text, layer.font, layer.fontSize);
  let lastSig = `${layer.text}|${layer.font}|${layer.fontSize}`;

  let textTex = regl.texture({
    data: baked.canvas,
    min: 'linear', mag: 'linear', wrap: 'clamp', flipY: true,
  });

  const W = 1024, H = 1024;
  const colorTex = regl.texture({ width: W, height: H, min: 'linear', mag: 'linear', wrap: 'clamp' });
  const fbo = regl.framebuffer({ color: colorTex, depth: false });

  const startTime = performance.now() / 1000;

  const draw = regl({
    vert: `
      precision highp float;
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = (a_pos + 1.0) * 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `,
    frag: `
      precision highp float;
      uniform sampler2D u_tex;
      uniform vec2 u_res;
      uniform vec2 u_texSize;   // baked text canvas dims
      uniform vec2 u_pos;       // center position in FBO uv
      uniform float u_scale;
      uniform float u_rotation; // radians
      uniform vec3 u_color;
      uniform vec3 u_glowColor;
      uniform float u_glow;
      uniform float u_revealEnd;   // 0..1, masks pixels with u_charX > this
      uniform float u_revealEdge;  // softness of mask edge (0..0.05)
      uniform int u_revealMode;
      uniform float u_bass;
      uniform float u_high;
      uniform float u_beat;
      uniform float u_time;
      varying vec2 v_uv;

      void main() {
        // Compute aspect-aware target rect for the text texture, centered at u_pos
        float aspect = u_texSize.x / u_texSize.y;
        float h = 0.18 * u_scale * (1.0 + u_beat * 0.15);
        float w = h * aspect;
        // local coords relative to u_pos
        vec2 d = v_uv - u_pos;
        float c = cos(u_rotation), s = sin(u_rotation);
        vec2 lc = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
        // map to texture uv: text spans [-w/2..+w/2] horiz, [-h/2..+h/2] vert
        vec2 texUV = vec2(lc.x / w + 0.5, lc.y / h + 0.5);
        if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) {
          // Outside text — still allow glow bloom via blurred sample
          gl_FragColor = vec4(0.0);
          return;
        }
        // Chromatic aberration on highs
        float chromAb = u_high * 0.008;
        float r = texture2D(u_tex, texUV + vec2(chromAb, 0.0)).a;
        float g = texture2D(u_tex, texUV).a;
        float b = texture2D(u_tex, texUV - vec2(chromAb, 0.0)).a;
        float aMain = max(r, max(g, b));

        // Reveal mask — mask out pixels with texUV.x > u_revealEnd
        float revealMask = 1.0;
        if (u_revealMode == 1 || u_revealMode == 2) {
          revealMask = 1.0 - smoothstep(u_revealEnd, u_revealEnd + u_revealEdge, texUV.x);
        } else if (u_revealMode == 3) {
          // fade in (no positional mask, just time-based)
          revealMask = u_revealEnd;
        }
        // Mode 0 (instant) leaves revealMask = 1.0

        // Bloom — sample around with offsets, summed
        float bloom = 0.0;
        float bloomR = 0.012 * (1.0 + u_bass * 1.5);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 3.14159265 / 4.0;
          vec2 off = vec2(cos(a), sin(a)) * bloomR;
          bloom += texture2D(u_tex, texUV + off).a;
        }
        bloom /= 8.0;

        vec3 textCol = u_color * aMain;
        vec3 chromaShift = vec3(r, g, b) * 0.5;
        vec3 finalCol = textCol + chromaShift * (u_high * 0.7);
        finalCol += u_glowColor * bloom * u_glow * (1.0 + u_bass * 1.3);

        float alpha = (aMain + bloom * u_glow * 0.8) * revealMask;
        gl_FragColor = vec4(finalCol * revealMask, clamp(alpha, 0.0, 1.0));
      }
    `,
    attributes: { a_pos: regl.buffer([-1, -1, 3, -1, -1, 3]) },
    uniforms: {
      u_tex: () => textTex,
      u_res: () => [W, H],
      u_texSize: () => [baked.canvas.width, baked.canvas.height],
      u_pos: () => [layer.xPos ?? 0.5, layer.yPos ?? 0.5],
      u_scale: () => layer.scale ?? 1,
      u_rotation: () => (layer.rotation ?? 0) * Math.PI / 180,
      u_color: () => layer.color ?? [0, 1, 0.85],
      u_glowColor: () => layer.glowColor ?? [1, 0.2, 0.85],
      u_glow: () => layer.glow ?? 1.0,
      u_revealEnd: regl.prop('revealEnd'),
      u_revealEdge: () => 0.015,
      u_revealMode: () => layer.revealMode ?? 0,
      u_bass: () => (audioState?.uniforms?.bass ?? 0) * (layer.audioIntensity ?? 1),
      u_high: () => (audioState?.uniforms?.high ?? 0) * (layer.audioIntensity ?? 1),
      u_beat: () => (audioState?.uniforms?.beat ?? 0) * (layer.audioIntensity ?? 1),
      u_time: () => performance.now() / 1000 - startTime,
    },
    count: 3,
    depth: { enable: false },
    blend: {
      enable: true,
      func: { srcRGB: 'src alpha', srcAlpha: 1, dstRGB: 'one minus src alpha', dstAlpha: 1 },
    },
    framebuffer: fbo,
  });

  // Re-bake the text texture if the text/font/size params changed.
  function maybeRebake() {
    const sig = `${layer.text}|${layer.font}|${layer.fontSize}`;
    if (sig === lastSig) return;
    lastSig = sig;
    baked = bakeText(layer.text, layer.font, layer.fontSize);
    try { textTex.destroy?.(); } catch {}
    textTex = regl.texture({
      data: baked.canvas,
      min: 'linear', mag: 'linear', wrap: 'clamp', flipY: true,
    });
  }

  return {
    layer,
    texture: colorTex,
    flipY: false,
    tick() {
      maybeRebake();
      const t = performance.now() / 1000 - startTime;
      const bpm = Math.max(audioState?.uniforms?.bpm ?? 0, 90);

      // Compute revealEnd 0..1 based on mode + BPM clock
      let revealEnd = 1.0;
      if (layer.revealMode === 1) {
        // char-by-char: at speed chars-per-beat, reveal one char per (60/bpm/speed) seconds
        const charsPerSec = (bpm / 60) * (layer.revealSpeed ?? 4);
        const revealedChars = Math.min(t * charsPerSec, baked.charCount);
        const idx = Math.min(Math.floor(revealedChars), baked.charCount);
        // Interp between idx and idx+1 by the fractional part for smooth in-flight
        const frac = revealedChars - idx;
        const lo = baked.charPositions[idx] ?? 1.0;
        const hi = baked.charPositions[Math.min(idx + 1, baked.charCount)] ?? 1.0;
        revealEnd = lo + (hi - lo) * frac;
      } else if (layer.revealMode === 2) {
        // word-by-word: same idea but jump per-space
        const charsPerSec = (bpm / 60) * (layer.revealSpeed ?? 4);
        const tt = Math.min(t * charsPerSec, baked.charCount);
        revealEnd = baked.charPositions[Math.min(Math.floor(tt), baked.charCount)] ?? 1.0;
      } else if (layer.revealMode === 3) {
        // fade-in: linear over 1s
        revealEnd = Math.min(t / 1.5, 1.0);
      }

      regl.clear({ color: [0, 0, 0, 0], depth: 1, framebuffer: fbo });
      draw({ revealEnd });
    },
    dispose() {
      try { textTex.destroy?.(); } catch {}
      fbo.destroy?.();
      colorTex.destroy?.();
    },
  };
}
