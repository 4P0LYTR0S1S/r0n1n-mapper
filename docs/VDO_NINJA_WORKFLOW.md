# vdo.ninja → r0n1n-mapper

Get a remote camera (or screen, or audio) into r0n1n-mapper as a webcam-style
layer. Useful for guest VJs, remote stream contributions, multi-camera live
sets without dedicated capture cards, or pulling in a phone-as-camera for
your own face / your DJ decks.

## The pipe (zero-code, works today)

```
[Remote guest's phone or webcam]
        │
        ▼
  vdo.ninja browser tab  ──►  generates stream ID + view URL
        │
        ▼   (WebRTC peer connection, no install needed for guest)
        │
[Your computer]
  OBS Studio
   └── Browser Source: https://vdo.ninja/?view=STREAMID&cleanview
   └── Enable: Tools → Virtual Camera → Start
        │
        ▼   (now appears as "OBS Virtual Camera" to every other app)
        │
  r0n1n-mapper
   └── + webcam → device picker → "OBS Virtual Camera"
```

The remote stream is now a normal webcam layer in r0n1n-mapper. All the
existing webcam-layer features work: chroma/luma keying, opacity, blend
modes, surface mapping, post-effects layered on top.

## Step-by-step

### 1. On the guest's device (phone, laptop, tablet)

1. Open https://vdo.ninja in their browser (Chrome, Firefox, Safari all work).
2. Click **"Send Camera"** (or other source — screen, audio-only, etc.).
3. They get a **Stream ID** (e.g. `xyz123`).
4. Either share the stream ID with you, OR generate a custom one before they
   click send by visiting `https://vdo.ninja/?push=mystream` first.

### 2. On your computer

#### a) OBS Browser Source

1. Open OBS Studio (v27+ recommended for built-in Virtual Camera).
2. In Sources, click **+ → Browser**.
3. URL: `https://vdo.ninja/?view=STREAMID&cleanview`
   - Replace `STREAMID` with the guest's ID.
   - `&cleanview` strips the vdo.ninja overlay UI, leaving just the video.
4. Width / Height: match the source resolution (default 1280×720 is fine).
5. **Check** "Shutdown source when not visible" → unchecked. You want the
   stream to keep flowing even if OBS isn't visually focused on it.

#### b) OBS Virtual Camera

1. OBS menu → **Tools → Virtual Camera → Start**.
2. (Optional) Set output resolution under Settings → Video so the virtual
   cam is at your preferred resolution.

#### c) r0n1n-mapper

1. In the editor, click **+ webcam** to add a webcam layer.
2. Expand the layer panel, find the **device** dropdown.
3. Select **"OBS Virtual Camera"** (or "Camera (OBS Virtual Camera)" on Mac).
4. The remote stream is now compositing into your projection.

If you don't see "OBS Virtual Camera" in the dropdown:
- Hit the **🔄 refresh** button next to the dropdown.
- On Crostini (ChromeOS): you'll need to expose the OBS virtual camera to
  the Linux container. This is awkward — typically requires installing OBS
  inside Crostini itself, which doesn't have great GPU access for browser
  sources. The cleanest path on Crostini is to run OBS on a different
  machine (e.g. an iMac) and pipe via NDI or a hardware capture loop.

## Why not a native vdo.ninja layer?

vdo.ninja uses a custom WebRTC signaling protocol against their own WSS
server. Building a native viewer in r0n1n-mapper would require:

- WebRTC offer/answer/ICE plumbing (~200 LOC minimum)
- TURN fallback for restrictive NATs (vdo.ninja's free TURN is the only
  reliable option — adds vendor lock-in)
- Codec negotiation (H.264 / VP8 / VP9 — depends on guest's browser)
- Reconnect logic for dropped peers
- UI for stream ID input + status display
- ~3-5 days build + ongoing maintenance as vdo.ninja updates their protocol

The OBS pipe gives you the same functional outcome with **zero r0n1n-mapper
code** and **full vdo.ninja feature compatibility** (including features
they add tomorrow). The cost is one extra app in the chain — acceptable
given r0n1n-mapper's "sovereign instrument" framing already assumes OBS
is in your stack for streaming/recording.

A native viewer is queued for v1.x as a "is the OBS hop annoying enough"
operator-driven decision, not a planned-in milestone.

## Bonus uses

- **Phone as your face cam** — point your phone at yourself, vdo.ninja
  it, pipe to OBS Virtual Cam, add as webcam in r0n1n-mapper, chroma-key
  out the background. Hide your laptop's mediocre built-in cam.
- **Phone as deck cam** — clamp your phone over the DJ decks, vdo.ninja,
  same pipe. Overhead deck shot in your projection.
- **Friend's livestream** — guest from anywhere on Earth, no install for
  them, you get their feed as a chroma-keyable layer.
- **Screen-share as layer** — vdo.ninja supports screen capture, so a
  collaborator's screen becomes a webcam-style layer in your projection.

## Latency

vdo.ninja → OBS Browser Source → Virtual Cam → r0n1n-mapper adds roughly:

- vdo.ninja WebRTC: 50-200ms depending on network + TURN
- OBS Browser Source decode: ~30ms
- Virtual Camera frame buffer: ~16-33ms (one frame at 30/60 FPS)
- r0n1n-mapper compositor: ~16ms

Total: ~110-280ms end-to-end. Fine for visuals, not great for lip-sync
audio. For audio-sync-critical use, route the guest's audio separately
through OBS audio routing rather than relying on the vdo.ninja video's
embedded audio track.
