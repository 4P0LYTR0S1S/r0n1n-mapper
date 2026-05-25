// Project JSON schema. Bump SCHEMA_VERSION on every breaking shape change and
// add an entry to MIGRATIONS so old project files keep loading.

import { defaultMeshPoints, DEFAULT_GRID_X, DEFAULT_GRID_Y } from '../surface/warp-mesh.js';
import { defaultKey } from '../keyer/keyer-glsl.js';
import { emptyLfos } from '../mod/dispatcher.js?v=1';
import { emptyTimeline } from '../timeline/timeline.js?v=1';

export const SCHEMA_VERSION = 10;

export function emptyProject() {
  return {
    version: SCHEMA_VERSION,
    name: 'untitled',
    output: { mode: 'fit', width: 1920, height: 1080 },
    ui: { selectedSurfaceId: null, selectedLayerId: null, mode: 'edit' },
    surfaces: [],
    layers: [],
    snapshots: [],   // [{ id, name, savedAt, state }]
    cues: [],        // [{ id, snapshotId, crossfadeMs }]
    midi: { bindings: [], deviceId: null },
    osc:  { bindings: [], url: 'ws://127.0.0.1:8787' },
    audio: { deviceId: null },
    djMode: { enabled: false, deckASnapId: null, deckBSnapId: null, value: 0.0 },
    // v0.8.0 — Mod Matrix: bindings between params and modulation sources.
    // `mods` is the binding list (operator-built); `lfos` is the source pool.
    mods: [],
    lfos: emptyLfos(),
    // v0.9 — Beat-Locked Timeline: events scheduled by bar position, playback
    // follows the BPM clock. Auto-applies snapshots as the cursor crosses them.
    timeline: emptyTimeline(),
  };
}

export function emptySurface(id, layerId) {
  return {
    id,
    name: 'surface',
    z: 0,
    visible: true,
    opacity: 1.0,
    blendMode: 'normal',
    // v0.7.x — outputTarget routes a surface to a specific output tab.
    // 'all' = render on every output tab (default, single-output behavior).
    // 'A' | 'B' | 'C' = render only on the output tab whose URL hash matches.
    // Open output.html#A for output A, #B for B, #C for C; output.html with no
    // hash renders ALL surfaces (so the existing single-output flow is unchanged).
    outputTarget: 'all',
    layerIds: layerId ? [layerId] : [],
    grade: { lutId: null, intensity: 1.0 },
    warp: {
      mode: 'quad',  // 'quad' | 'mesh'
      perspective: {
        corners: [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]],
      },
      mesh: {
        gridX: DEFAULT_GRID_X,
        gridY: DEFAULT_GRID_Y,
        points: defaultMeshPoints(),
      },
    },
  };
}

export function emptyVideoLayer(id) {
  return {
    id,
    type: 'video',
    name: 'video',
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    videoId: null,
    loop: true,
    muted: true,
    speed: 1.0,
    key: defaultKey(),
  };
}

export function emptyWebcamLayer(id) {
  return {
    id,
    type: 'webcam',
    name: 'webcam',
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    deviceId: null,
    key: defaultKey(),
  };
}

export function emptyImageLayer(id) {
  return {
    id,
    type: 'image',
    name: 'image',
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    imageId: null,
  };
}

export function emptySolidLayer(id, color = [1, 0, 0.5, 1]) {
  return {
    id,
    type: 'solid',
    name: 'solid',
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    color,
  };
}

const MIGRATIONS = {
  0: (proj) => {
    // v0 → v1: surfaces gain `layerIds: [singleLayer]` and `warp.mesh`. Per-layer
    // opacity/blendMode added.
    const out = { ...proj, version: 1 };
    out.ui = { ...(proj.ui ?? {}), selectedLayerId: null };
    out.surfaces = (proj.surfaces ?? []).map(s => ({
      ...s,
      layerIds: s.layerIds ?? (s.layerId ? [s.layerId] : []),
      warp: {
        ...(s.warp ?? {}),
        mode: s.warp?.mode ?? 'quad',
        perspective: s.warp?.perspective ?? { corners: [[-0.6,-0.6],[0.6,-0.6],[0.6,0.6],[-0.6,0.6]] },
        mesh: s.warp?.mesh ?? { gridX: DEFAULT_GRID_X, gridY: DEFAULT_GRID_Y, points: defaultMeshPoints() },
      },
    }));
    out.layers = (proj.layers ?? []).map(l => ({ opacity: 1.0, blendMode: 'normal', ...l }));
    return out;
  },
  1: (proj) => {
    // v1 → v2: video/webcam layers gain a `key: { mode, color, low, high, spill }` block.
    const out = { ...proj, version: 2 };
    out.layers = (proj.layers ?? []).map(l => {
      if (l.type === 'video' || l.type === 'webcam') {
        return { ...l, key: l.key ?? defaultKey() };
      }
      return l;
    });
    return out;
  },
  2: (proj) => {
    // v2 → v3: snapshots, cues, midi bindings added.
    return {
      ...proj,
      version: 3,
      snapshots: proj.snapshots ?? [],
      cues: proj.cues ?? [],
      midi: proj.midi ?? { bindings: [], deviceId: null },
    };
  },
  3: (proj) => {
    // v3 → v4: per-surface grade block (3D LUT + intensity).
    const out = { ...proj, version: 4 };
    out.surfaces = (proj.surfaces ?? []).map(s => ({
      ...s,
      grade: s.grade ?? { lutId: null, intensity: 1.0 },
    }));
    return out;
  },
  4: (proj) => {
    // v4 → v5: OSC bindings table.
    return {
      ...proj,
      version: 5,
      osc: proj.osc ?? { bindings: [], url: 'ws://127.0.0.1:8787' },
    };
  },
  5: (proj) => {
    // v5 → v6: audio device persistence + djMode (crossfader-driven snapshot morph).
    return {
      ...proj,
      version: 6,
      audio:  proj.audio  ?? { deviceId: null },
      djMode: proj.djMode ?? { enabled: false, deckASnapId: null, deckBSnapId: null, value: 0.0 },
    };
  },
  6: (proj) => {
    // v6 → v7: output.mode ('fit' | 'fixed') decouples canvas backing buffer
    // size from the window, so projector / Chromecast pipelines stop downsampling.
    const prev = proj.output ?? { width: 1920, height: 1080 };
    return {
      ...proj,
      version: 7,
      output: { mode: prev.mode ?? 'fit', width: prev.width ?? 1920, height: prev.height ?? 1080 },
    };
  },
  7: (proj) => {
    // v7 → v8: surface.outputTarget routes surfaces to specific output tabs
    // (A/B/C) for multi-projector rigs. Backfill 'all' on existing surfaces so
    // single-output projects keep behaving identically.
    const out = { ...proj, version: 8 };
    out.surfaces = (proj.surfaces ?? []).map(s => ({
      ...s,
      outputTarget: s.outputTarget ?? 'all',
    }));
    return out;
  },
  8: (proj) => {
    // v8 → v9: Mod Matrix. Empty bindings list + default LFO pool.
    return {
      ...proj,
      version: 9,
      mods: proj.mods ?? [],
      lfos: proj.lfos ?? emptyLfos(),
    };
  },
  9: (proj) => {
    // v9 → v10: Beat-Locked Timeline. Empty event list, stopped state.
    return {
      ...proj,
      version: 10,
      timeline: proj.timeline ?? emptyTimeline(),
    };
  },
};

export function migrate(proj) {
  let p = proj;
  while ((p.version ?? 0) < SCHEMA_VERSION) {
    const m = MIGRATIONS[p.version ?? 0];
    if (!m) throw new Error(`no migration from schema v${p.version} to v${SCHEMA_VERSION}`);
    p = m(p);
  }
  return p;
}
