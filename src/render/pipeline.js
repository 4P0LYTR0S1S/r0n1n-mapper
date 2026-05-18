// Per-frame orchestrator. For each visible surface:
//   1. Composite its layer stack into a per-surface FBO (with blend modes).
//   2. Run the warp pass for the surface's mode (quad → perspective,
//      mesh → Catmull-Rom mesh displacement) sampling that FBO onto the
//      output canvas.

import { homography } from '../surface/surface.js';
import { tessellate } from '../surface/warp-mesh.js';
import {
  WARP_VERT, WARP_FRAG, WARP_QUAD_UV, WARP_QUAD_ELEMENTS,
} from '../surface/warp-perspective.js';
import { MESH_VERT, MESH_FRAG } from '../surface/warp-mesh.js';
import { createCompositor } from './compositor.js';
import { createFBOPool } from './fbo-pool.js';
import { LUT_GLSL } from '../grade/lut.js';

export function createPipeline(regl) {
  const fboPool = createFBOPool(regl);
  const compositor = createCompositor(regl, fboPool);

  // Perspective (quad) warp draw — samples the surface FBO through the homography.
  const quadUVBuf  = regl.buffer(WARP_QUAD_UV);
  const quadElBuf  = regl.elements(WARP_QUAD_ELEMENTS);
  const warpQuad = regl({
    vert: WARP_VERT,
    frag: WARP_FRAG,
    attributes: { a_srcUV: quadUVBuf },
    elements: quadElBuf,
    uniforms: {
      u_H: regl.prop('H'),
      u_tex: regl.prop('tex'),
      u_opacity: regl.prop('opacity'),
    },
    blend: {
      enable: true,
      func: { srcRGB: 'src alpha', srcAlpha: 1, dstRGB: 'one minus src alpha', dstAlpha: 1 },
      equation: 'add',
    },
    depth: { enable: false },
    cull: { enable: false },
  });

  // 3D LUT pass — applies a color grade between compositor output and warp input.
  const lutFullTri = regl.buffer([-1, -1, 3, -1, -1, 3]);
  const lutDraw = regl({
    vert: `
      precision highp float;
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
    `,
    frag: `
      precision highp float;
      uniform sampler2D u_source;
      uniform sampler2D u_lut;
      uniform float u_lutSize;
      uniform float u_intensity;
      varying vec2 v_uv;
      ${LUT_GLSL}
      void main() {
        vec4 src = texture2D(u_source, v_uv);
        vec3 graded = sampleLut(src.rgb, u_lut, u_lutSize);
        gl_FragColor = vec4(mix(src.rgb, graded, u_intensity), src.a);
      }
    `,
    attributes: { a_pos: lutFullTri },
    uniforms: {
      u_source:    regl.prop('source'),
      u_lut:       regl.prop('lut'),
      u_lutSize:   regl.prop('size'),
      u_intensity: regl.prop('intensity'),
    },
    count: 3,
    depth: { enable: false },
    blend: { enable: false },
    cull: { enable: false },
  });

  // Mesh warp — vertex displacement of a pre-tessellated grid sampling the FBO.
  // Buffers are recreated per surface per frame for M2 (small N, cheap).
  const warpMesh = regl({
    vert: MESH_VERT,
    frag: MESH_FRAG,
    attributes: {
      a_pos: regl.prop('positions'),
      a_uv:  regl.prop('uvs'),
    },
    elements: regl.prop('elements'),
    uniforms: {
      u_tex:     regl.prop('tex'),
      u_opacity: regl.prop('opacity'),
    },
    blend: {
      enable: true,
      func: { srcRGB: 'src alpha', srcAlpha: 1, dstRGB: 'one minus src alpha', dstAlpha: 1 },
      equation: 'add',
    },
    depth: { enable: false },
    cull: { enable: false },
  });

  function render(state, layerRuntimes, ctx = {}) {
    regl.clear({ color: [0, 0, 0, 1] });

    const gl = regl._gl;
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const getLut = ctx.getLut || (() => null);

    const surfaces = state.surfaces
      .filter(s => s.visible)
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

    for (const surf of surfaces) {
      const layerRecords = (surf.layerIds ?? []).map(id => state.layers.find(l => l.id === id)).filter(Boolean);
      if (!layerRecords.length) continue;

      // 1. Composite layer stack to a per-surface FBO.
      let renderFbo = compositor.compositeStack(surf, layerRecords, layerRuntimes, W, H);

      // 2. Optional 3D LUT post-pass (per-surface color grade).
      const lutId = surf.grade?.lutId;
      const lutEntry = lutId ? getLut(lutId) : null;
      if (lutEntry?.texture && lutEntry.size) {
        const after = fboPool.acquire(W, H);
        regl({ framebuffer: after, viewport: { x: 0, y: 0, width: W, height: H } })(() => {
          regl.clear({ color: [0, 0, 0, 0] });
          lutDraw({
            source: renderFbo, lut: lutEntry.texture,
            size: lutEntry.size, intensity: surf.grade.intensity ?? 1.0,
          });
        });
        fboPool.release(renderFbo, W, H);
        renderFbo = after;
      }

      // 3. Warp pass — mode-dependent.
      if (surf.warp.mode === 'mesh') {
        const m = surf.warp.mesh;
        const tess = tessellate(m.points, m.gridX, m.gridY);
        warpMesh({
          positions: tess.positions,
          uvs:       tess.uvs,
          elements:  tess.indices,
          tex:       renderFbo,
          opacity:   surf.opacity ?? 1.0,
        });
      } else {
        warpQuad({
          H: homography(surf),
          tex: renderFbo,
          opacity: surf.opacity ?? 1.0,
        });
      }

      fboPool.release(renderFbo, W, H);
    }
  }

  return { render, fboPool, compositor };
}
