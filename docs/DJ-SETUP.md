# r0n1n-mapper × DJ software

Companion to `FL-STUDIO-SETUP.md`. Most of the architecture is identical —
DJ apps are FL with a different transport model — but each has its own
MIDI-Out idiosyncrasies. The three parallel integration channels:

| Channel | Use it for | Latency |
|---|---|---|
| **MIDI Clock** | beatgrid-locked tempo on `u_bpm` (cue crossfades aligned to bars, shader beat flashes) | <2ms |
| **MIDI CC** | crossfader / EQ / filter / FX dials → r0n1n params via Learn | <5ms |
| **Audio loopback → FFT** | bass / mid / high / env / beat uniforms reacting to whatever's actually playing now | ~10–30ms |

If your DJ app sends MIDI Clock, prefer it for tempo. Fall back to audio beat
detection when it doesn't.

---

## algoriddim djay Pro (macOS / iPadOS / Windows)

**Setup**:
1. **Settings → MIDI → External Devices → Enable Output** — pick the virtual MIDI port from `FL-STUDIO-SETUP.md` Step 1 (IAC `r0n1n` on Mac, loopMIDI `r0n1n` on Windows).
2. Tick **Send MIDI Clock** and **Send Transport Messages**.
3. Tick **Send Mixer Controls** if you want crossfader / volumes / EQ to send MIDI CCs.
4. In r0n1n-mapper: **enable midi**, the port appears. The topbar **bpm** locks to djay's master deck the moment you press play.

**What djay sends by default** (subject to version, sample mapping for djay Pro 5):

| Source | MIDI |
|---|---|
| Master BPM (active deck) | MIDI Clock (24 PPQN) |
| Play / Pause | 0xFA / 0xFC system real-time |
| Crossfader | CC 8 (channel 1) |
| Deck A volume | CC 7 (channel 1) |
| Deck B volume | CC 7 (channel 2) |
| Deck A EQ low/mid/high | CC 12 / 13 / 14 (channel 1) |
| Deck B EQ low/mid/high | CC 12 / 13 / 14 (channel 2) |
| Deck A filter | CC 15 (channel 1) |
| Deck B filter | CC 15 (channel 2) |
| FX 1–4 dry/wet | CC 22 / 23 / 24 / 25 |
| Beat pulse (per active deck) | Note 60 on/off (some versions) |

Verify by enabling **Settings → MIDI → Show MIDI Activity** and twiddling
controls; the assigned CCs appear in the log.

**Audio loopback**: route djay's master to BlackHole 2ch / CABLE Input (per
FL-STUDIO-SETUP.md Step 4), then in r0n1n click **🎤 audio** and pick the
loopback. To keep monitoring on speakers, use a macOS Multi-Output Device
or VoiceMeeter B-bus.

---

## Native Instruments Traktor Pro

Traktor is the most flexible MIDI-out-wise, with the caveat that mappings
are configured via TSI controller files rather than a simple toggle.

**Setup**:
1. **Preferences → Controller Manager** → Add → Generic MIDI.
2. Output device: virtual MIDI port (`r0n1n`).
3. Add output mappings: click **Add Out…** → choose Tempo, Phase, Beat, Crossfader, Deck FX, etc.
4. **Preferences → External Sync → Clock → Send MIDI Clock = on**, pick the port.

**Useful mappings**:

| Source | Recommended MIDI |
|---|---|
| Master Tempo | MIDI Clock |
| Master Tempo (continuous BPM as CC, alternative) | CC 100 |
| Crossfader | CC 8 |
| Deck A/B/C/D play | Note 60-63 on |
| Deck A/B beat phase (0–1 inside each beat) | CC 16 (channel per deck) |
| Master FX 1 dry/wet | CC 70 |

Traktor's "Beat Phase" CC is uniquely useful — exposes a continuous 0..127
ramp that resets every beat. Bind it to a shader-layer parameter for clean
beat-synced sweeps without needing audio FFT smoothing.

**TSI tip**: save your output mapping as a `.tsi` file in
`~/Documents/Native Instruments/Traktor X.X.X/Settings/` so it persists
across reinstalls.

---

## Mixxx (FOSS, cross-platform)

Mixxx is the only one with **native OSC** in addition to MIDI — use OSC for
the cleanest integration with our `osc-bridge`.

**OSC setup** (preferred):
1. **Preferences → Controllers** → Enable OSC.
2. Set destination `127.0.0.1:9000` (matches our `osc-bridge` default ingress).
3. In `osc-bridge`: `node server.mjs` (defaults are right).
4. In r0n1n-mapper: **connect bridge** in the OSC panel.
5. Mixxx sends a stream of OSC messages: `/EngineMaster/sync_bpm`, `/Channel1/play`, `/Crossfader`, etc. Use **learn** in r0n1n's OSC panel to bind any of them to any param.

**MIDI setup** (alternative):
1. **Preferences → Controllers** → Add → Generic MIDI Output.
2. Edit mapping XML at `~/.mixxx/controllers/` to enable Clock + CC outputs.
3. Same flow as djay/Traktor from there.

---

## Pioneer rekordbox

rekordbox's MIDI Output is more locked-down (designed for Pioneer DJ
hardware rather than custom integrations). Best path:

1. **Preferences → Controller → Output to MIDI device** = your virtual port.
2. Limited CC vocabulary — mostly play/cue/loop states per deck.
3. **MIDI Clock**: not natively exposed in standard rekordbox. Workaround: Pro DJ Link → MIDI Clock via a third-party bridge like `MIDI Beat Clock from Pro DJ Link` (community tools exist).

For rekordbox, **audio-loopback + r0n1n's audio beat detection** is the
pragmatic path — your `u_bpm` won't be sample-accurate but will be within
a few BPM of true.

---

## Serato DJ Pro

Serato's MIDI output story is the weakest of the bunch.

1. **Setup → MIDI → MIDI assignments** is input-only by default.
2. Internal MIDI Out requires the **Serato DJ Pro Suite** or a paid expansion
   that includes "MIDI Output" — check your license.
3. If available: route to virtual MIDI port and configure assignments.
4. If not: use audio loopback + tap-tempo as the fallback.

---

## Latency budget (DJ workflow)

| Path | Practical jitter | What's affected |
|---|---|---|
| MIDI Clock | <2ms (one pulse interval at 128 BPM = ~20ms; averaged over 48 pulses → BPM uncertainty <0.5 BPM) | `u_bpm` lock |
| MIDI CC | <5ms | crossfader → opacity / EQ → filter shader / FX → effect param |
| Audio FFT (AnalyserNode) | 10–30ms incl. ~22ms FFT window | `u_bass`, `u_mid`, `u_high`, `u_env`, `u_beat` |
| Display compositing → projector | 16–33ms (Chromium VSYNC + projector latency) | actual photons on the wall |

The last row dominates the others. Don't sweat sub-frame MIDI Clock accuracy
when your projector chain costs you a frame anyway.

---

## DJ-flavored r0n1n recipes

### 1. Crossfader-driven snapshot morph

Bind your DJ crossfader CC to **two** snapshot slots' opacities. Configure:
- Slot 1: deck-A visuals (e.g. blue palette, slow FBM)
- Slot 2: deck-B visuals (e.g. red palette, fast kaleido)
- Two cues, both with crossfade = 0ms (hard cut at advance)
- Bind crossfader CC to `/surfaces/0/opacity` for slot 1 and the inverse (max - value) for slot 2

Today this requires two manual MIDI Learn binds. A first-class **"DJ mode"**
state field — `djMode: { deckASnap, deckBSnap, crossfader }` — would expose
this as a single bind. Tell me if that's worth a v0.2 patch.

### 2. Beatgrid-locked cue advance

With MIDI Clock running, set each cue's `crossfadeMs` to:

```
crossfadeMs = (60000 / bpm) × N   // N = number of beats to fade over
```

At 128 BPM, 1 beat ≈ 469ms, 2 beats ≈ 938ms, 1 bar (4 beats) ≈ 1875ms.

For automatic bar-aligned advance, bind a beat-counter CC (Traktor Beat Phase
crossing zero, Mixxx OSC `/Channel1/beat_active`) to a hidden "cue advance"
trigger — needs a small bridge function in `cues.js` you'd add as a follow-up.

### 3. Per-deck FFT (advanced)

To analyze deck A and deck B separately:

- Route deck A → CABLE-A (or BlackHole 16ch channels 1-2)
- Route deck B → CABLE-B (channels 3-4)
- r0n1n today reads ONE audio source. v0.3 would add a per-channel source
  picker so each can drive different shader-layer uniforms (e.g. shader-A
  reacts to deck-A bass, shader-B reacts to deck-B bass).

For now, route the FULL master to r0n1n — you're listening to what the
audience hears, which is what the visuals should react to anyway.

### 4. FX-bus-only reactivity

Route only the FX bus from your DJ app to CABLE — bass/mid/high reflect
JUST the FX signal (verb tails, delay throws). Pair with subtle visual
effects that bloom when the DJ throws a reverb wash. Sounds gimmicky;
plays great live.

---

## What's NOT in scope for now

- **Track metadata** (title / artist / album art) — DJ apps don't expose
  this via MIDI/OSC consistently. The two paths that work:
  - **algoriddim djay** has a "Now Playing" widget — screen-capture it
    into r0n1n via getDisplayMedia (browser API), texture it as an image
    layer. v0.3 stretch goal.
  - **Mixxx + custom Python script** reading `~/.mixxx/mixxx.log` for
    currently-loaded track metadata, posting via OSC to the bridge.
- **Cue point markers** — same story. DJ-app specific, no common standard.
- **Beatgrid alignment past the bar** — MIDI Clock gives us beats, not
  bar boundaries. The DJ knows when bars start (they made the beatgrid);
  r0n1n can only infer. A "tap downbeat" UX (operator hits a key on the
  one) would give us bar phase; ~20 LOC if it's wanted.

---

Released by 4P0LYTR0S1S collective. AGPL-3.0-or-later.
