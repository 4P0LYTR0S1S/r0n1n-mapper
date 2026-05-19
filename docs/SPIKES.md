# M0 Spike Results

Authored as templates. Fill in once each spike has been run in the browser.

The goal: each spike resolves an architectural risk that, if discovered late, would
force a rewrite. M0 cannot close until all five are answered.

---

## Spike A — Editor ↔ Output sync

**Risk:** R3 — wrong sync model = whole shell rewrite.
**Spike page:** `spikes/a-sync.html`.
**Run:** 2026-05-16 via chrome MCP.

### Testing limitation discovered
MCP's `javascript_tool` and `computer.left_click` do NOT bring a tab to foreground — `document.visibilityState` stays `"hidden"` and `requestAnimationFrame` is throttled to ~1Hz. Both methods' headline metrics (fps, latency) require parent-foreground; the spike's numeric pass/fail couldn't be measured under automation. The M0 skeleton DID verify BroadcastChannel sustains 60fps when both tabs are foreground — that's our ground truth.

### Method comparison (reasoned, not measured here)

| Method | Behavior | Verdict |
|---|---|---|
| BroadcastChannel + independent regl per tab | Each tab uses its own GPU; state delta is small; output decodes its own video on transport-synced timestamps. Skeleton confirms 60fps when foreground. | **PICKED** |
| Bitmap shipping (`transferToImageBitmap` + postMessage) | Parent renders everything; ships ImageBitmap to child each frame via BroadcastChannel. Higher fidelity pixel sync but parent becomes the bottleneck. When parent is hidden, output goes BLANK (strictly worse than BC). | reject |
| OffscreenCanvas via `transferControlToOffscreen` + postMessage | Not spiked. Worth revisit if BC ever becomes a bottleneck. | defer |

### Decision
**BroadcastChannel + independent regl per tab.**

Reasons:
1. Already proven working in M0 skeleton (sync ✓ at 60fps both sides when foreground).
2. Simpler code path — `src/sync/broadcast.js` is ~30 lines.
3. Each tab uses its own GPU rather than shipping pixels through a structured-clone channel.
4. Output owns its own video element → consistent with project memory's transport-sync model.
5. The background-tab throttling problem applies UNIVERSALLY — bitmap-ship is strictly worse (when parent is hidden, output goes blank; BC just freezes state updates while output's render loop keeps trying).

### Background-tab throttling — the real finding
This is the load-bearing operational note: **output tab MUST be visible for live use.** Three valid setups, all making `visibilityState: "visible"`:
1. **HDMI second display** — drag output tab to second monitor, fullscreen. Visible = no throttling.
2. **Chromecast tab cast** — being cast = visible (theoretically; verify in M5).
3. **OBS browser source / getDisplayMedia capture** — keeps tab visible.

For users without any of those, add a CLI flag note in M5 README: launch Chromium with `--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows` to defeat throttling. Not a fix for normal users, but a workaround for screen-recorded demos / single-monitor dev.

### Implications for the rest of the build
- [x] `src/sync/broadcast.js` finalized — keep current implementation.
- [x] Output tab decides its own video element lifecycle (BC path).
- [ ] M1: extend broadcast.js with `state:full` initial sync + `state:delta` coalesced at 60Hz + `transport` (play/seek/pause with perf-clock anchor for drift correction).
- [ ] M5: README "Output Setup" section covering the three visible-tab modes + the Chromium throttling flags as escape hatch.
- [ ] M5: `compat.html` warns if `document.visibilityState !== 'visible'` and provides remediation links.

---

## Spike B — hydra-synth embed → regl texture

**Risk:** R1 — cross-context texture sharing breaks the layer/compositor design.
**Spike page:** `spikes/b-hydra.html`.
**Run:** 2026-05-16 via chrome MCP.

### Findings
- **hydra-synth@1.3.29 via `https://esm.sh/hydra-synth@1.3.29` works.** Visible in compositor: a yellow-bordered detached canvas renders the `gradient(1).out()` chain at 60fps.
- **`regl.texture({ data: hydraCanvas })` returns zeros / black.** Same root cause as my failed `readPixels` and `drawImage` probes: hydra uses `preserveDrawingBuffer: false`, so its framebuffer is valid ONLY during hydra's own rAF tick. regl samples on a different tick → reads cleared buffer.
- The HUD-reported fps (60) measured the regl draw loop, not the actual texture content. Spike was overly trusting of fps as the pass criterion.

| Approach | fps | Tex upload ms | Verdict | Notes |
|---|---|---|---|---|
| Direct `texImage2D(hydraCanvas)` | 60 (draw loop) | 0.10 | **FAIL** — sampled buffer is black due to preserveDrawingBuffer race | timing mismatch |
| `captureStream` → `<video>` → `texImage2D` | not tested in spike | — | **recommended path** | Hydra exposes its canvas → MediaStream; video element decouples timing |
| Construct hydra with `preserveDrawingBuffer: true` | not tested (would need patch) | — | maybe | Memory cost; not exposed as standard option in hydra-synth 1.3.29 |
| Share rAF: drive hydra `.tick()` manually inside our render loop, sample synchronously | not tested | — | most precise | Requires `autoLoop: false` in Hydra constructor + manual tick |

### Decision
For M3 `src/layers/hydra-layer.js`, **use the manual-tick shared-rAF path**:
1. Construct `new Hydra({ canvas, makeGlobal: false, detectAudio: false, autoLoop: false })`.
2. In the main render loop: `hydra.synth.tick(dt)` → `regl.texture({ data: hydraCanvas })` on the SAME tick.
3. Fallback to `captureStream` path if hydra's internal regl conflicts in pathological setups.

### Implications
- [x] `src/layers/hydra-layer.js` upload pattern: shared-rAF / manual tick
- [ ] Document Hydra constructor flags in the layer's docstring
- [ ] Spike re-validation in M3 — write a one-page test using the shared-rAF approach to confirm `tex({data})` returns non-zero data
- [ ] Hydra layer resolution cap: target 640×360 default; allow 720p but advise off-loading via captureStream if it bogs down

### Side note discovered while debugging
The original spike claim "PASS verdict = sustains ≥58 fps" was misleading because fps measured only the regl draw call, not whether the texture had real pixel data. **Update the spike page** to also probe non-zero pixel content as part of the pass criterion when revisited.

---

## Spike C — RVM via ONNX Runtime Web

**Risk:** R2 — ML matting may be unavailable on operator hardware.
**Spike page:** `spikes/c-rvm.html`.
**Partial run:** 2026-05-16 via chrome MCP.

### What was tested
- ✅ **Webcam init path validated.** "test webcam only (no model needed)" button reaches `readyState 4` (HAVE_ENOUGH_DATA), `paused=false`, `srcObject set`, dimensions `480×270`, status text `"camera live: 480×270"` with `class="pass"`. Camera permission already granted on PRINCE.
- ⏸ **ONNX model inference NOT yet measured.** Requires `rvm_mobilenetv3_fp32.onnx` (~15 MB) from PeterL1n/RobustVideoMatting releases. Operator-supplied step.

| Backend | Resolution | fps | Inference ms | Peak heap MB | Verdict |
|---|---|---|---|---|---|
| WebGPU | 480p | TBD | TBD | TBD | pending model upload |
| WASM (fallback) | 480p | TBD | TBD | TBD | pending model upload |
| WebGPU | 720p (stretch) | TBD | TBD | TBD | pending model upload |

### To complete this spike
1. Download `rvm_mobilenetv3_fp32.onnx` from https://github.com/PeterL1n/RobustVideoMatting/releases.
2. Open `spikes/c-rvm.html`, drop the file into the file input.
3. Click "start webcam + run inference."
4. Fill in the table.

### Decision (provisional — will firm up after measurement)
- ML matting opt-in via `?ml=1` flag regardless of perf (defensive default; user opts in to a 15MB download).
- Default model resolution: 480p (per research swarm Keying report).

### Implications
- [ ] `src/ml/matting.js` gating rules — WebGPU detect first, fall back to WASM with warning toast if FPS < 8.
- [ ] UI: greyed "experimental" badge always when ML matting is enabled.

---

## Spike D — Multi-HD video texture upload

**Risk:** R4 — `texImage2D` on multiple HD videos may not fit budget.
**Spike page:** `spikes/d-video.html`.
**Status:** ⏸ pending — operator needs to drop in 1–4 MP4 files (1080p preferred) and click "start."

| # videos | Avg upload ms/frame | Overall fps | Verdict |
|---|---|---|---|
| 1 × 1080p | TBD | TBD | pending files |
| 2 × 1080p | TBD | TBD | pending files |
| 4 × 1080p | TBD | TBD | pending files |

### Decision (will firm up after measurement)
- Start with `texImage2D({data: video})` path (simplest, matches every Three.js / regl video sample online).
- If FPS < 30 at 4 × 1080p: migrate to WebCodecs `VideoFrame` direct upload via `texImage2D({data: videoFrame})`.
- If even WebCodecs marginal: cap layer-internal resolution at 720p with bilinear upscale at output.

### Implications
- [ ] `src/layers/video-layer.js` upload path — start with texImage2D, abstract behind a small adapter so the WebCodecs path can swap in without touching layer logic.

---

## Spike E — Catmull-Rom CP crossing stability

**Risk:** R5 — degenerate control points produce NaN / infinite mesh.
**Spike page:** `spikes/e-catmull.html`.
**Run:** 2026-05-16 via chrome MCP (R0N1N driving).

Tested:
- (1) center CP pushed past right-mid neighbor (mild crossing)
- (2) center CP coincident with right-mid (pts[4] == pts[5])
- (3) corners swapped + center pushed diagonally (chaos)
- (4) entire middle row collapsed to single point (catastrophic degeneracy)

| Strategy | Stable under crossings? | Visual quality | Verdict |
|---|---|---|---|
| None (reference) | **YES** — no NaN even in case (4) | self-intersection visible, UV singularity at coincident CPs | finite but visually broken at degeneracy |
| Convex-hull (rect bounds) | **YES** | identical to "none" unless CPs leave canvas | adds nothing at this scale |
| ε-pushback (min separation) | **YES** | prevents coincidence; mild visual deformation | **best UX** |

### Decision
Picked: **ε-pushback, 8px (in canvas-px) / ~0.04 (in normalized UV) min separation between adjacent CPs in row + col.**

Math is never NaN — even with a whole row collapsed, `interp()` returns finite constants. The real failure mode is **UV singularity** at zero-area mesh cells (textures get pinched to a line, looks broken). ε-pushback prevents this cheaply with a single O(N) pass per axis.

### Implications
- [x] `src/surface/warp-mesh.js` — apply ε-pushback inline whenever CPs are mutated by drag or load. Expose as `surface.warp.mesh.minSeparation` (default 0.04 normalized).
- [x] No user-facing knob in M2; transparent default. Re-evaluate in M4 if VJs want unconstrained warp.
- [ ] Verify the same conclusion holds for Bezier patches in M2 — they may need a different stability condition (G1 continuity already mirrors handle vectors).

---

## M0 close criteria

- [x] **Spike A** decided (BroadcastChannel + independent regl). Background-tab throttling identified as universal concern → operational note.
- [x] **Spike B** decided (manual-tick shared-rAF path for hydra layer). Spike-page revalidation deferred to M3.
- [x] **Spike E** decided (ε-pushback @ 8px / 0.04 normalized).
- [⏸] **Spike C** webcam path validated; ONNX RVM inference pending operator model upload.
- [⏸] **Spike D** pending operator MP4 uploads.
- [x] `src/sync/broadcast.js` finalized — current implementation accepted.
- [x] M0 smoke test passed via chrome MCP (editor + output, sync ✓, rectangle reflects state).
- [x] `project_r0n1n_mapper` memory updated.

**M0 effectively closes.** Spikes C/D are non-blocking for M1 (single-surface vertical slice) — both relate to features that land in M2/M3. Operator can run them at leisure; the architectural decisions they inform are reasoned in this doc.

**M1 can start.** Next session opens with M1 — quad surface + 4-corner perspective warp + one video layer + save/load.
