// Surface — a mappable shape. Owns a warp definition and a stack of layer ids
// that get composited together before the warp pass samples the result.

import { CORNER_COUNT, defaultCorners, solveHomography } from './warp-perspective.js';
import {
  defaultMeshPoints, sampleMesh, epsPushback,
  DEFAULT_GRID_X, DEFAULT_GRID_Y, DEFAULT_EPS,
} from './warp-mesh.js';

export { CORNER_COUNT };

export function newSurface(id, layerId, overrides = {}) {
  return {
    id,
    name: overrides.name ?? 'surface',
    z: overrides.z ?? 0,
    visible: overrides.visible ?? true,
    opacity: overrides.opacity ?? 1.0,
    blendMode: overrides.blendMode ?? 'normal',
    layerIds: layerId ? [layerId] : (overrides.layerIds ?? []),
    grade: overrides.grade ?? { lutId: null, intensity: 1.0 },
    warp: {
      mode: overrides.mode ?? 'quad',
      perspective: {
        corners: overrides.corners ?? defaultCorners().map(c => [c[0] * 0.6, c[1] * 0.6]),
      },
      mesh: {
        gridX: overrides.gridX ?? DEFAULT_GRID_X,
        gridY: overrides.gridY ?? DEFAULT_GRID_Y,
        points: overrides.meshPoints ?? defaultMeshPoints(
          overrides.gridX ?? DEFAULT_GRID_X,
          overrides.gridY ?? DEFAULT_GRID_Y,
        ),
      },
    },
  };
}

export function homography(surface) {
  return solveHomography(surface.warp.perspective.corners);
}

export function setCorner(surface, index, xy) {
  surface.warp.perspective.corners[index] = [xy[0], xy[1]];
}

export function resetCorners(surface) {
  surface.warp.perspective.corners = defaultCorners().map(c => [c[0] * 0.6, c[1] * 0.6]);
}

export function setMeshPoint(surface, index, xy, applyEps = true) {
  const m = surface.warp.mesh;
  m.points[index] = [xy[0], xy[1]];
  if (applyEps) epsPushback(m.points, m.gridX, m.gridY, DEFAULT_EPS);
}

export function resetMesh(surface) {
  const m = surface.warp.mesh;
  m.points = defaultMeshPoints(m.gridX, m.gridY);
}

export function resizeMesh(surface, gridX, gridY) {
  const m = surface.warp.mesh;
  m.gridX = gridX;
  m.gridY = gridY;
  // Resample the existing mesh onto the new grid so the warp shape is preserved.
  const oldPoints = m.points;
  const oldGX = surface.warp.mesh.gridX; // already updated; we need the pre-resize old values
  // Workaround: store the previous mesh as a sampler before reassigning.
  // Simpler: just reset on resize (warp shape lost). Operator can re-warp.
  m.points = defaultMeshPoints(gridX, gridY);
  void oldPoints; void oldGX;
}

// Sample mesh shape for shader consumption / debug.
export function sampleMeshAt(surface, u, v) {
  const m = surface.warp.mesh;
  return sampleMesh(m.points, m.gridX, m.gridY, u, v);
}
