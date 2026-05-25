# r0n1n-mapper — Architecture (v0.9.0)

This doc covers the subsystems added in the v0.6.0 → v0.9.0 sprint. The core
warp + compositor + spike-validated decisions are in `docs/SPIKES.md`. Per-
subsystem deep-dives below.

```
┌───────────────────────────────────────────────────────────────────────┐
│  EDITOR TAB (index.html)                                              │
│                                                                       │
│  ┌────────────────────┐   ┌────────────────┐   ┌─────────────────┐   │
│  │ UI (sidebar +      │   │ store (plain   │   │ frame loop      │   │
│  │ canvas overlay)    │◄──┤ object + emit) │──►│  - tick audio   │   │
│  └────────────────────┘   └────────────────┘   │  - tick cues    │   │
│           ▲                       ▲            │  - applyMods    │   │
│           │                       │            │  - tick TL      │   │
│           │ BroadcastChannel      │ store.update  - render        │   │
│           ▼ (state:full)          ▼            └─────────────────┘   │
└───────────┼───────────────────────┼───────────────────────────────────┘
            │                       │
            ▼                       ▼
┌───────────────────────────────────────────────────────────────────────┐
│  OUTPUT TAB(s)  output.html, output.html#A, output.html#B, ...        │
│                                                                       │
│  parse URL hash → MY_OUTPUT_ID = 'all' | 'A' | 'B' | 'C'              │
│  filter state.surfaces by outputTarget                                │
│  frame loop: applyMods → pipeline.render(filtered, runtimes)          │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 1. Audio pipeline (v0.6.0)

**File**: `src/audio/analyser.js`

Web Audio `AnalyserNode` → per-frame `getByteFrequencyData()` → derived
uniforms. The exposed object is the same shape it always was (existing
shaders read `u_bass`/`u_mid`/`u_high`/`u_env`/`u_beat`/`u_bpm` unchanged),
but the analyser now also produces:

- **5-band split**: `sub` (20-60), `kick` (60-120), `lowMid` (120-500),
  `highMid` (2-4kHz), `air` (8-16kHz). Bands are intentionally NOT
  contiguous — gaps cover less musically distinct ranges.
- **Asymmetric attack/release envelope** per band. Fast attack (0.6) +
  slow release (0.05) gives kicks the "HIT then sag" feel instead of
  pulsing as a glow.
- **Peak-hold** per band with slow decay (0.94) — for freeze-on-bright effects.
- **Spectral flux onset detection**:
  `flux = Σ max(0, fft[t][i] - fft[t-1][i])`, thresholded against
  rolling mean + 1.5·stddev with 70ms refractory. Cleaner than the
  legacy bass-spike `u_beat` — catches snares/claps/anything transient.
- **Musical phrase clock**, anchored on first valid BPM (re-anchors when BPM
  shifts >1): `beatMod4` (0..4), `barMod16` (0..16), `phrasePos` (0..1 ramp
  inside an 8-bar phrase).
- **Drop detector**: 5-second RMS history. Drop = build > 3s + dip > 0.5s +
  onset reattack → `dropFlag` held 800ms with 2s cooldown.

Backward compat: legacy 3-band (`bass`/`mid`/`high`) computed exactly as
before AND passed through the new asymmetric envelope, so old shaders feel
snappier "for free" without source changes.

---

## 2. Shader-layer architecture + feedback FBO ping-pong (v0.6.1)

**Files**: `src/layers/shader-layer.js`, `src/layers/shader-effects.js`

Generator shaders (no input texture) render to their own FBO each frame;
the compositor reads `layer.texture` and blends.

Effects with `meta.feedback === true` opt into the ping-pong path. The
runtime creates TWO color textures + framebuffers and alternates each
frame:

```
Frame N:   render INTO pair.A.fbo, sample pair.B.tex as u_prev
Frame N+1: render INTO pair.B.fbo, sample pair.A.tex as u_prev
```

`layer.texture` is a getter pointing at the most-recently-rendered pair,
so the compositor + downstream code is unchanged. Single-buffer (non-
feedback) effects pay zero overhead.

This unlocks: trails, smear, shockwave-style "previous frame distortion,"
motion vector smear, and every other "this frame depends on the last frame"
idiom — without each effect managing FBO state.

Effects shipped using this: `feedback-trails`.

---

## 3. Post-effect architecture (v0.7.0)

**Files**: `src/layers/post-shader-layer.js`, `src/layers/shader-effects-post.js`,
modified `src/render/compositor.js`.

A NEW layer type — `post-shader` — operates on the surface accumulator
instead of generating its own content. Each runtime exposes
`isPostEffect: true` and `apply(srcTex, dstFbo, w, h)`.

In `compositor.js`'s `compositeStack` loop, after computing each layer's
contribution, we branch:

```js
if (rt.isPostEffect) {
  rt.apply(acc.color[0], next, w, h);  // shader transforms acc → next
  [acc, next] = [next, acc];           // swap accumulator
  continue;
}
// otherwise: normal blend pass with rt.texture
```

The same ping-pong machinery the compositor already used for blends
becomes the substrate for post-processing. Stack multiple post-fx on
one surface for layered glitch (`rgb-shift` + `scanline-tear` +
`block-displace` over a video, etc.).

Effects with `feedback: true` in `POST_EFFECTS` (currently `mv-smear`)
get an internal `prevFbo` + pass-through copy step after each `apply()`
so `u_prev` always points at the previous frame's *output* (not just
the source).

Six post-effects shipped: `rgb-shift`, `scanline-tear`, `block-displace`,
`ascii`, `pixel-sort`, `mv-smear`.

---

## 4. Triple-output A/B/C surface routing (v0.7.1)

**Files**: modified `src/main-output.js`, `src/project/schema.js`, added
A/B/C UI to `index.html` + `src/main-editor.js`.

Each surface has `outputTarget: 'all' | 'A' | 'B' | 'C'` (default `'all'`,
backward-compatible). The output tab parses URL hash:

```
output.html       → MY_OUTPUT_ID = 'all'  (renders every surface)
output.html#A     → MY_OUTPUT_ID = 'A'    (renders surfaces with target A or all)
output.html#B     → 'B'
output.html#C     → 'C'
```

Filter happens in the output's frame loop *before* `pipeline.render`:

```js
const filteredState = MY_OUTPUT_ID === 'all'
  ? state
  : { ...state, surfaces: state.surfaces.filter(...) };
pipeline.render(filteredState, layerRuntimes, ...);
```

Layer runtimes stay **shared** across output instances — they're a global
render-resource pool. The BroadcastChannel is multi-consumer natively, so
no relay or new transport. Editor UI: per-surface output dropdown +
3 `+ A` / `+ B` / `+ C` open-output mini-buttons.

Bonus side effects: mirror-mode (3 tabs at same hash = redundant rendering,
useful for OBS-capture-while-projecting), per-output `MediaRecorder` +
per-output mic engagement (`r` and `a` keys per tab).

Hardware caveat: 3× 1080p compositors on the Lenovo Plus 14 ARM iGPU will
thermal-throttle. Recommend 720p × 3 for sustained sets, 1080p × 3 only
for short bursts.

---

## 5. Modulation matrix dispatcher (v0.8.0)

**File**: `src/mod/dispatcher.js`

A binding is `{ id, paramPath, source, depth, polarity, baseValue, enabled }`.
`paramPath` resolves via a tiny pointer-like parser:
`layers[2].params.scale` → `state.layers[2].params` parent + key `scale`.

Sources are stringly-typed: `audio:kick`, `audio:onset`, `lfo:0`, etc.
`evaluateSource()` returns 0..1.

LFOs are stored on `state.lfos` (default pool of 5). Phase clock:

```js
const beatsElapsed = t * (bpm / 60);
const phi = beatsElapsed / beatsPerCycle + (lfo.phaseOffset ?? 0);
return SHAPES[lfo.wave](phi);  // sin / tri / saw / sqr / S+H
```

Per-frame dispatcher `applyMods(state, audio)` walks bindings, evaluates,
writes `base + (source × depth)` directly into the bound param. Direct
mutation BYPASSES the store-emit pipeline (the store doesn't proxy nested
mutations) — so no per-frame BroadcastChannel storm.

Cross-tab consistency: each tab runs its own `applyMods` against its local
audio. `baseValue` is captured at bind-time and used as the additive anchor
on every evaluation, so even after state:full sync of an already-modulated
value, the next frame's `applyMods` overwrites with `baseValue + freshSource × depth`.

**Operator-drag-while-modulating detection**: if the param's current value
differs from what we last wrote (float-tolerance 0.0001), assume the
operator just dragged the slider — update `baseValue` to track. So dragging
a mod-bound slider feels natural instead of fighting the modulation.

Editor + output frame loops both call `applyMods` before `pipeline.render`.

---

## 6. Beat-locked timeline engine (v0.9.0)

**File**: `src/timeline/timeline.js`

`state.timeline = { events, playing, currentBar, anchorAudioTime,
anchorBar, loopStart, loopEnd, loopEnabled }`. Each event is
`{ id, snapshotId, bar }`.

`createTimelineEngine({getState, getAudioTime, getBpm, getSnapshot, applySnapshot})`
returns `{ tick, play, pause, stop, seek }`.

Per-tick math:

```
elapsedSec = audioTime - anchorAudioTime
elapsedBar = elapsedSec * (bpm / 60) / 4
newBar     = anchorBar + elapsedBar
```

If `loopEnabled` and `newBar >= loopEnd`, wrap modulo loop length and
re-anchor so subsequent math stays correct.

For each event the cursor JUST crossed (`lastBar < eventBar - TOLERANCE`
AND `newBar >= eventBar - TOLERANCE`, where TOLERANCE = 0.05 bars ≈ 75ms
at 120 BPM), the engine calls `applySnapshot(snap)`.

Tempo dependency: when `bpm === 0`, `tick()` early-returns. Operator must
engage audio + tap tempo OR receive MIDI Clock for the timeline to play.

Only the editor calls `timelineEngine.tick()` (in its frame loop). When
the editor applies a snapshot, the resulting state mutation broadcasts via
the normal store path, so output tabs receive the updated state without
running their own timeline engine. Single-instance dispatch keeps timing
deterministic.

---

## 7. Cross-cutting: cache-bust convention

Each per-file ES module import that gets edited gets a `?v=N` query string
bumped on every functional change. The HTML entry points (`index.html`,
`output.html`) carry `?v=N` on the top-level `main-editor.js` /
`main-output.js` import.

Why: Chromium's V8 module map caches by URL. Editing a deep import
doesn't bust the outer cache. Bumping `?v=` forces a fresh fetch + parse.
`dev-serve.py` sets `Cache-Control: no-store` to mitigate during dev, but
the explicit `?v=` is the safer cross-environment pattern (production
hosts may add caching).

Current state (v0.9.0):
- `index.html` → `main-editor.js?v=23`
- `output.html` → `main-output.js?v=17`
- `shader-effects.js?v=6`, `shader-layer.js?v=2`, `title-layer.js?v=2`,
  `dancer-img-layer.js?v=5`, `analyser.js?v=1`, `webcam-layer.js?v=1`,
  `shader-effects-post.js?v=2`, `post-shader-layer.js?v=2`,
  `mod/dispatcher.js?v=1`, `timeline/timeline.js?v=1`.

---

## 8. State shape after v0.9.0

```ts
state = {
  version: 10,
  name: string,
  output: { mode: 'fit' | 'fixed', width, height },
  ui: { selectedSurfaceId, selectedLayerId, mode },

  surfaces: [{
    id, name, z, visible, opacity, blendMode,
    outputTarget: 'all' | 'A' | 'B' | 'C',     // v0.7.1
    layerIds: [string],
    grade: { lutId, intensity },
    warp: { mode: 'quad' | 'mesh', perspective, mesh },
  }],

  layers: [
    { type: 'video' | 'image' | 'webcam' | 'solid', ... },
    { type: 'shader', effect: string, params: {...} },           // v0.3.0+
    { type: 'post-shader', effect: string, params: {...} },      // v0.7.0
    { type: 'hydra', code: string },
    { type: 'dancer-img', complexBody: bool, parts: {...} },     // v0.5.0
    { type: 'title', text, font, revealMode, ... },              // v0.4.0
  ],

  snapshots: [{ id, name, savedAt, state }],
  cues: [{ id, snapshotId, crossfadeMs }],

  midi: { bindings, deviceId },
  osc:  { bindings, url },
  audio: { deviceId },

  djMode: { enabled, deckASnapId, deckBSnapId, value },

  mods: [{                                                       // v0.8.0
    id, paramPath, source,
    depth, polarity: 'uni' | 'bi',
    baseValue, enabled, _lastApplied,
  }],
  lfos: [{ id, wave, rate, phaseOffset }],                       // v0.8.0

  timeline: {                                                    // v0.9.0
    events: [{ id, snapshotId, bar }],
    playing, currentBar, anchorAudioTime, anchorBar,
    loopStart, loopEnd, loopEnabled,
  },
}
```
