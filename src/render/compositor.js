// Surface-local compositor. Takes a stack of layer runtimes and composites
// them with per-layer opacity + blend mode + optional chroma/luma key into
// a target FBO via ping-pong FBOs.

import { BLEND_GLSL, blendIndex } from './blend-modes.js';
import { KEYER_GLSL, keyModeIndex } from '../keyer/keyer-glsl.js';

const VERT = `
  precision highp float;
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const FRAG = `
  precision highp float;
  uniform sampler2D u_above;
  uniform sampler2D u_below;
  uniform float u_opacity;
  uniform int u_blendMode;
  uniform int u_flipY;
  varying vec2 v_uv;
  ${BLEND_GLSL}
  ${KEYER_GLSL}
  void main() {
    vec2 uvA = vec2(v_uv.x, u_flipY == 1 ? 1.0 - v_uv.y : v_uv.y);
    vec4 above = applyKey(texture2D(u_above, uvA));
    vec4 below = texture2D(u_below, v_uv);
    vec3 blended = blendRGB(u_blendMode, above.rgb, below.rgb);
    float a = above.a * u_opacity;
    vec3 outRGB = blended * a + below.rgb * (1.0 - a);
    float outA  = a + below.a * (1.0 - a);
    gl_FragColor = vec4(outRGB, outA);
  }
`;

const FULLSCREEN_TRI = new Float32Array([-1, -1, 3, -1, -1, 3]);

export function createCompositor(regl, fboPool) {
  const triBuf = regl.buffer(FULLSCREEN_TRI);
  const compose = regl({
    vert: VERT,
    frag: FRAG,
    attributes: { a_pos: triBuf },
    uniforms: {
      u_above:     regl.prop('above'),
      u_below:     regl.prop('below'),
      u_opacity:   regl.prop('opacity'),
      u_blendMode: regl.prop('blendMode'),
      u_flipY:     regl.prop('flipY'),
      u_keyMode:   regl.prop('keyMode'),
      u_keyColor:  regl.prop('keyColor'),
      u_keyLow:    regl.prop('keyLow'),
      u_keyHigh:   regl.prop('keyHigh'),
      u_keySpill:  regl.prop('keySpill'),
    },
    count: 3,
    depth: { enable: false },
    blend: { enable: false },
    cull: { enable: false },
  });

  function compositeStack(surface, layerRecords, layerRuntimes, w, h) {
    let acc = fboPool.acquire(w, h);
    let next = fboPool.acquire(w, h);

    regl({ framebuffer: acc, viewport: { x: 0, y: 0, width: w, height: h } })(() => {
      regl.clear({ color: [0, 0, 0, 0] });
    });

    if (!layerRecords.length) {
      fboPool.release(next, w, h);
      return acc;
    }

    for (const layer of layerRecords) {
      if (!layer || !layer.enabled) continue;
      const rt = layerRuntimes.get(layer.id);
      if (!rt) continue;
      rt.tick?.();

      // v0.7.0 — post-effect layers operate on the accumulator instead of
      // blending in their own texture. They write the transformed result
      // into `next`; we then swap roles so the post-effect output IS the
      // new accumulator for the next layer up the stack.
      if (rt.isPostEffect) {
        rt.apply(acc.color[0], next, w, h);
        const tmp = acc; acc = next; next = tmp;
        continue;
      }

      if (!rt.texture) continue;

      const key = layer.key ?? { mode: 'none' };
      regl({ framebuffer: next, viewport: { x: 0, y: 0, width: w, height: h } })(() => {
        regl.clear({ color: [0, 0, 0, 0] });
        compose({
          above:     rt.texture,
          below:     acc,
          opacity:   layer.opacity ?? 1.0,
          blendMode: blendIndex(layer.blendMode ?? 'normal'),
          flipY:     rt.flipY ? 1 : 0,
          keyMode:   keyModeIndex(key.mode),
          keyColor:  key.color ?? [0, 1, 0],
          keyLow:    key.low ?? 0.05,
          keyHigh:   key.high ?? 0.25,
          keySpill:  key.spill ?? 0.5,
        });
      });
      const tmp = acc; acc = next; next = tmp;
    }

    fboPool.release(next, w, h);
    return acc;
  }

  return { compositeStack };
}
