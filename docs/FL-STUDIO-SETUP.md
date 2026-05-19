# r0n1n-mapper × FL Studio

A daily-driver-grade integration guide. Three independent channels run in
parallel:

| Channel | r0n1n side | FL Studio side | Latency |
|---|---|---|---|
| **MIDI Control (CC, notes)** | WebMIDI + MIDI Learn (per-param bindings) | MIDI Out track, Patcher, Performance Mode triggers | <5ms |
| **MIDI Clock (transport sync)** | new in v0.2 — auto-BPM, replaces tap-tempo when live | MIDI Out → Send Master Sync | <2ms |
| **Audio reactivity (FFT)** | `getUserMedia` + AnalyserNode → bass/mid/high/env/beat | Master output → OS audio loopback | <10ms |

All three coexist. Most setups use Channel 1+3 (knobs drive visual params,
audio drives FFT-reactive shaders). Add Channel 2 when you need beat-locked
crossfades or shader effects that read `u_bpm` for time-aligned modulation.

---

## Step 1 — virtual MIDI port (per OS)

You need a virtual MIDI cable for FL → browser. Once installed it appears as
both a MIDI output (FL writes to it) and a MIDI input (Chromium reads from it).

### Windows
- **loopMIDI** by Tobias Erichsen (free): https://www.tobias-erichsen.de/software/loopmidi.html
- Run loopMIDI, create a port named `r0n1n` by clicking the `+` button.
- In FL Studio: **Options → MIDI Settings → Output**, find `r0n1n`, enable it, set port number `0`.
- In r0n1n-mapper: click **enable midi** in the panel — the loopMIDI port appears in the device dropdown.

### macOS
- Built-in. Open **Audio MIDI Setup** (in Applications/Utilities).
- Window menu → **Show MIDI Studio**. Double-click **IAC Driver**.
- Tick **Device is online**. Add a port named `r0n1n` under "Ports".
- In FL Studio: **Options → MIDI Settings → Output**, find `IAC Driver — r0n1n`, enable it.

### Linux
- ALSA includes virtual MIDI by default:
  ```bash
  sudo modprobe snd-virmidi midi_devs=1   # creates /dev/snd/midiC1D0 etc
  aconnect -l                              # lists "Virtual Raw MIDI 1-0"
  ```
- In FL Studio (running under Wine/Bottles or natively on FL 21+ Linux build):
  **Options → MIDI Settings → Output**, enable the virmidi port.

---

## Step 2 — MIDI Control Channel (knobs → r0n1n params)

This is the most common workflow.

1. **In FL Studio**: drop a **MIDI Out** plugin onto a Channel rack slot (or use the master MIDI Out).
2. Set its output port to the `r0n1n` port you created.
3. Right-click any knob in FL (volume, filter cutoff, custom Patcher param) →
   **Link to controller…** → **MIDI Out** → assign a CC number (e.g. CC 14).
4. **In r0n1n-mapper**:
   - Click **enable midi** in the panel.
   - Touch the slider you want to bind (e.g. a layer's opacity slider — touch it briefly).
   - Click **learn**.
   - Twist the FL knob you assigned to CC 14. The binding appears in the
     `midi-bindings` list as `/layers/0/opacity → ch1 cc14`.
5. Save the project (`save` button or right-click → export). Bindings persist.

### Recommended starter map

| FL Studio source | r0n1n target | Path |
|---|---|---|
| Master Volume → MIDI Out CC 7 | surface 0 opacity | `/surfaces/0/opacity` |
| Channel filter cutoff → CC 74 | layer 0 opacity | `/layers/0/opacity` |
| Patcher param "warp X" → CC 20 | mesh CP X (custom — wire in code) | manual |
| Performance Mode pad → Note On C3 | snapshot recall slot 1 | manual (notes not bindable in v0.1, post-v0.1.0 enhancement) |

### Patcher template idea

Build a Patcher chain that takes 8 automation lanes and fans them to 8
discrete CCs (CC 14..21). One Patcher node per visual parameter; one
automation clip per knob in your project. This gives you a "visual mixer"
on a separate track that records and recalls cleanly with the rest of the
project.

---

## Step 3 — MIDI Clock Channel (transport sync)

In **FL Studio**: **Options → MIDI Settings → Output**, click your `r0n1n`
port, and tick **Send Master Sync**. FL will emit 24-PPQN MIDI Clock pulses
while transport is running, plus Start/Stop messages on play/stop.

In **r0n1n-mapper**: nothing to configure. The `enable midi` flow auto-listens
for clock pulses. The topbar **bpm** indicator shows the locked tempo as soon
as FL starts playing. Tap-tempo continues to work as a fallback when clock
isn't running.

### What you can do with locked tempo

- **Cue crossfades** — set `crossfadeMs` to a beat-aligned value (60_000 / BPM × beats). At 128 BPM, 1 beat = 469ms; 2 beats = 938ms.
- **Shader effects** — `u_bpm` is exposed in the shader-layer uniforms. Custom effects can pulse on every beat: `if (mod(u_time * u_bpm / 60.0, 1.0) < 0.1) { /* flash */ }`.
- **Snapshot advance on bar** — wire a Patcher beat trigger to a CC bound to `cues.next()` (post-v0.1.0 feature; manual JS in M5).

---

## Step 4 — Audio Reactivity Channel (FL master → FFT)

FL's audio goes to your master output device. You need a **loopback** so the
master appears as an INPUT device that browsers can `getUserMedia()`.

### Windows
- **VB-Audio CABLE** (donationware): https://vb-audio.com/Cable/
- Install, reboot. A new device `CABLE Input (VB-Audio Virtual Cable)` appears as a playback device, and `CABLE Output` as a recording device.
- In FL Studio: **Options → Audio Settings → Output**, switch to `CABLE Input`.
- In r0n1n-mapper: click **🎤 audio**, pick `CABLE Output` from the browser permission prompt.
- Caveat: you lose monitoring. Either run a **VoiceMeeter** B-bus to also send to your real speakers, or use a Y-split: FL → ASIO splitter → speakers + CABLE.

### macOS
- **BlackHole** (free, FOSS): https://github.com/ExistentialAudio/BlackHole
- Install BlackHole 2ch. In Audio MIDI Setup, create a **Multi-Output Device**
  combining your real output + BlackHole 2ch.
- In FL Studio: **Options → Audio Settings → Output**, pick the multi-output device.
- In r0n1n-mapper: click **🎤 audio**, pick `BlackHole 2ch` as the input.

### Linux (PulseAudio / PipeWire)
```bash
# Create a virtual sink + monitor source on the fly:
pactl load-module module-null-sink sink_name=r0n1n_sink sink_properties=device.description=r0n1n_loopback
# In FL Studio output settings, route to r0n1n_sink.
# In Chromium, the input "Monitor of r0n1n_loopback" appears in getUserMedia.
```

### What audio drives

Once routed, the analyser exposes these to every `shader-layer` and `hydra-layer`:

- `u_bass` (40–250 Hz envelope, 0–1)
- `u_mid`  (250–2000 Hz envelope)
- `u_high` (2000–8000 Hz envelope)
- `u_env`  (full-spectrum envelope)
- `u_beat` (1.0 on detected onset, 0 otherwise — one-frame pulse)
- `u_fft`  (1×512 R8 texture of frequency bins)

The bundled `fft-bars` shader effect visualizes this directly. The `fbm` and
`kaleido` effects already modulate by audio bands. Custom hydra chains can
read these via `cc(0)..cc(3)` if you bridge them (post-v0.1.0).

---

## Step 5 — Recording with FL

Three options:

1. **Browser-side**: hit the red **● rec** button in r0n1n's topbar.
   Captures the editor canvas via `captureStream` → MediaRecorder → WebM.
   FL plays back live, r0n1n records what you see. Good for quick caps.

2. **FL Studio offline render + r0n1n offline render**: render audio in FL
   (Ctrl+R → WAV), then record r0n1n with the audio loopback playing the
   rendered file. Higher quality, no real-time pressure.

3. **OBS Studio**: capture both audio (from VB-CABLE / BlackHole) and the
   r0n1n browser window via OBS's "Window Capture" or "Browser Source".
   Required if you want to mix multiple visual sources or stream live.

---

## Tips from 25 years of FL

- **Avoid audio feedback**: if FL routes to CABLE Input *and* you `getUserMedia`
  from CABLE Output in the same browser, no feedback (different streams).
  If you also play r0n1n's output audio (none — it's silent), still no
  feedback. If you ever add audio output to r0n1n, route it to a separate
  bus to be safe.

- **Patcher > automation clips for VJ**: automation clips fight tempo
  changes. Patcher chains let you bake "knob = function of clip position +
  BPM" without bothering FL's transport.

- **Performance Mode for cue triggers**: bind FL's Performance Mode pad
  trigger notes to r0n1n snapshot recalls. Today this needs custom JS
  (Notes aren't in the M5 Learn UX); add a Note→snapshotIndex binding
  scheme in v0.2.

- **Latency**: MIDI is sub-5ms. Audio FFT is ~10–30ms (AnalyserNode's
  internal smoothing + frame timing). For tight bass-drop-locked visuals,
  use MIDI Clock + the `u_beat` audio uniform together: trust the clock for
  timing, use the audio onset for "feel."

- **Backup**: r0n1n persists projects to localStorage + IndexedDB. Export
  `.r0n1n.json` regularly. Use the `export` button after a working session.

---

## What's not (yet) integrated

- **OSC from FL** — FL doesn't natively speak OSC. Workarounds: TouchOSC on
  iPad → osc-bridge → r0n1n (which IS supported). Or write a custom MIDI
  Out → OSC bridge in `osc-bridge/`.
- **VST hosting r0n1n** — browser apps can't be VST plugins. The closest is
  OBS Studio capturing the browser window then routing the OBS output back
  through a virtual camera that FL doesn't see (no benefit there).
- **Sidechain from FL kick to a visual param** — easier: route the kick to
  a dedicated audio bus, send that to CABLE Input #2 (VB-Audio supports
  multiple cables), pick that bus in r0n1n's audio source. Cleaner band
  separation than the full master FFT.

If any of these become must-have, file an issue (Codeberg) and we'll wire
them into a v0.2 follow-up.

---

Released by 4P0LYTR0S1S collective. AGPL-3.0-or-later. SC: [edge_runners_helpline](https://soundcloud.com/edge_runners_helpline).
