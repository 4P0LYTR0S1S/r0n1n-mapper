// Cue list — ordered playback of snapshots with crossfade timing.
// Each cue: { id, snapshotId, crossfadeMs }
// The CueEngine manages currentIndex + active crossfade clock.

import { applySnapshot, applyCrossfade } from './snapshots.js';

export function emptyCue(snapshotId, crossfadeMs = 1000) {
  return {
    id: 'cue_' + crypto.randomUUID().slice(0, 8),
    snapshotId,
    crossfadeMs,
  };
}

export function createCueEngine(store, snapshotLookup, attachLayerRuntime, layerRuntimes) {
  let index = -1;
  let fade = null;  // { from, to, startedAt, durationMs }

  function snapAt(i) {
    const cue = store.state.cues[i];
    if (!cue) return null;
    return snapshotLookup(cue.snapshotId);
  }

  async function advanceTo(targetIndex) {
    const len = store.state.cues.length;
    if (!len) return;
    targetIndex = ((targetIndex % len) + len) % len;
    const fromSnap = index >= 0 ? snapAt(index) : null;
    const toSnap = snapAt(targetIndex);
    if (!toSnap) return;

    const cue = store.state.cues[targetIndex];
    const dur = cue.crossfadeMs ?? 1000;

    if (!fromSnap || dur <= 0) {
      // Hard cut.
      store.update('', (st) => {
        const { added } = applySnapshot(st, toSnap);
        // (re)attach any newly-introduced layer runtimes
        for (const id of added) {
          const layer = st.layers.find(l => l.id === id);
          if (!layer) continue;
          attachLayerRuntime(layer).then(rt => layerRuntimes.set(id, rt))
            .catch(e => console.error('[cue] attach failed', id, e));
        }
      });
      fade = null;
    } else {
      fade = { from: fromSnap, to: toSnap, startedAt: performance.now(), durationMs: dur };
    }
    index = targetIndex;
  }

  function tick() {
    if (!fade) return;
    const t = Math.min(1, (performance.now() - fade.startedAt) / fade.durationMs);
    store.update('', (st) => {
      applyCrossfade(st, fade.from, fade.to, t);
    });
    if (t >= 1) fade = null;
  }

  return {
    advance:   () => advanceTo(index + 1),
    previous:  () => advanceTo(index - 1),
    goto:      (i) => advanceTo(i),
    get index() { return index; },
    get crossfading() { return !!fade; },
    tick,
  };
}
