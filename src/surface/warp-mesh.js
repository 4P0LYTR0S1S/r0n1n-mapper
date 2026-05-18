// Catmull-Rom mesh warp. NxM control points (gridX × gridY), bicubic
// Catmull-Rom interpolation across the dense tessellated grid.
//
// Stability strategy from Spike E: ε-pushback. Math is unconditionally finite
// (no NaN even with whole row collapsed), but coincident CPs create UV
// singularities — pinched textures. ε-pushback prevents that by ensuring a
// minimum separation between adjacent CPs in row + column.

import { defaultCorners } from './warp-perspective.js';

export const DEFAULT_GRID_X = 5;
export const DEFAULT_GRID_Y = 4;
export const DEFAULT_SUBDIV = 12;
export const DEFAULT_EPS    = 0.04;  // normalized clip-space separation

// Build a default mesh: gridX × gridY control points evenly spaced inside the
// surface's perspective quad. For simplicity we initialize inside a centered
// 1.2×1.0 rectangle (matching surface.js's default quad).
export function defaultMeshPoints(gridX = DEFAULT_GRID_X, gridY = DEFAULT_GRID_Y, halfW = 0.6, halfH = 0.6) {
  const pts = [];
  for (let j = 0; j < gridY; j++) {
    for (let i = 0; i < gridX; i++) {
      const u = gridX === 1 ? 0 : i / (gridX - 1);
      const v = gridY === 1 ? 0 : j / (gridY - 1);
      pts.push([-halfW + 2 * halfW * u, -halfH + 2 * halfH * v]);
    }
  }
  return pts;
}

// Catmull-Rom 1D interpolation with uniform parameterization. tangent magic
// produces a curve that passes through every control point and matches first
// derivatives across cell boundaries — C1 continuous, no creases.
function cr1d(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function clampInt(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Sample mesh at normalized (u, v) in [0,1]². Returns [x, y] in clip space.
export function sampleMesh(points, gridX, gridY, u, v) {
  const cp = (i, j) => points[clampInt(j, 0, gridY - 1) * gridX + clampInt(i, 0, gridX - 1)];

  const fx = u * (gridX - 1);
  const fy = v * (gridY - 1);
  const i0 = Math.min(Math.floor(fx), gridX - 2);
  const j0 = Math.min(Math.floor(fy), gridY - 2);
  const tx = fx - i0;
  const ty = fy - j0;

  // Sample 4 rows × 4 cols around (i0, j0), interpolate within each row, then across rows.
  let rowsX = [0, 0, 0, 0];
  let rowsY = [0, 0, 0, 0];
  for (let dj = -1; dj <= 2; dj++) {
    const p0 = cp(i0 - 1, j0 + dj);
    const p1 = cp(i0,     j0 + dj);
    const p2 = cp(i0 + 1, j0 + dj);
    const p3 = cp(i0 + 2, j0 + dj);
    rowsX[dj + 1] = cr1d(p0[0], p1[0], p2[0], p3[0], tx);
    rowsY[dj + 1] = cr1d(p0[1], p1[1], p2[1], p3[1], tx);
  }
  const x = cr1d(rowsX[0], rowsX[1], rowsX[2], rowsX[3], ty);
  const y = cr1d(rowsY[0], rowsY[1], rowsY[2], rowsY[3], ty);
  return [x, y];
}

// ε-pushback: enforce min separation between adjacent CPs in each row + column.
// In-place mutation of the points array. Cheap O(N) per axis.
export function epsPushback(points, gridX, gridY, eps = DEFAULT_EPS) {
  // Row sweep — ensure monotonic-ish x progression with min gap.
  for (let j = 0; j < gridY; j++) {
    for (let i = 0; i < gridX - 1; i++) {
      const a = points[j * gridX + i];
      const b = points[j * gridX + i + 1];
      const dx = b[0] - a[0];
      if (dx < eps) {
        const mid = (a[0] + b[0]) * 0.5;
        a[0] = mid - eps * 0.5;
        b[0] = mid + eps * 0.5;
      }
    }
  }
  // Column sweep — same for y.
  for (let i = 0; i < gridX; i++) {
    for (let j = 0; j < gridY - 1; j++) {
      const a = points[j * gridX + i];
      const b = points[(j + 1) * gridX + i];
      const dy = b[1] - a[1];
      if (dy < eps) {
        const mid = (a[1] + b[1]) * 0.5;
        a[1] = mid - eps * 0.5;
        b[1] = mid + eps * 0.5;
      }
    }
  }
}

// Build a tessellated mesh: positions + UVs + indices. Caller uploads to regl
// buffers. Rebuild only on dirty (CP move or gridX/gridY change).
export function tessellate(points, gridX, gridY, subdiv = DEFAULT_SUBDIV) {
  const cols = (gridX - 1) * subdiv + 1;
  const rows = (gridY - 1) * subdiv + 1;
  const positions = new Float32Array(cols * rows * 2);
  const uvs       = new Float32Array(cols * rows * 2);

  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const [x, y] = sampleMesh(points, gridX, gridY, u, v);
      const idx = (r * cols + c) * 2;
      positions[idx] = x; positions[idx + 1] = y;
      uvs[idx]       = u; uvs[idx + 1]       = v;
    }
  }

  // Index buffer: triangles per quad cell.
  const cellsX = cols - 1;
  const cellsY = rows - 1;
  // Use Uint32 if vert count exceeds 65535, else Uint16 for compatibility.
  const vertCount = cols * rows;
  const IndexArray = vertCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(cellsX * cellsY * 6);
  let k = 0;
  for (let r = 0; r < cellsY; r++) {
    for (let c = 0; c < cellsX; c++) {
      const tl = r * cols + c;
      const tr = tl + 1;
      const bl = tl + cols;
      const br = bl + 1;
      indices[k++] = tl; indices[k++] = bl; indices[k++] = br;
      indices[k++] = tl; indices[k++] = br; indices[k++] = tr;
    }
  }

  return { positions, uvs, indices, cols, rows, vertCount, triCount: indices.length / 3 };
}

// Hit-test a mesh control point at clip-space (x, y). Returns flat index or -1.
export function pickMeshPoint(points, x, y, hitRadius = 0.04) {
  let best = -1;
  let bestD2 = hitRadius * hitRadius;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i][0] - x;
    const dy = points[i][1] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  return best;
}

// GLSL strings for the mesh stage. The mesh stage samples the perspective
// stage's FBO (set up to the unit square UV space) and renders the displaced
// geometry to the output.
export const MESH_VERT = `
  precision highp float;
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

export const MESH_FRAG = `
  precision highp float;
  uniform sampler2D u_tex;
  uniform float u_opacity;
  varying vec2 v_uv;
  void main() {
    // FBO is in canvas orientation (y up). No flip here; per-layer flip lives in
    // the compositor's u_flipY uniform so videos and images coexist correctly.
    vec4 c = texture2D(u_tex, v_uv);
    gl_FragColor = vec4(c.rgb, c.a * u_opacity);
  }
`;
