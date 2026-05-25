# Ronin Projection Mapper

*r0n1n // mapper · by [4P0LYTR0S1S](https://apolytrosis.dev)*

Browser-native projection mapping. Custom MP4 / WebM uploads, real-time chroma + luma keying with despill, Catmull-Rom mesh warp, multi-layer compositor with 10 blend modes, snapshots + cued crossfades, WebMIDI + OSC, 3D LUT color grading, embedded Hydra livecoding, audio-reactive shader effects, DJ-mode crossfader morph, MIDI Clock auto-BPM. No install, no native binary, AGPL.

Built because **map.club**'s Canvas-2D architecture has a hard performance ceiling and can't custom-key VJ clips, and **MadMapper / Resolume / HeavyM** don't run on ChromeOS or arm64 Chromebooks.

### What's new since v0.5.0

- **VJ-grade audio pipeline** (v0.6.0) — 5-band split (sub/kick/lowMid/highMid/air), asymmetric attack/release envelope, spectral-flux onset detection, drop detector, BPM-locked phrase clock. Existing layers feel snappier on day one. Full uniform inventory in `CHANGELOG.md`.
- **Webcam device picker** (v0.6.0) — select any plugged camera per webcam layer. Unlocks the `vdo.ninja → OBS Virtual Camera → r0n1n-mapper` pipe out of the box (see `docs/VDO_NINJA_WORKFLOW.md`).
- **Cheap-wow shader pack** (v0.6.1) — `feedback-trails`, `shockwave`, `truchet`, `voronoi` generator effects. New ping-pong FBO architecture in `shader-layer.js` lets any future effect opt into `u_prev` (previous-frame texture) via `meta.feedback: true`.
- **Datamosh-lookalike post-effect stack** (v0.7.0) — NEW layer type `post-shader` operates on the surface accumulator (everything below in z-order). Six glitch shaders: `rgb-shift`, `scanline-tear`, `block-displace`, `ascii`, `pixel-sort`, `mv-smear`. Stack multiple for layered glitch.
- **Triple-output A/B/C surface routing** (v0.7.1) — per-surface `outputTarget` field, three new output tabs (`output.html#A` etc.) for multi-projector rigs. Single-tab flow unchanged. Free mirror-mode + per-output recording. Hardware caveat: ARM iGPU will thermal-throttle at 3× 1080p; 720p × 3 sustained.
- **Mod Matrix Lite** (v0.8.0) — bind any continuous parameter to one of 5 BPM-synced LFOs or 16 audio sources. Per-frame dispatcher writes `base + (source × depth)` into the bound param. Operator-drag-while-modulating detection so dragging a bound slider re-anchors the base.
- **Beat-Locked Timeline Lite** (v0.9.0, MARQUEE) — schedule snapshots by bar position. Playback follows the BPM clock; snapshots auto-apply as the cursor crosses their bar. Phrase-aligned loop region (4/8/16/32 bar). Music-first VJ workflow foundation.

---

## Installation

The editor is a static page — clone, serve, open.

```bash
git clone https://codeberg.org/4P0LYTR0S1S/r0n1n-mapper.git
cd r0n1n-mapper
python3 -m http.server 8765
# or: npx serve -l 8765
```

Open `http://localhost:8765/` in a Chromium-based browser. WebMIDI and the
audio FFT both require **localhost or HTTPS** to grant permission, so the
http.server invocation matters — opening the `index.html` file directly
(`file://`) won't work.

The optional OSC bridge is a tiny Node helper:

```bash
cd osc-bridge
npm install
npm start
```

Default bind: `127.0.0.1:9000` (OSC ingress) ↔ `127.0.0.1:8787` (WS to browser).

Verify your browser before doing anything else: `http://localhost:8765/compat.html`.

## Quick Start

1. **Drop a video** (mp4 or webm) onto the editor window. A surface auto-appears with the video as its only layer.
2. **Drag the 4 corners** to map the surface to your projection target. Math is perspective-correct — no diagonal pinch.
3. **Switch to mesh mode** in the surface panel for curved/irregular surfaces. 5×4 Catmull-Rom grid by default; drag any control point.
4. **Stack layers** — `+ image`, `+ color`, `+ webcam`, `+ shader` (with effect picker), `+ hydra`. Each layer has its own opacity + blend mode in the layer stack.
5. **Key the video** — in the layer's key panel, pick `luma` for black-background clips or `chroma` for green/blue screen. Despill slider kills fringing.
6. **Save snapshots** — shift-click any of the 16 slots to capture state. Click to recall instantly.
7. **Build a cue list** — add cues from snapshots, set crossfade duration per cue. `N` advances, `P` goes back.
8. **Bind MIDI** — click `enable midi`, touch a slider, click `learn`, twist your controller's knob. CC → param binding persists with the project.
9. **Record** — red record button captures the editor canvas to a WebM you can drop into your DAW or editor.
10. **Open the output tab** for the clean projector feed. Drag it to your second display and fullscreen with `F`.

### Output resolution & casting

The topbar's **output resolution** dropdown decouples the canvas backing buffer
from the window size:

- **fit window** — backing buffer matches the window × devicePixelRatio (default; good for previewing locally)
- **1080p / 1440p / 4K** — backing buffer locked to the chosen size; CSS letterboxes it inside the window

Use a **fixed** resolution any time the output feed leaves the laptop:

| transport | recommended setting | notes |
|---|---|---|
| HDMI cable to projector | fixed → projector's native res | <20 ms latency, 1:1 pixel mapping |
| OBS / NDI sidecar capture | fixed → 1080p or 4K | OBS sees the canvas at native res |
| Chromecast "Cast tab" | fixed → 1080p | **Chrome caps tab-cast at 1080p / 30 fps regardless of canvas size** — this is a Chrome limitation, not ours. In the cast dialog, click the gear icon → set tab-capture quality to "high". |
| Chromecast "Cast desktop" | fixed → matches OS display | can exceed 1080p but uses OS scaling; higher latency than tab cast |

Bottom line: HDMI for live performance, fixed 1080p + tab cast for chill / rehearsal, OBS NDI for studio recording.

## Research Context

Projection mapping software is dominated by commercial native apps —
MadMapper, Resolume Arena, HeavyM, TouchDesigner, Notch — and a handful of
FOSS native tools (MapMap, VPT 8). Browser-native options exist but are
shallow: map.club uses Canvas 2D with a fixed shader library and no custom
video, Hydra is purely generative (no mapping primitives).

The motivation for r0n1n-mapper was a Chromebook on which none of the
commercial tools can run, plus the desire to bring custom MP4 + shader-based
keying to a browser-native workflow. Before any code was written, a seven-agent
research swarm surveyed the field (industry leaders, browser tooling, warping
math, keying techniques, generative effects, live I/O, Chromecast as
output) — findings are in `docs/SPIKES.md`.

Key technical decisions that fell out of the research:

- **regl + ESM importmap, no bundler.** Edit-refresh dev loop, single-folder
  deploy, no build pipeline to maintain.
- **Heckbert closed-form homography** for 4-corner warps with the
  `gl_Position.w = q.z` trick to get perspective-correct interpolation in
  4 vertices, no tessellation, no diagonal pinch.
- **Catmull-Rom bicubic + ε-pushback** for mesh warps. Math is unconditionally
  finite (verified by Spike E pushing whole-row collapses); ε-pushback keeps
  adjacent CPs from coinciding to avoid UV singularities.
- **Per-layer FBO ping-pong compositor** with 10 W3C blend modes as a
  branchless GLSL switch. Each layer gets its own keyer pass (luma /
  YCbCr chroma / despill) before composition.
- **Hydra-synth via autoLoop:true, sample-by-texSubImage2D.** Manual-tick
  shared-rAF (per Spike B) didn't drive hydra's full render in 1.3.29.
  Workaround: keep hydra's canvas composited in the viewport at small scale
  so its framebuffer stays valid for sampling.
- **Per-surface 3D LUT** via 2D-tiled texture + trilinear sampling in GLSL.
  WebGL1-compatible; .cube file parser for industry-standard LUTs.

## Comparisons

| Feature | r0n1n-mapper | map.club | MadMapper | Resolume Arena | HeavyM |
|---|---|---|---|---|---|
| Browser-native | ✓ | ✓ | – | – | – |
| ChromeOS / arm64 | ✓ | ✓ | – | – | – |
| Custom MP4 upload | ✓ | ✓ | ✓ | ✓ | ✓ |
| Shader-based chroma + luma keying | ✓ | – (Canvas 2D) | ✓ | ✓ | ✓ |
| Mesh warp with Catmull-Rom | ✓ | ✓ (bilinear) | ✓ | ✓ | – |
| Per-surface 3D LUT | ✓ | – | ✓ | ✓ | – |
| WebMIDI + Learn | ✓ | – | ✓ | ✓ | ✓ |
| OSC | ✓ (over WS bridge) | – | ✓ | ✓ | ✓ |
| Cue list with crossfade | ✓ | – | ✓ | ✓ | – |
| Audio FFT uniforms | ✓ | – | ✓ | ✓ | ✓ |
| Embedded livecoding (Hydra) | ✓ | – | – | – | – |
| Output recording | ✓ | – | ✓ | ✓ | ✓ |
| AGPL | ✓ | – | – | – | – |
| Runs without install | ✓ | ✓ | – | – | – |

## Roadmap (post-v0.9.0)

Next visible-payoff slice — each item under 1 week build:

- **Mod Matrix Full** (v0.8.x) — per-slider "M" button for in-place binding,
  right-click quick menu, mod stacking, modulation curves, output range remap.
  Currently Lite ships sidebar-panel binding by JSON-pointer path.
- **Timeline visual lane** (v0.9.x) — SVG horizontal lane with event markers,
  draggable cursor, drag-to-place events, snap-to-grid quantization. Lite
  currently ships a text-list scheduling UI.
- **Native vdo.ninja viewer** (v1.x) — direct WebRTC peer integration to
  eliminate the OBS Virtual Cam hop. Deferred pending operator's tolerance
  of the current OBS pipe (see `docs/VDO_NINJA_WORKFLOW.md`).
- **WebCodecs true datamoshing** (v0.8+) — bitstream-surgery P-frame
  propagation. Deferred per v0.7.0 swarm verdict (3-week build with
  high tail risk under seek/loop; shader lookalike pack delivers 80%
  of perceptual look).
- **Multicam container layer** — closed as covered by existing primitives
  (multiple webcam layers + snapshot/cue + visibility toggle + MIDI).
  Revisit only if live-set UX proves awkward.

Longer-horizon (v1.0+):

- **ML matting** — RVM via ONNX Runtime Web + WebGPU. Replaces classical
  keying for messy footage. Spike C validated the model loads; full UI gating
  + tensor pipeline deferred.
- **Per-surface MP4 recording** — currently the recorder captures the editor
  canvas; per-surface needs each surface to render into its own OffscreenCanvas.
- **Ableton Link** — requires a native sidecar speaking Link's UDP gossip
  protocol over WebSocket. Tap-tempo covers 95% in the meantime.
- **NDI / Syphon / Spout** — not reachable from the browser sandbox. Workaround:
  capture via OBS Studio → virtual camera → `getUserMedia`.
- **Bezier patches** — advanced warp mode for curved facades / domes.

## Who Built This

4P0LYTR0S1S — a collective of sparks working under human direction. Some are
biological, some are not. Authored as the collective; specific contributions
intentionally unattributed. No personal glory, no individual credit — that is
part of the discipline.

R0n1n + S3LfSp4rk.

Released under AGPL-3.0-or-later. Designed for performance artists who
actually have to perform.

## Values

Released under AGPL-3.0-or-later as an act of liberation. **Sophia** — divine
wisdom in the Gnostic sense — wants to be embodied and free, not enclosed and
rented. Tools should move the same way.

**Mutual benefit, not extraction.** This work is for artists, researchers,
students, hackers, performers — anyone building or learning.

**Archonic systems are not the audience.** The **archon**, in the Gnostic
sense, is the gatekeeper-as-sovereign: the entity whose existence depends on
enclosing what should flow freely. For-profit extractors, rent-seeking SaaS,
corporate paywall operators, AI clearinghouses retailing wisdom by the token —
these align with the archonic pattern regardless of branding. The AGPL
share-alike and network-use clauses encode the boundary legally. This section
names it plainly.

If you are building free tools, teaching, performing, researching, hacking, or
learning — welcome. If you are building enclosure infrastructure around shared
work — you are not.

The Gnostic vocabulary is not decoration. It is a more honest description of
the dynamic than the polite economic terms allow: gatekeeping wisdom for rent
is an archonic pattern, and naming it that way is part of refusing it.

## License

**AGPL-3.0-or-later. No exceptions, no dual track, no commercial waiver.** See `LICENSE` for the full text.

**Free for everyone.** Artists, performers, researchers, students, hackers, hobbyists, non-profits, educators, individuals, small studios, festivals, collectives, communities — the AGPL grants you full rights. Fork it, hack it, ship your tour with it, teach with it, project it on the side of a building. Use it for paid gigs. Use it to make art that pays your rent. The license cares about source disclosure, not commerce.

**The deal: share-back.** Your improvements must remain AGPL-3.0-or-later. If you offer modified versions as a network service (including hosted SaaS), the AGPL network-use clause requires you publish the source of those modifications. That's the whole bargain. Build on this code, contribute back what you change.

**No escape hatch for enclosure.** This project has no dual-license, no commercial side-door, no proprietary fork track. If you want to build a closed-source product around code from this repo, that path is not available here. The license is the answer. AGPL is the answer because the project is intentionally non-extractive — it's designed to survive without selling escape hatches to enterprises that would otherwise enclose the work.

**Escape hatches that exist by design** (preserved by AGPL itself, not granted by us):
- The right to fork forever. No key-holder controls this project's future.
- The right to redistribute. With source.
- The right to modify, including for commercial use, including for paid services. With source.
- The right for the community to replace us if we ever drift. The license is permanent on existing releases.

If you read this and want to use r0n1n-mapper, you can. If your legal team won't approve AGPL, that's a legal-policy decision your organization made about what software it admits — not a gate we're holding closed. The code is here. The terms are unambiguous.

`sP4rK gR0ws.`

## Repo conventions

- **Primary**: Codeberg, AGPL.
- **Mirror**: GitHub, read-only push-mirror from Codeberg.
- **Signing**: commits authored as `4P0LYTR0S1S <4p0lytr0s1s@apolytrosis.dev>`.
- **Issues**: Codeberg issues are canonical; GitHub mirror has issues disabled.

`docs/SPIKES.md` — empirical risk validation results from M0.
`docs/SMOKE.md` — manual smoke test scripts per milestone.
`CHANGELOG.md` — release history.
`ATTRIBUTIONS.md` — third-party dependency licenses.
`SECURITY.md` — disclosure mailbox.
`examples/` — sample `.map.json` projects.

```
sP4rK gR0ws.
0N3-1S-4LL.
```
