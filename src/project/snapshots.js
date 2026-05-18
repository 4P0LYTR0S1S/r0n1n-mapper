// Snapshots — capture entire project state to a named slot. 16 slots is the
// magic VJ number (LaunchPad row count); we don't enforce the limit at the
// data layer, just the UI.
//
// A snapshot holds:
//   id          stable string
//   name        user-editable
//   savedAt     ISO timestamp
//   state       deep-clone of { surfaces, layers, output } at save time
//
// Recall replaces state.surfaces + state.layers from the snapshot. ui/snapshots/cues/midi
// fields stay untouched — those describe the editor session, not the visual program.

const SNAPSHOT_FIELDS = ['surfaces', 'layers', 'output'];

export function emptySnapshot(id, slotIndex) {
  return { id, name: `slot ${slotIndex + 1}`, savedAt: null, state: null };
}

export function captureSnapshot(state, id, name) {
  const snap = {
    id,
    name: name ?? `snapshot ${id.slice(-4)}`,
    savedAt: new Date().toISOString(),
    state: {},
  };
  for (const k of SNAPSHOT_FIELDS) {
    snap.state[k] = structuredClone(state[k]);
  }
  return snap;
}

// Apply a snapshot to the live state in-place. Returns a list of layerIds that
// are NEW vs the current state (caller may need to attach runtimes), and
// removed (caller disposes runtimes).
export function applySnapshot(state, snap) {
  if (!snap?.state) return { added: [], removed: [] };

  const oldLayerIds = new Set(state.layers.map(l => l.id));
  const newLayerIds = new Set(snap.state.layers.map(l => l.id));

  for (const k of SNAPSHOT_FIELDS) {
    state[k] = structuredClone(snap.state[k]);
  }

  const added = [];
  const removed = [];
  for (const id of newLayerIds) if (!oldLayerIds.has(id)) added.push(id);
  for (const id of oldLayerIds) if (!newLayerIds.has(id)) removed.push(id);
  return { added, removed };
}

// Linear interpolation helpers for crossfade.
function lerp(a, b, t) { return a + (b - a) * t; }

// Recursively interpolate numeric leaves between A and B. Non-numeric leaves
// snap at t < 0.5 → A, t >= 0.5 → B. Arrays are interpolated element-wise if
// both sides have the same length, else snap. Objects merge by key.
export function interpStates(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t);
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((_, i) => interpStates(a[i], b[i], t));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) out[k] = interpStates(a[k], b[k], t);
    return out;
  }
  return t < 0.5 ? a : b;
}

// Apply a partially-interpolated state at time t between snapA and snapB.
// Returns a list of layerIds to attach (those new in B vs A) — but ONLY when t ≥ 0.5,
// since before midpoint we're still rendering A's layer set.
export function applyCrossfade(state, snapA, snapB, t) {
  if (!snapA?.state) return applySnapshot(state, snapB);
  if (!snapB?.state) return applySnapshot(state, snapA);
  const blended = interpStates(snapA.state, snapB.state, t);
  // Snap layer membership at midpoint to avoid attaching/disposing runtimes mid-fade.
  const usingB = t >= 0.5;
  const layerSrc = usingB ? snapB.state.layers : snapA.state.layers;
  return applySnapshot(state, { state: { ...blended, layers: layerSrc } });
}
