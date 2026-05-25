// v0.9 — Beat-Locked Timeline (Lite).
//
// X-axis is bars/beats, not seconds. Snapshots are placed at bar positions.
// Playback follows the BPM clock from analyser.js — when the bar-cursor crosses
// a snapshot's bar position, that snapshot is auto-applied. Loop region with
// phrase-aligned boundaries (4/8/16/32 bar) lets a single set automate forever.
//
// This is the foundation. Lite ships: one lane, transport (play/pause/stop),
// loop region, BPM-locked cursor, click-to-place snapshots. Full v1.0 expansion
// adds: multiple lanes per param, automation envelopes, drag-to-resize event
// duration, snap-to-grid quantization options, undo/redo, copy/paste regions.

// State shape:
//   state.timeline = {
//     events: [{ id, snapshotId, bar }],   // sorted by bar
//     playing: bool,
//     currentBar: 0,                        // continuous (e.g. 3.75)
//     anchorAudioTime: 0,                   // audio-clock t when play started
//     anchorBar: 0,                         // bar at play start
//     loopStart: 0,
//     loopEnd: 16,
//     loopEnabled: true,
//   };

const TOLERANCE = 0.05;  // bars — fire snapshot if cursor within ±0.05 bars of event

export function emptyTimeline() {
  return {
    events: [],
    playing: false,
    currentBar: 0,
    anchorAudioTime: 0,
    anchorBar: 0,
    loopStart: 0,
    loopEnd: 16,
    loopEnabled: true,
  };
}

export function emptyEvent(id, snapshotId, bar) {
  return { id, snapshotId, bar };
}

// Convert an absolute audio-clock time (seconds) to a bar position given BPM.
//   bars = seconds * (BPM / 60) / 4
export function timeToBar(seconds, bpm) {
  if (!bpm || bpm <= 0) return 0;
  return seconds * (bpm / 60) / 4;
}

// Create the timeline engine. Pass a `getSnapshot(id)` + `applySnapshot(snap)`
// pair (provided by the editor) plus a `getAudioTime()` that returns the
// current audio-clock seconds. The engine returns a tick() that should be
// called every frame.
//
// Per-tick:
//   1. Update state.timeline.currentBar from audio clock + anchor + BPM
//   2. If loop enabled and cursor crossed loopEnd → snap back to loopStart
//   3. For each event the cursor JUST crossed: apply that event's snapshot
export function createTimelineEngine({ getState, getAudioTime, getBpm, getSnapshot, applySnapshot }) {
  let lastBar = 0;

  function play() {
    const st = getState();
    if (!st.timeline) st.timeline = emptyTimeline();
    const tl = st.timeline;
    tl.anchorAudioTime = getAudioTime();
    tl.anchorBar = tl.currentBar;
    tl.playing = true;
    lastBar = tl.currentBar;
  }

  function pause() {
    const st = getState();
    if (st.timeline) st.timeline.playing = false;
  }

  function stop() {
    const st = getState();
    if (!st.timeline) st.timeline = emptyTimeline();
    st.timeline.playing = false;
    st.timeline.currentBar = st.timeline.loopStart ?? 0;
    lastBar = st.timeline.currentBar;
  }

  function seek(bar) {
    const st = getState();
    if (!st.timeline) st.timeline = emptyTimeline();
    st.timeline.currentBar = bar;
    st.timeline.anchorAudioTime = getAudioTime();
    st.timeline.anchorBar = bar;
    lastBar = bar;
  }

  function tick() {
    const st = getState();
    const tl = st?.timeline;
    if (!tl || !tl.playing) return;
    const bpm = getBpm();
    if (!bpm || bpm <= 0) return;  // need a BPM to advance

    const elapsedSec = getAudioTime() - (tl.anchorAudioTime ?? 0);
    const elapsedBar = timeToBar(elapsedSec, bpm);
    let newBar = (tl.anchorBar ?? 0) + elapsedBar;

    // Loop wrap
    if (tl.loopEnabled && tl.loopEnd > tl.loopStart) {
      const loopLen = tl.loopEnd - tl.loopStart;
      if (newBar >= tl.loopEnd) {
        // wrap modulo loopLen to handle large jumps cleanly
        newBar = tl.loopStart + ((newBar - tl.loopStart) % loopLen);
        // re-anchor so subsequent timeToBar math stays correct
        tl.anchorAudioTime = getAudioTime();
        tl.anchorBar = newBar;
        lastBar = newBar - 1;  // force re-fire of any events at start of loop
      }
    }

    tl.currentBar = newBar;

    // Fire events whose bar position the cursor JUST crossed.
    // Handles forward-only (lastBar < eventBar <= newBar).
    // After a loop wrap, lastBar is reset so events in the loop replay correctly.
    const events = (tl.events ?? []).slice().sort((a, b) => a.bar - b.bar);
    for (const ev of events) {
      const evBar = ev.bar;
      if (lastBar < evBar - TOLERANCE && newBar >= evBar - TOLERANCE) {
        const snap = getSnapshot(ev.snapshotId);
        if (snap) {
          try { applySnapshot(snap); }
          catch (e) { console.error('[timeline] snapshot apply failed', ev.id, e); }
        }
      }
    }

    lastBar = newBar;
  }

  return { tick, play, pause, stop, seek };
}
