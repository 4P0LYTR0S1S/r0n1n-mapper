// Editor-only overlay: surface outlines + control-point handles. Mode-aware.
//   - quad mode: 4 corners + edge loop
//   - mesh mode: NxM grid lines + dots at each CP

export function createOverlay(regl) {
  const lineDraw = regl({
    vert: `
      precision highp float;
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `,
    frag: `
      precision highp float;
      uniform vec4 u_color;
      void main() { gl_FragColor = u_color; }
    `,
    attributes: { a_pos: regl.prop('positions') },
    uniforms: { u_color: regl.prop('color') },
    primitive: regl.prop('primitive'),
    count: regl.prop('count'),
    depth: { enable: false },
    blend: { enable: true, func: { src: 'src alpha', dst: 'one minus src alpha' } },
  });

  const dotDraw = regl({
    vert: `
      precision highp float;
      attribute vec2 a_pos;
      uniform float u_size;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
        gl_PointSize = u_size;
      }
    `,
    frag: `
      precision highp float;
      uniform vec4 u_color;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.45, length(d));
        gl_FragColor = vec4(u_color.rgb, u_color.a * a);
      }
    `,
    attributes: { a_pos: regl.prop('positions') },
    uniforms: { u_color: regl.prop('color'), u_size: regl.prop('size') },
    primitive: 'points',
    count: regl.prop('count'),
    depth: { enable: false },
    blend: { enable: true, func: { src: 'src alpha', dst: 'one minus src alpha' } },
  });

  function drawQuad(surface, isSelected) {
    const corners = surface.warp.perspective.corners;
    const flat = new Float32Array(corners.length * 2);
    for (let i = 0; i < corners.length; i++) {
      flat[i * 2] = corners[i][0];
      flat[i * 2 + 1] = corners[i][1];
    }
    const edgeColor = isSelected ? [0, 1, 0.82, 0.9] : [0.5, 0.5, 0.6, 0.4];
    const dotColor  = isSelected ? [1, 0.25, 0.38, 1] : [0.5, 0.5, 0.5, 0.5];
    lineDraw({ positions: flat, count: corners.length, color: edgeColor, primitive: 'line loop' });
    dotDraw({ positions: flat, count: corners.length, color: dotColor, size: 14 });
  }

  function drawMesh(surface, isSelected) {
    const m = surface.warp.mesh;
    const { gridX, gridY, points } = m;

    // Build line segments along each row + column for the grid wireframe.
    // 2 verts per segment, segments = (gridX-1)*gridY + (gridY-1)*gridX
    const segCount = (gridX - 1) * gridY + (gridY - 1) * gridX;
    const segVerts = new Float32Array(segCount * 4);
    let k = 0;
    for (let j = 0; j < gridY; j++) {
      for (let i = 0; i < gridX - 1; i++) {
        const a = points[j * gridX + i];
        const b = points[j * gridX + i + 1];
        segVerts[k++] = a[0]; segVerts[k++] = a[1];
        segVerts[k++] = b[0]; segVerts[k++] = b[1];
      }
    }
    for (let i = 0; i < gridX; i++) {
      for (let j = 0; j < gridY - 1; j++) {
        const a = points[j * gridX + i];
        const b = points[(j + 1) * gridX + i];
        segVerts[k++] = a[0]; segVerts[k++] = a[1];
        segVerts[k++] = b[0]; segVerts[k++] = b[1];
      }
    }

    // Flat point buffer for dots.
    const dotVerts = new Float32Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      dotVerts[i * 2] = points[i][0];
      dotVerts[i * 2 + 1] = points[i][1];
    }

    const edgeColor = isSelected ? [0, 1, 0.82, 0.6] : [0.5, 0.5, 0.6, 0.3];
    const cornerColor = isSelected ? [1, 0.25, 0.38, 1] : [0.5, 0.5, 0.5, 0.5];
    const innerColor  = isSelected ? [1, 0.5, 0.6, 0.9]  : [0.45, 0.45, 0.5, 0.5];

    lineDraw({ positions: segVerts, count: segCount * 2, color: edgeColor, primitive: 'lines' });

    // Highlight outer-ring CPs separately from inner ones.
    const isCorner = (i) => {
      const ix = i % gridX, iy = (i / gridX) | 0;
      return ix === 0 || ix === gridX - 1 || iy === 0 || iy === gridY - 1;
    };
    const corners = [];
    const inners  = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (isCorner(i)) corners.push(p[0], p[1]); else inners.push(p[0], p[1]);
    }
    if (corners.length) dotDraw({ positions: new Float32Array(corners), count: corners.length / 2, color: cornerColor, size: 12 });
    if (inners.length)  dotDraw({ positions: new Float32Array(inners),  count: inners.length / 2,  color: innerColor,  size: 9 });
  }

  function render(state, selectedId) {
    for (const surf of state.surfaces) {
      if (!surf.visible) continue;
      const isSelected = surf.id === selectedId;
      if (surf.warp?.mode === 'mesh') drawMesh(surf, isSelected);
      else drawQuad(surf, isSelected);
    }
  }

  return { render };
}
