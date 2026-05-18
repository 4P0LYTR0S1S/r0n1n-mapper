// Map a pointer event on the canvas to clip-space and ask the surface's
// active warp mode which control point (if any) was hit.

import { pickCorner } from './warp-perspective.js';
import { pickMeshPoint } from './warp-mesh.js';

export function screenToClip(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  return [x * 2 - 1, -(y * 2 - 1)];
}

// Returns { kind, index } or null.
// kind: 'corner' | 'mesh'
// index: corner 0..3 or mesh flat index.
export function hitTest(surface, canvas, event, hitRadius = 0.04) {
  if (!surface) return null;
  const [x, y] = screenToClip(canvas, event);
  const mode = surface.warp?.mode;

  if (mode === 'quad') {
    const idx = pickCorner(surface.warp.perspective.corners, x, y, hitRadius);
    return idx >= 0 ? { kind: 'corner', index: idx } : null;
  }
  if (mode === 'mesh') {
    const m = surface.warp.mesh;
    const idx = pickMeshPoint(m.points, x, y, hitRadius);
    return idx >= 0 ? { kind: 'mesh', index: idx } : null;
  }
  return null;
}
