# Changelog

All notable changes to r0n1n-mapper. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is [SemVer](https://semver.org/) with calver-style date stamps for pre-1.0 milestones.

## Roadmap

Forward-looking, subject to change. Order reflects current build sequence — each milestone unlocks the next.

- **v0.6.1 — Cheap-wow shader pack.** Six trivial-complexity fragment-shader effects building on v0.6.0's onset/phrase clock: feedback FBO retention (foundational), kaleidoscope, shockwave ripple, ASCII/halftone post-pass, RGB channel shift on onset, scanline tear. Plus global strobe-on-snare and invert-on-drop hooks.
- **v0.7.0 — Datamosh lookalike glitch stack.** Medium-complexity glitch effects layered on v0.6.1's feedback FBO + v0.6.0's onset: block displacement (8×8/16×16 macroblock jitter), motion-vector smear (the closest-to-real-datamosh signature), pseudo pixel-sort, DCT-block noise injection, hybrid datamosh shader. True WebCodecs P-frame datamoshing deferred to v0.8+ pending wider browser support — bitstream surgery has too much tail risk for live use.
- **v0.7.x or v0.8.0 — Triple-output A/B/C surface routing.** Per-surface `outputTarget: 'A'|'B'|'C'|'all'` field; each output tab parses ID from URL hash (`output.html#A`) and filters surfaces. Multi-projector tiled-coverage rigs from one device. Mirror-mode + per-output recording fall out for free. Hardware caveat: 3× 1080p will thermal-throttle ARM iGPUs; recommend 720p × 3 for sustained use.
- **Deferred to post-v0.8** (high-effort, high-wow): reaction-diffusion, stable-fluids, curl-noise particles, slit-scan time-warp, raymarched fractal tunnel, voxel-wall FFT skyline.

## [Unreleased — v1.x candidate] — Native vdo.ninja WebRTC viewer (DEFERRED)

Operator floated this as "be cool to..." territory. After scoping: a real
native viewer needs WebRTC signaling against vdo.ninja's custom WSS protocol,
TURN fallback, codec negotiation, reconnect logic, and ongoing maintenance
as their protocol evolves. Estimated 3-5 days build + ongoing burden.

**The OBS Virtual Camera pipe** (vdo.ninja → OBS Browser Source → OBS Virtual
Camera → r0n1n-mapper webcam picker) delivers the same functional outcome
with **zero r0n1n-mapper code** and **full vdo.ninja feature compatibility**.
Trade-off: one extra app in the chain (OBS), ~110-280ms end-to-end latency.

Comprehensive workflow doc shipped at `docs/VDO_NINJA_WORKFLOW.md`. Revisit
native integration only if operator finds the OBS hop genuinely annoying
during live use.

## [0.9.0] — 2026-05-25

**Beat-Locked Timeline (Lite) — MARQUEE.** Schedule snapshots by bar position, not seconds. Cursor advances at the BPM clock from the analyser; snapshots auto-apply as the cursor crosses their bar position. Loop region with phrase-aligned boundaries (4/8/16/32 bar) lets a single configured set run forever. The foundational architecture for music-first VJ work — the rest of v0.9.x and v1.0 expand from here.

### Added

- **`src/timeline/timeline.js`** — engine. Exports `createTimelineEngine({getState, getAudioTime, getBpm, getSnapshot, applySnapshot})`, `emptyTimeline()`, `emptyEvent(id, snapshotId, bar)`, `timeToBar(seconds, bpm)`.
- **`state.timeline`** — `{ events: [{id, snapshotId, bar}], playing, currentBar, anchorAudioTime, anchorBar, loopStart, loopEnd, loopEnabled }`.
- **Transport controls** in the editor sidebar — play ▶ / pause ‖ / stop ■ buttons + live cursor display (`bar 3.75 / 16 ▶`).
- **Loop region inputs** — enable toggle + from/to bar inputs. Default `0..16` (4-phrase 4-bar loop). Cursor wraps at `loopEnd` back to `loopStart`; on wrap, events at start replay correctly (lastBar tracker resets).
- **Event scheduling UI** — snapshot picker + bar number input + `+ at` button. Events render in a sorted list with a `×` delete control.
- **Auto-anchor on play** — when `play()` is called, the engine snaps `anchorAudioTime` to "now" and `anchorBar` to the current cursor position so playback resumes smoothly from any seek.

### Changed

- **Schema bumped v9 → v10.** Migration adds empty `state.timeline` with default loop region `0..16`, `loopEnabled: true`.
- **Editor frame loop calls `timelineEngine.tick()` every frame** after `applyMods` — modulation values are settled first, then timeline-triggered snapshot applies fire (so cued snapshot state overrides any base values from drag-while-modulating detection).

### Architectural notes

- **Tempo-locked playback requires a live BPM.** When BPM is 0 (no audio engaged, no MIDI clock, no tap-tempo set), `tick()` early-returns without advancing. Operator must engage audio + tap tempo (spacebar) OR receive MIDI Clock for the timeline to play.
- **Event-fire tolerance is ±0.05 bars** (~75ms at 120 BPM 4/4). At 60 FPS the cursor advances ~0.008 bars/frame at 120 BPM, so any event between two frames is reliably caught by the lastBar/newBar crossing check.
- **Deferred to v0.9.x / v1.0**: visual horizontal timeline lane (SVG with event markers + draggable cursor), drag-to-place events (click on lane to set bar), drag-to-resize event duration (for fade-cue timing), automation envelopes (continuous param curves, not just discrete snapshot triggers), multiple lanes per param, snap-to-grid quantization options, undo/redo, copy/paste regions, BPM-derived swing/shuffle. The current Lite UI is text-list-based which is functional for set programming but lacks the at-a-glance visual scrub of a proper DAW timeline.

## [0.8.0] — 2026-05-25

**Mod Matrix Lite — every slider becomes a reactive surface.** Operator can now bind any continuous parameter (layer opacity, dancer audioIntensity, shader-effect params, surface opacity, etc.) to a modulation source: one of 5 BPM-synced LFOs or one of 16 audio sources (5-band split + peak hold + onset + dropFlag + phrase clocks + legacy bands). Per-frame dispatcher writes `base + (source × depth)` into the bound param. Lite scope ships the foundation — Full Matrix (per-slider M button, mod stacking, more wave shapes) deferred to v0.8.x.

### Added

- **5 LFO sources** (`lfo:0` through `lfo:4`) with default config: sin @ 1/4, tri @ 1/2, saw @ 1bar, sqr @ 1/8, S+H @ 1/4. Per-LFO controls: wave shape (sin/tri/saw/sqr/sh), rate (BPM-synced 1/16 → 8bar), phase offset (0..1).
- **16 audio sources** matching v0.6.0's analyser output: `audio:sub`, `audio:kick`, `audio:lowMid`, `audio:highMid`, `audio:air`, `audio:env`, `audio:peakKick`, `audio:peakAir`, `audio:onset`, `audio:dropFlag`, `audio:phrasePos`, `audio:barMod16`, `audio:beatMod4` (the last three normalized to 0..1 for predictable depth scaling), plus legacy `audio:bass`/`audio:mid`/`audio:high`.
- **Per-binding fields**: `paramPath` (JSON-pointer-like string, e.g. `layers[2].audioIntensity`), `source`, `depth` (-2..2), `polarity` (`uni` = 0..depth, `bi` = -depth..depth), `enabled`, `baseValue` (captured at bind time, updated on operator drag).
- **`src/mod/dispatcher.js`** — new module exporting `applyMods(state, audio)`, `evaluateSource`, `resolveParamPath`, `captureBaseValue`, `emptyMod`, `emptyLfos`. Per-frame dispatcher runs on both editor + output tabs (each tab evaluates locally at its own framerate — no broadcast spam).
- **"modulators" sidebar section** with collapsible LFO config + bindings list + add-binding form. Each binding shows enable toggle, source picker, depth slider, polarity selector, delete button. New-binding form: param-path text input + source dropdown + add button.
- **Operator-drag-while-modulating detection** — if the bound param's current value differs from what the dispatcher last wrote (float-tolerance 0.0001), assume the operator just dragged the slider and update `baseValue` accordingly. Modulation moves with the new base instead of fighting the operator.

### Changed

- **Schema bumped v8 → v9.** Migration adds empty `state.mods: []` + default `state.lfos` (5 LFOs from `emptyLfos()`). Old saved projects gain modulation infrastructure with zero behavior change.
- **Both editor + output frame loops call `applyMods` before render.** Mutation is direct (bypasses store-emit pipeline since the store doesn't proxy nested object writes), so no broadcast or autosave storm at 60Hz. Cross-tab consistency relies on each tab using `baseValue` as the additive anchor — even after state:full sync replays a modulated snapshot, the next frame's `applyMods` overwrites with `baseValue + freshSource × depth`.

### Architectural notes

- **State churn at 60Hz is intentional and harmless** — only the *value* of layer.opacity etc. changes, not the store-emit pipeline. Autosave + broadcast only fire on explicit store mutations (add binding, edit binding, etc.), not on per-frame modulation.
- **Deferred to v0.8.x (Full Matrix)**: per-slider "M" button for in-place binding, right-click quick menu, mod stacking (multiple sources adding into one param), modulation curves (lin/log/exp/step), output range remap, MIDI CC as first-class mod source (currently CC routes via the separate MIDI Learn dispatcher).

## [0.7.1] — 2026-05-25

**Triple-output A/B/C surface routing.** Multi-projector rigs from one device. Each output tab parses its ID from the URL hash and renders only surfaces routed to it (or to `all`). BroadcastChannel is already multi-consumer so no relay or new transport is needed.

### Added

- **`surface.outputTarget: 'all' | 'A' | 'B' | 'C'`** field per surface. Default `'all'` (renders on every output tab — preserves single-output behavior). `A`/`B`/`C` routes the surface only to the corresponding output tab.
- **URL-hash output ID parsing in `main-output.js`**. `output.html#A` → `MY_OUTPUT_ID = 'A'`. No hash → `'all'` (renders everything, single-output flow unchanged). Document title becomes `Ronin Projection Mapper — output A` so operator can identify tabs in their taskbar.
- **Per-surface output dropdown** in the surface-props panel — `all outputs` / `output A` / `output B` / `output C`.
- **Three new `+ A` / `+ B` / `+ C` buttons** in the editor topbar next to `open output`. Each opens `output.html#<id>` in a new tab.
- **HUD output-id indicator** on the output canvas — shows `all` for default or `→ A` etc. for routed outputs. Set via URL hash, not editable on the output tab.

### Changed

- **Schema bumped v7 → v8**. Migration backfills `outputTarget: 'all'` on every existing surface so old saved projects keep rendering on the default output identically.
- **`main-output.js` frame loop** filters `state.surfaces` by `outputTarget` before calling `pipeline.render`. Layer runtimes themselves stay shared across all output instances — they're effectively a global render-resource pool.

### Hardware caveat

The Lenovo Chromebook Plus 14 ARM iGPU will thermal-throttle running three 1080p output tabs simultaneously. Practical recommendation: **720p × 3 for sustained use, 1080p × 3 for short bursts.** Mirror-mode use cases (3× same hash = redundant output for OBS-capture-while-projecting) cost roughly the same as a single high-res output since the same surface renders three times — operator should monitor thermals and frame rate.

### Bonus side effects

- **Mirror mode for free** — open three tabs all at `#A` (or all at default) and you get three independent canvases rendering the same content. Useful for OBS-capture-while-projecting, redundant outputs, or projector-plus-monitor previews.
- **Per-output recording for free** — the existing `r` key on each output tab triggers its own MediaRecorder, so multi-projector rigs can record each projector's output to a separate webm.
- **Per-output audio engagement for free** — each tab has its own `a` key audio toggle, so three outputs can either share one mic or each subscribe to a different audio source.

## [0.7.0] — 2026-05-25

**Datamosh-lookalike glitch stack + post-effect architecture.** New `+ post-fx` layer type processes the surface accumulator (everything composited below in z-order) through a shader, rather than generating its own content. Six glitch effects on launch — every one of them an audio-reactive in-shader version of techniques that traditionally need WebCodecs bitstream surgery (3-week build, Chrome-only, fragile under seek/loop). Lookalike pack ships in ~1 day/effect and works on any browser regl supports.

### Added

- **New layer type `post-shader`** (sentinel: `runtime.isPostEffect === true`). Compositor detects the flag and routes the accumulator through `runtime.apply(srcTex, dstFbo, w, h)` instead of doing a normal blend pass. Stack multiple post-fx layers on a surface for layered glitch (e.g. `rgb-shift` + `scanline-tear` + `block-displace` over a video).
- **`+ post-fx` button + effect dropdown** in the editor topbar layer-add row. Effects populate from `POST_EFFECT_NAMES`; selecting a new effect re-initializes params to that effect's defaults.
- **Six post-effect shaders** (`src/layers/shader-effects-post.js`):
  - **`rgb-shift`** — three-channel chromatic aberration. Base offset + onset multiplier + dropFlag spike. The "VHS tracking issue" classic.
  - **`scanline-tear`** — per-row hash-driven horizontal UV offset. Sparse rows torn by threshold gate; density and amplitude both pump on `u_onset`. Broken-signal aesthetic.
  - **`block-displace`** — quantizes UVs to N×N grid, hashes each block → per-block UV offset. The macroblock-corruption signature look. Onset spikes amplitude; kick quantizes time-stepping so blocks "tick" on the beat.
  - **`ascii`** — quantizes source brightness to procedural SDF characters (·, +, *, #) per cell. Cell size pumps on kick; contrast on onset; drop boosts contrast harder. Instant printed/terminal aesthetic identity.
  - **`pixel-sort`** — per-row brightest-pixel propagation (single-pass approximation). Smear length scales with onset; threshold gates which pixels can "win" and propagate. Streaky/melty smear that beats musically.
  - **`mv-smear`** — motion-vector smear (the datamosh hybrid). Combines feedback-style frame retention with block displacement: holds the previous frame, displaces it block-wise, mixes in the new frame at low alpha. Closest perceptual match to true datamosh — frozen frame with drifting macroblocks. Uses internal ping-pong + pass-through copy to maintain `u_prev`.
- **`POST_EFFECTS` registry** with per-effect `defaultParams`, `schema`, and optional `feedback: true` flag. Mirror shape of generator `EFFECTS` registry so editor UI code stays uniform.
- **Per-layer panel `buildPostShaderControls`** — effect picker, Audio Reactivity slider, dynamic param controls from schema, footer note explaining post-fx-affects-layers-below semantics.

### Changed

- **`src/render/compositor.js`** — compositor pass now branches on `runtime.isPostEffect`. Non-effect layers blend normally; effect layers run `apply()` against the accumulator. Same ping-pong FBO architecture as before (the post-effect output becomes the new accumulator via the existing acc/next swap).

### Fixed

- **mv-smear TDZ bug caught + fixed during initial smoke.** `let copyDraw = null;` and `function copyToPrev` had been declared AFTER the `return {}` statement, making the function reachable (declarations hoist) but the `copyDraw` binding permanently in temporal dead zone. Moved both declarations BEFORE return; mv-smear now runs cleanly through the compositor pass.

### Architectural notes

- **WebCodecs true-datamoshing deferred to v0.8+.** Bitstream surgery (orphaning P-frames, lying about chunk type) is rejected by spec-compliant decoders per w3c/webcodecs#867. Estimated ~3 weeks build with high tail risk (codec variance, seek/loop break-on-keyframe-restart, MP4-only). The shader lookalike pack here delivers ~80% of the perceptual look at ~1 day/effect, works on any regl-compatible browser, and stacks composably.
- **Architecture is ready for v1.x post-effect expansion.** Any future post-effect (kaleidoscope-as-post, slit-scan-as-post, etc.) just needs a new entry in `POST_EFFECTS` — the layer type, runtime, compositor wiring, and UI are all in place.

## [0.6.1] — 2026-05-25

**Cheap-wow generator shader pack + feedback FBO infrastructure.** Four new fullscreen shader effects in `+ shader`, plus the foundational ping-pong FBO architecture in `shader-layer.js` that unlocks every "this frame depends on the last frame" shader from here on (trails, smear, shockwave, motion vectors, datamosh lookalikes). All four effects consume v0.6.0's new audio uniforms — onset, beatMod4, barMod16, phrasePos, dropFlag — so they feel rhythmically musical instead of just band-pulsed.

### Added

- **`feedback-trails`** effect — pure frame retention with fade decay. Each tick, the previous frame is sampled with a slight zoom + rotation + fade (configurable `decay`/`zoom`/`rotate` params), then a new fbm pattern is drawn on top driven by audio bands. Builds standing-wave patterns + Droste tunnels automatically. Bass momentarily pushes decay toward 1.0 ("freeze the moment" on kicks). Onset injects sparkles via `u_air`. Foundation effect: every other feedback-capable shader in v0.7.0+ leans on this same ping-pong pattern.
- **`shockwave`** effect — concentric rings radiating from center. Three ring sources combined: phase-clock ring (always expanding), beat-aligned ring (snaps on each beat), and drop ring (triggered by `u_dropFlag`, big and slow). Onset triggers a brief full-screen flash. The most legible beat-sync effect we've shipped — reads as direct cause-and-effect with the music.
- **`truchet`** effect — wall of randomly-rotated arc tiles forming continuous curves and mazes. Line thickness pulses on kick + onset; line color hue rotates per bar (driven by `u_barMod16`); drop inverts the color palette. Mathematically pristine, infinite without seams, projection-map-friendly on rectangular surfaces.
- **`voronoi`** effect — plane fractures into cellular shards. Cells jitter outward on each `u_onset`, edge brightness pulses with kick, palette shifts every 2 bars via `u_phrasePos`. Glass-breaking read; cells let you map any source per-cell down the road.
- **`hash22(vec2)`** helper added to the shared `NOISE` GLSL preamble so any future shader can use 2D vector hashes without inlining the definition.

### Changed

- **`shader-layer.js` now supports feedback ping-pong**. Effects with `meta.feedback === true` in the registry get TWO color textures + framebuffers that alternate as render-target / sample-source each frame, plus a `u_prev` sampler2D uniform pointing at the previous frame's color. Single-buffer effects work identically to before (zero overhead for non-feedback shaders). Compositor reads the just-rendered pair via a getter on `layer.texture` so the swap is invisible upstream.
- **All shader effects now receive the full v0.6.0 audio uniform set**: legacy `u_bass`/`u_mid`/`u_high`/`u_env`/`u_beat`/`u_bpm` AND new `u_sub`/`u_kick`/`u_lowMid`/`u_highMid`/`u_air` AND peak-hold `u_peakKick`/`u_peakAir` AND rhythmic gates `u_onset`/`u_beatMod4`/`u_barMod16`/`u_phrasePos`/`u_dropFlag`. The COMMON GLSL preamble documents which uniforms come from which subsystem. Pre-v0.6.0 shaders continue to render identically (only the legacy uniforms are touched in their bodies).
- **Per-layer `audioIntensity` no longer scales rhythmic gates.** `u_onset`, `u_beatMod4`, `u_barMod16`, `u_phrasePos`, `u_dropFlag` are rhythmic structure — scaling them down doesn't make sense (you don't want "half an onset"). Band envelopes (`u_bass`/etc) still scale by audioIntensity as before.

## [0.6.0] — 2026-05-24

**VJ-grade audio pipeline upgrade + title reveal fix.** The audio analyser becomes a real VJ-grade signal-extraction layer — five musically-tuned bands, asymmetric attack/release envelope follower, spectral-flux onset detection, a musical phrase clock, and a drop detector heuristic — without breaking any existing shader. Every audio-reactive layer (dancer, title, shader effects) immediately feels snappier under the new envelope, with the new uniforms available to upcoming glitch / triggering effects. Also bundles a fix for the title-layer reveal animation that only played once on layer attach.

### Added

- **5-band audio split** tuned for EDM/DnB content: `sub` (20-60 Hz, weight), `kick` (60-120 Hz, the thump), `lowMid` (120-500 Hz, bass body), `highMid` (2-4 kHz, snare/clap/vocal presence), `air` (8-16 kHz, hi-hat/cymbal sparkle). Bands are deliberately not contiguous — the gaps cover less musically distinct ranges.
- **Asymmetric attack/release envelope per band** — replaces the old pure-exponential decay with `fast attack ≈ 0.6, slow release ≈ 0.05`. Kicks now HIT and sag instead of pulsing as a glow, which is the difference between "lighting reacts to music" and "lighting feels musical."
- **Per-band peak-hold with slow decay** (`peakSub`, `peakKick`, `peakLowMid`, `peakHighMid`, `peakAir`). Useful for freeze-on-bright effects that want to retain the most recent transient color/intensity.
- **Spectral-flux onset detection.** `flux = Σ max(0, fft[t][i] - fft[t-1][i])` thresholded against rolling mean + 1.5·stddev with a 70 ms refractory. Cleaner than bass-spike beat detection — picks snares, claps, and any transient, not just kicks. New uniform: `onset` (1 for one frame on each transient).
- **Musical phrase clock** anchored on first valid BPM (or re-anchored when BPM shifts >1): `beatMod4` (0..4 continuous, floor = beat-in-bar), `barMod16` (0..16 continuous, floor = bar-in-phrase), `phrasePos` (0..1 ramp inside an 8-bar phrase). Unlocks "only every 4th beat", "hue rotates per bar", "blur ramps with phrase", and similar phrase-aware gating downstream.
- **Drop detector** — 5-second RMS-history heuristic firing `dropFlag` (held for 800 ms) when sustained build (3s..0.8s ago `> 0.25`) is followed by a dip (0.8s..0.3s ago `< build × 0.3`) followed by an onset-driven reattack. 2-second cooldown between drops.
- **`window.__r0n1n_audio` exposure on the output tab** (already present on the editor) for DevTools inspection of the new uniforms during live performance.

### Fixed

- **Title layer reveal animation only played once on attach.** The `startTime` anchor was set at `attachTitle` time and never reset, so subsequent text/font/reveal-mode edits showed the reveal as already complete. The reveal clock now resets on any bake-signature change (text/font/fontSize) or `revealMode` switch, so editing the text mid-set re-plays the reveal naturally.

### Changed

- **Existing `bass` / `mid` / `high` uniforms now feel snappier.** Same band definitions (BT.709-ish 40-250 / 250-2k / 2k-8k Hz) and same per-frame API, but they now pass through the asymmetric envelope instead of pure decay. Existing dancer / title / shader-effect layers automatically inherit the punchier feel without any per-layer changes.
- **Backward compatibility preserved.** `bass`, `mid`, `high`, `env`, `beat`, `bpm`, `fftBins`, `time` remain in the returned uniforms object with their established semantics. Shaders written pre-v0.6.0 continue to render identically (modulo the deliberate envelope-feel change). New uniforms are additive.

## [0.5.0] — 2026-05-23

**Complex body + procedural sample.** The dancer-img layer gains a 14-part anatomical rig (head, torso, upper arm / forearm / hand × 2, thigh / shin / foot × 2) where each segment is its own uploaded sprite — no bend-math compromise, each piece rotates around its own joint anchor. A `✦ generate sample` button procedurally draws a stylized neon cyberpunk body to IDB so the rig comes alive immediately without uploads. The simple 6-part path remains as default; complex mode is an opt-in toggle.

### Added

- **`layer.complexBody`** boolean toggle on the dancer-img layer (default `false`). When `true`, the layer renders 14 anatomical segments instead of 6; the v2 bend-limbs toggle becomes a no-op (each segment is already its own image).
- **8 new part keys** on the dancer-img layer schema: `upperArmL`, `forearmL`, `handL`, `upperArmR`, `forearmR`, `handR`, `thighL`, `shinL`, `footL`, `thighR`, `shinR`, `footR`. Hands + feet render as static-anchor sprites at wrist/ankle joints; upper limbs + forearms + thighs + shins render as rotating segments between adjacent joints.
- **`layer.widthHand`** + **`layer.widthFoot`** for the static-anchor sprites (defaults 0.045 / 0.05 relative to canvas).
- **`generateSampleBody(layer, mode)`** — exported procedural body generator. Renders each part to a 2D canvas with a cyan→magenta gradient + cyan outline + anatomy hints (eye dots, finger ridges, foot taper), saves as PNG to IndexedDB, and binds the resulting `imageId` to the corresponding part. Won't clobber user-uploaded parts. Triggered from the layer panel's `✦ generate sample` button.
- **UI: collapsible part panels now scale to the active mode** — 6 panels in simple mode, 14 panels in complex mode. Mode toggle + sample button live at the top of the dancer-img controls; bend toggle hides in complex mode (irrelevant there).
- **`PART_KEYS_SIMPLE`** / **`PART_KEYS_COMPLEX`** / **`PART_KEYS_ALL`** exports from the layer module. `PART_KEYS` (legacy alias) still resolves to the simple set for back-compat.

### Fixed

- **`ingestPartImage` was nuking per-part overrides** — replacing `layer.parts[partKey]` with a fresh `{ imageId, name }` object wiped any rotation / scale / offset / flip the user had tuned. Now preserves the existing per-part block and only swaps `imageId` + `name`.

### Changed

- **Texture-load on attach iterates `PART_KEYS_ALL`** (was `PART_KEYS`) so toggling complex mode mid-session immediately renders the right parts without a re-attach.
- **`emptyDancerImgLayer` initializes all 14+ part keys** (with `imageId: null` defaults). Old saved projects auto-fill missing keys via `fillPartDefaults` on attach.

## [0.4.2] — 2026-05-23

**Pure FOSS posture + groove pass.** Drops the commercial dual-license track from the project's public framing — r0n1n-mapper is now AGPL-3.0-or-later only, no commercial waiver, no proprietary path. Plus a sensitivity pass on the dancer's audio reactivity so the figure noticeably grooves to bass / mid / high / beat instead of merely swaying. UI string `audio intensity` renamed to `Audio Reactivity` everywhere it shows.

### Changed

- **License posture: AGPL-3.0-or-later only.** README, SECURITY.md, and ATTRIBUTIONS.md updated to drop all mentions of dual-licensing or commercial waiver. The license is now stated as unconditional: free for everyone (including paid use for individual artists, performers, small studios, festivals, etc.), share-back required for modifications and network deployments, no proprietary escape hatch. The "escape hatches that exist by design" preserved by AGPL itself (right to fork, redistribute, modify) are spelled out explicitly.
- **`audio intensity` → `Audio Reactivity`** in the per-layer panel labels (dancer-img, shader, title). Internal state field `audioIntensity` unchanged for backward compat with saved projects.

### Tuned

- **Dancer joint amplitudes doubled** in both `shader-effects.js` (SDF dancer) and `dancer-img-layer.js` (image dancer's `computeJoints`). The two paths stay in lockstep so SDF + image dancers move together.
  - hip bounce on bass: `0.045` → `0.090`
  - sin component of bounce: `0.018` → `0.035`
  - arm swing amplitude: `(0.35 + mid*1.0)` → `(0.55 + mid*1.8)`
  - elbow extension on swing: `0.4×` → `0.65×`
  - wrist sin wiggle: `0.02` → `0.045`
  - wrist jitter on highs: `0.012` → `0.025`
  - leg swing: `(0.20 + mid*0.4)` → `(0.35 + mid*0.8)`
  - knee bend on bass: `0.4×` → `0.8×`
  - knee horizontal travel: `scale*0.06` → `scale*0.12`
  - ankle jitter: `0.008` → `0.018`
- **Default `audioIntensity`** on new layers raised so the wiggle is immediate without slider tuning:
  - dancer-img: `1.0` → `1.5`
  - title: `1.4` → `1.8`

The figure now visibly squats on kicks, swings limbs to the mids, and jitters at the extremities on hi-hats — at default settings, with no slider tuning required.

## [0.4.1] — 2026-05-23

Dancer-img bent limbs. Each arm now renders as two rigid sprite segments (shoulder→elbow + elbow→wrist) instead of a single rigid stick from shoulder to wrist; legs likewise (hip→knee→ankle). Reads as "puppet with joints" instead of "puppet with bones." The upper segment samples the top half of the limb's source image; the lower segment samples the bottom half; both segments meet at the image's split row so the joint appears visually continuous. Default ON for new dancer-img layers; per-layer toggle preserves the v1 single-segment puppet aesthetic for users who prefer it.

### Added

- **`layer.bendLimbs`** (boolean, default `true`) on the dancer-img layer. Toggle in the layer panel: "bend limbs (split at elbow/knee)".
- **`part.splitV`** (0.2..0.8, default `0.5`) per-part slider for arms + legs only. Tunes where the elbow/knee is in your source image's vertical axis (raise if your image has a longer upper arm, lower for a longer forearm).
- **`u_uvMin` / `u_uvMax` uniforms** in the dancer-img vertex shader. Quad-local Y now maps to texture V across an arbitrary band `[uvMin..uvMax]` instead of always sampling the full `[0..1]` image. Single-segment layers (head + torso + v1 limbs) pass `[0, 1]` and behave identically to v0.4.0.
- **`flipY` band-aware mirroring** in the vertex shader — flipping within a partial UV band now mirrors only within that band, so per-segment flip on bent limbs works correctly.
- **`docs/DANCER_BODY_PARTS.md`** v2 section documenting bend mode, splitV tuning, and recommended image conventions for the two-segment layout.

### Changed

- Existing dancer-img layers loaded from earlier sessions auto-pick up bend mode (`fillPartDefaults` backfills `bendLimbs = true` on attach). If you preferred the v1 puppet look, toggle off in the layer panel.

### Performance

- Two draw calls per limb in bend mode (vs one in v1). Practical cost on 1080p: negligible — already running at 60fps with the full dancer + presets stack.

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
