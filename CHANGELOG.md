# Changelog

All notable changes to r0n1n-mapper. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/) with calver-style date stamps for pre-1.0 milestones.

## [0.4.0] — 2026-05-22

**Self-Demoing + Dancer Builder.** The tool now records its own demos and the
image-dancer becomes tunable per-body-part. Plus a global slider-drag fix
(regression caught mid-batch), animated title text, and live-performance
keyboard shortcuts for snapshot scenes.

### Added

- **Title / typewriter layer** (`+ title` in the topbar). New layer type that
  rasterizes a configurable string to a 2D canvas, uploads it as a regl texture,
  and renders with audio-reactive bloom (bass-driven), chromatic aberration
  (high-driven), and BPM-locked character-by-character reveal. Four reveal modes
  (instant / char-by-char / word-by-word / fade-in). Live-edit the text in a
  debounced text input; rotation, scale, x/y position, glow and color all
  per-layer. Sits in `src/layers/title-layer.js`.
- **MediaRecorder on the output tab** — `r` / `R` key starts and stops a
  `MediaRecorder` on the output canvas at 60 fps. Mic audio is muxed in if
  the output tab has engaged audio (`a` key). Pulsing red `● rec` indicator
  appears in the HUD while recording. Stop downloads
  `r0n1n-output-<ISO timestamp>.webm` to the user's Downloads. The tool now
  demos itself with one keystroke; no external screen recorder needed.
- **HUD toggle on output** — `h` / `H` hides the fps / sync / rec overlay so
  the projection wall stays clean for performance / capture.
- **Snapshot hotkeys 1–9** — pressing a digit recalls the snapshot in that
  slot; `Shift+digit` saves the current state into that slot. Uses the
  existing 16-slot snapshot infrastructure; ignored while focus is in any
  text / select input. Live-performance ergonomics.
- **`docs/DANCER_BODY_PARTS.md`** — best-practice guide for preparing body
  part images (connection-point-at-top convention, PNG transparency,
  per-part adjustment cheatsheet, recommended workflow).
- **Dancer-img per-part overrides** — each of the 6 body parts (head / torso /
  arm L / arm R / leg L / leg R) gains a collapsible `<details>` panel with
  six controls: `rotation°`, `length` (multiplier on bone length), `width`
  (multiplier on layer base width), `offsetX` / `offsetY` (slide along
  canvas UV), `flipX` / `flipY` (mirror checkboxes). Lets users tune any
  uploaded sprite without re-exporting from an image editor.
- **`getAudioStream()` export** from `src/audio/analyser.js` — exposes the
  live mic `MediaStream` so the output-tab MediaRecorder can mux audio
  alongside the canvas video.

### Fixed

- **Global slider drag regression** (`src/main-editor.js`). Every range input
  in the editor was firing `oninput` → `store.update` → `store.subscribe` →
  `syncUI()`, which rebuilt the entire sidebar DOM from scratch — including
  the slider element being dragged. The pointer-capture target was destroyed
  mid-drag, so every drag turned into a single tap (one event before the
  element vanished). Fix: a global `isDragging` flag plus an `attachDragGuard()`
  helper. `syncUI()` defers while drag is active and runs once on the
  window-level `pointerup` event. Applied to both `rangeInput` (per-effect
  param sliders) and `opacityRange` (per-layer opacity).
- **Output tab banner stickiness** (`src/main-output.js`). The "audio live /
  F = fullscreen" status text I repurposed in v0.2.2 stayed pinned on the
  projection when sync briefly went stale (>1.5s without an editor broadcast)
  — `body.live` would drop and the banner would reappear with the repurposed
  text. Fix: removes the `#idle` element from the DOM entirely once audio is
  engaged; it can no longer reappear.
- **Sidebar horizontal overflow** when many `+ <layer>` add-buttons fit in a
  single `.row`. `flex-wrap: wrap` on `#panel .row` so they cleanly drop to
  the next line as the panel narrows. Future-proof for new layer types.

### Changed

- **Audio device picker always visible after engagement** (`src/main-editor.js`).
  Previously hidden when ≤ 1 input device — but users couldn't see which
  device was selected, and couldn't pick a Stereo Mix / loopback if one
  appeared later. Now hidden only when zero inputs.
- **CSS focus highlight on range sliders** (`assets/styles.css`). A 2px accent
  outline on `input[type="range"]:focus` so the keyboard-focused slider is
  visible (arrow keys nudge by `step` natively). `touch-action: none`
  prevents touchscreen pan-y from stealing the drag gesture.

## [0.3.0] — 2026-05-21

Feature drop. Wire-frame procedural dancer + uploadable-body-part dancer + 6 full-screen audio-reactive preset scenes + fixed output canvas resolution. Per-shader-layer audio intensity scaling. Dev-loop infrastructure: threaded no-cache HTTP server + push button for cases the auto-broadcast misses.

### Added

- **Wire Frame Dancer (`dancer` shader effect)** — procedural SDF skeleton with hip / spine / shoulders / arms / legs / head / neck. BPM-locked phase clock, bass-driven squat, mid-driven swing, high-driven jitter, beat-driven joint flash. 11 capsule bones + glowing joints. Lives in `src/layers/shader-effects.js`. Default params: cyan bones, magenta joints, near-black-blue bg.
- **Dancer-Image layer (`dancer-img`)** — 6 uploadable body-part sprites (HEAD, TORSO, ARM L, ARM R, LEG L, LEG R) driven by the same audio-reactive joint math as the SDF dancer. Each part is a textured rectangle whose anchor / rotation / scale is computed from joint positions every frame. Upload PNG/JPG per slot via the layer panel; images persist in IndexedDB. Per-part `replace` mid-session. Audio intensity slider + width controls per body part. v1 ships with rigid sprites (no elbow/knee bend) — mesh-deformed limbs queued for a future release.
- **Preset scenes dropdown** — 6 full-screen showcases in the topbar: `◉ Dancer Void`, `✚ Neon Cathedral`, `┃ Spectrum Rain`, `⌇ Plasma Storm`, `≈ Deep Noise`, `◯ Cyber Galactic`. Each applies a complete `{ surfaces, layers }` state (1 full-canvas surface, 2-3 stacked layers tuned for blend mode + audio intensity). `src/project/presets.js`.
- **Fixed output canvas resolution** — new topbar `⌗ resolution` dropdown decouples the output-tab canvas backing buffer from the window size. Options: `fit window` (legacy), `1080p`, `1440p`, `4K`. Letterboxes via CSS `object-fit: contain`. Required for projector / Chromecast / OBS NDI pipelines that need exact pixel mapping. Schema bumped v6 → v7 with backfill migration. README has a new `Output resolution & casting` table documenting the Chromecast 1080p/30fps cap.
- **Per-shader-layer audio intensity slider** — `layer.audioIntensity` (0…3, default 1) multiplies `u_bass / u_mid / u_high / u_env / u_beat` going into the shader. Dial down for a chill layer, dial up for a strobing one without editing the shader.
- **`dev-serve.py`** — `ThreadingHTTPServer` with `Cache-Control: no-store` + `SO_REUSEADDR / SO_REUSEPORT`. Replaces `python3 -m http.server` for development; module edits picked up on plain Ctrl+R instead of hard-refresh, multiple concurrent connections (editor + output tabs in parallel) no longer stall.
- **Topbar `↺ push` button** — manual force-send of `state:full` to the output tab. Already shipped quietly in v0.2.1 but was untitled; now has a tooltip.
- **`docs/EFFECTS_BACKLOG.md`** — research-swarm output: 5 novel music-reactive effect specs queued for future releases (Spectral Terrain, Feedback Slime, Formant Veil, ASCII Spectrum Rain, Drift Weave).

### Fixed

- **dancer-img layer panel bleed** — the per-part upload rows were occupying single cells of the parent `.lkey` grid (which is `grid-template-columns: 175px 175px` for label/control pairs), so 3 of the 6 rows landed in the right column and overflowed the sidebar into the canvas area. Now `grid-column: 1 / -1` so each row spans the full panel width.

### Changed

- **Schema `v6 → v7`** — `state.output` gains a `mode: 'fit' | 'fixed'` field. Old `v6` projects auto-migrate; the field backfills to `{ mode: 'fit', width: 1920, height: 1080 }` on load. No user action required.

## [0.2.2] — 2026-05-21

Audio resilience hotfix. Output tab gains its own microphone path because Chrome aggressively throttles background tabs — when the output window sat behind the editor (or sat on a second display Chrome considered "inactive"), its rAF clock slowed to ~1 Hz and any audio sourced via editor-side broadcast was effectively dead. The output now requests its own `getUserMedia` so audio reactivity survives whichever tab loses focus. Also widens the cross-tab audio plumbing so the broadcast path stays available as a future fallback.

### Added

- **`src/main-output.js`** — `'a' / 'A'` key on the output tab calls `initAudio(null)` to request mic permission directly. Also: clicking the output canvas auto-prompts on first interaction (one-shot), with `console.warn` on denial so the rest of the pipeline (state mirror, no-audio shaders, video layers) keeps running.
- **`src/audio/uniforms.js`** — `replace(received)` method on `audioState`. Lets a tab consume audio uniforms broadcast from another tab as an alternative to running its own analyser; currently unused but future-ready.

### Fixed

- **`output.html`** — `?v=3` cache-bust on `main-output.js` so v0.2.1 installs pick up the new audio paths on their next visit.

## [0.2.1] — 2026-05-20

Hotfix release. Output tab was crashing on load since v0.2.0 due to a temporal dead zone bug in `main-output.js` — `createAudioState(regl)` was being called before `regl` had been initialized. The output tab never reached its BroadcastChannel subscriber, so editor → output state sync never worked in any v0.2.0 install. This release reorders the initialization and adds a manual push affordance for any future case where auto-sync stalls.

### Fixed

- **`src/main-output.js`** — `audioState` and the LUT-manager IIFE moved to after `const regl = initRegl(canvas)`. Output tab now initializes cleanly, BroadcastChannel handshake completes, `body.live` + `sync ✓` show in the output HUD as expected.
- **`output.html`** — `?v=2` cache-bust appended to the `main-output.js` script src so existing v0.2.0 users who already loaded the broken module pick up the fix on their next visit instead of being stuck on the cached crash.

### Added

- **Editor topbar `↺ push` button** — manual force-send of `state:full` to the output tab. Useful when an external change to state slips past the `store.subscribe` autosync path.
- **`window.__broadcastState`** — same function exposed on the editor window for devtools-console invocation (`__broadcastState()`).

## [0.2.0] — 2026-05-19

Performance-artist integration release. Three plug-and-play surfaces (FL Studio, DJ software, broadcast-ready audio routing) plus first-class DJ mode crossfader morph.

### Added — FL Studio + DJ integration

- **MIDI Clock auto-BPM** — parse 0xF8 / 0xFA / 0xFC system real-time messages, derive stable BPM via 48-sample rolling average over 24 PPQN pulses. When FL Studio (or any external transport) sends Master Sync, `u_bpm` locks to the sequencer; tap-tempo remains the fallback when no clock is present.
- `u_bpm` exposed in `shader-layer` uniform contract so custom shader effects can build beat-aligned modulation.
- `docs/FL-STUDIO-SETUP.md` — end-to-end integration guide covering three parallel channels (MIDI CC for params, MIDI Clock for sync, audio loopback for FFT) with per-OS instructions (Windows loopMIDI + VB-Audio CABLE, macOS IAC + BlackHole, Linux ALSA virmidi + PulseAudio null-sink), Patcher template idea, latency budget, and recording strategies.
- `docs/DJ-SETUP.md` — companion integration guide for DJ software. Per-app sections for algoriddim djay Pro (default CC map verified), Native Instruments Traktor (TSI mapping + Beat Phase CC trick), Mixxx (native OSC path through `osc-bridge`), Pioneer rekordbox (limited MIDI; audio-loopback fallback), Serato DJ Pro (Suite-only MIDI Out, fallback notes). Beatgrid-locked cue advance recipe, per-deck FFT routing pattern (deferred to v0.3), FX-bus-only reactivity recipe.
- **Audio source picker** — `listAudioInputs()` enumerates `audioinput` devices via `mediaDevices.enumerateDevices()`. The topbar dropdown appears once permission has been granted (browsers withhold device labels pre-permission) and lets the operator swap between mic / loopback (BlackHole, VB-CABLE, PulseAudio monitor) without a page reload. Choice persists in `state.audio.deviceId` (schema v6).
- **DJ mode crossfader morph** — first-class `djMode: { enabled, deckASnapId, deckBSnapId, value }` state field. Per-frame in-place lerp (`snapshots.djMorph`) of surface + layer opacity / z between two snapshot slots driven by `value` (0..1). Touch the crossfade slider + MIDI Learn → bind your DJ controller's crossfader CC. Cheaper than re-applying snapshots every frame; doesn't churn the autosave debounce.
- **MIDI note-on triggers** — notes 60..75 (C3..D#4) auto-recall snapshot slots 1..16 with no Learn step required. Explicit note bindings supported via `kind: 'note'` + `action: { type: 'snapshot.recall' | 'cue.next' | 'cue.previous' | 'cue.goto', payload }`. Dispatcher hooks routed from the editor (`recallSnapshot`, `cueNext`, `cuePrev`).
- **algoriddim djay preset** — `presets/dj-algoriddim.json` defines a default CC map matching djay Pro 5 with "Send Mixer Controls" enabled (crossfader CC 8 → `/djMode/value`, per-deck volume → surface opacity, EQ low → grade intensity, FX wet → layer opacity). One-click "apply djay preset" button injects the bindings.

### Schema

- **v5 → v6** — adds `state.audio.deviceId` and `state.djMode`. Old projects migrate cleanly (both fields default to null / disabled).

## [0.1.0] — 2026-05-18

Initial public release. Full Pro-v1 feature set per the M0–M5 build plan.

### Added

- **Surfaces**
  - Quad mode with 4-corner perspective warp (Heckbert closed-form homography, perspective-correct interpolation via `gl_Position.w = q.z` — no diagonal pinch, no tessellation).
  - Mesh mode with NxM Catmull-Rom bicubic interpolation, ε-pushback @ 0.04 normalized to prevent UV-singularity at coincident control points (Spike E verdict).
  - Per-surface opacity, z-order, blend mode, visibility, 3D LUT grade.
- **Layer types**
  - Video (file → SHA-hashed IndexedDB → texture)
  - Image (file → ImageBitmap → texture)
  - Solid color (1×1 uniform color texture)
  - Webcam (`getUserMedia` → MediaStream → texture)
  - Shader (6 starter effects: FBM domain-warp, FFT bars, kaleidoscope, VHS, plasma, raymarched SDF)
  - Hydra-synth (paste-in livecoding, sampled per-frame via texSubImage2D)
- **Keying** — luma BT.709, YCbCr-BT.709 chroma distance, OBS-style channel-clamp despill. Per-layer config; applied inline in the compositor's `above` sample.
- **Compositor** — per-surface FBO ping-pong with 10 W3C Blend modes (normal, multiply, screen, overlay, soft-light, color-dodge, linear-burn, difference, add, exclusion) as a branchless GLSL switch.
- **3D LUT** — Adobe .cube parser, 2D-tiled texture builder, trilinear sampling shader (WebGL1-compatible). Per-surface post-comp pre-warp pass.
- **Audio FFT** — `AnalyserNode` → bass/mid/high envelopes, full-spectrum env, beat onset, 1D R8 FFT texture. Available to shader effects as uniforms.
- **Snapshots + Cues** — 16 snapshot slots (full state copies), cue list with per-cue crossfade duration. Numeric leaves lerp; structural changes snap at midpoint. Verified mathematically: 500ms into a 2s lerp from `(0.6, 0.6)` → `(0.85, 0.15)` reads `(0.662, 0.488)`.
- **WebMIDI + Learn** — CC bindings persisted in project. Touch a param, click learn, twist the knob.
- **OSC** — over-WebSocket bridge (`osc-bridge/server.mjs`, Node helper, 127.0.0.1-only default). Browser-side WS client with the same Learn flow as MIDI.
- **Recording** — red record button captures the editor canvas via `canvas.captureStream()` + `MediaRecorder` to WebM/VP9.
- **Tap-tempo** — spacebar tap, rolling-average BPM display in topbar.
- **Project persistence** — JSON via localStorage with debounced 500ms autosave, IndexedDB for video/image/LUT blobs, JSON export/import, schema migration from v0 through v5.
- **Editor / Output tab split** — BroadcastChannel sync, output tab is the clean projector feed. Open output, drag to second display, fullscreen with `F`.
- **Browser compatibility page** at `compat.html` — verifies WebGL2, IndexedDB, BroadcastChannel, Fullscreen, MediaRecorder, getUserMedia + checks stretch features (WebGPU, WebMIDI, WebCodecs, HEVC, VP9-alpha, captureStream).

### Architecture

- regl (WebGL2 / WebGL1 fallback) via ESM importmap from esm.sh. No bundler.
- ESM module structure: `src/{core, project, storage, sync, surface, layers, render, keyer, audio, grade, input, io, output, ui}/`.

### Known limitations

- **ML matting (RVM via ONNX Runtime Web + WebGPU)** — code path designed in Spike C; full integration deferred to a post-v0.1.0 release.
- **Per-surface recording** — current recorder targets the whole editor canvas. Per-surface OffscreenCanvas recording requires pipeline changes; deferred.
- **Ableton Link** — needs a native sidecar; tap-tempo covers the practical case.
- **Hydra's canvas must stay composited** for `texSubImage2D` to return valid frames — visible at small scale in the editor corner. Cosmetic tradeoff, not a bug.
- **Dev iteration caching**: Python's `http.server` sends no cache headers. After editing a module, hard-reload with `?bust=N` query string or use DevTools "Disable cache" toggle.

### Provenance

Designed with significant AI collaboration under human direction. The architectural decisions, milestone plan, and code were drafted collaboratively over multiple sessions in 2026-05. Spike-driven validation against real Chromium hardware (ARM Mali-G925 / 16GB Chromebook) preceded each milestone commit. Released by 4P0LYTR0S1S collective under AGPL-3.0-or-later.

[0.2.0]: https://codeberg.org/4P0LYTR0S1S/r0n1n-mapper/releases/tag/v0.2.0
[0.1.0]: https://codeberg.org/4P0LYTR0S1S/r0n1n-mapper/releases/tag/v0.1.0
