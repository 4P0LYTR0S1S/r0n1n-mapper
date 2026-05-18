# Changelog

All notable changes to r0n1n-mapper. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/) with calver-style date stamps for pre-1.0 milestones.

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

[0.1.0]: https://codeberg.org/4P0LYTR0S1S/r0n1n-mapper/releases/tag/v0.1.0
