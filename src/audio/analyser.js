// Audio pipeline. Lazy-init on first user gesture (browser policy).
// getUserMedia({audio:true}) → MediaStreamSource → AnalyserNode.
//
// v0.6.0 — VJ-grade audio pipeline upgrade:
//   - 5-band split (sub / kick / lowMid / highMid / air) tuned for EDM/DnB
//     alongside legacy bass/mid/high (kept bit-compatible for existing shaders)
//   - Asymmetric attack/release envelope per band (fast attack, slow release)
//   - Peak-hold per band with slow decay (for freeze-on-bright tricks)
//   - Spectral flux onset detection (cleaner than bass-spike — picks snares,
//     claps, anything transient, not just kicks)
//   - Musical clock: u_beatMod4 (beat-in-bar), u_barMod16 (bar-in-phrase),
//     u_phrasePos (0..1 ramp inside an 8-bar phrase), anchored on first BPM
//   - Drop detector heuristic: sustained-build → low-dip → reattack with onset
//   - Legacy bass-spike u_beat flag preserved for backward compatibility
//
// Tap tempo: external code calls tap() on each spacebar press; we compute BPM
// from rolling-average inter-tap intervals (or prefer MIDI Clock if active).

let ctx = null;
let analyser = null;
let stream = null;
let source = null;
let fftBins = null;
let initPromise = null;
let currentDeviceId = null;

// ============================================================================
// Band definitions
// ============================================================================
// 5-band VJ split (v0.6.0). Bands are intentionally NOT contiguous — the gaps
// (120-250, 500-2000, 4-8 kHz) are less musically distinct for VJ purposes,
// and skipping them keeps each band tight on a meaningful percussive/tonal
// element. Re-tune these if you're driving non-EDM material.
const BAND_SUB_HZ     = [20,    60];     // 808 sub, weight
const BAND_KICK_HZ    = [60,    120];    // kick body, the "thump"
const BAND_LOWMID_HZ  = [120,   500];    // bass body, tonal low end
const BAND_HIGHMID_HZ = [2000,  4000];   // snare, clap, vocal presence
const BAND_AIR_HZ     = [8000,  16000];  // hi-hat, cymbal sparkle

// Legacy 3-band (kept bit-compatible for shaders written pre-v0.6.0)
const BAND_BASS_HZ = [40,   250];
const BAND_MID_HZ  = [250,  2000];
const BAND_HIGH_HZ = [2000, 8000];

// ============================================================================
// Envelope / peak / onset state
// ============================================================================

// Asymmetric attack/release: a kick should HIT (fast attack) then sag (slow
// release). Pure exponential decay made everything feel like a pulsing glow;
// these constants give VJ-style punch-and-sag at 60fps.
const ENV_ATTACK  = 0.6;
const ENV_RELEASE = 0.05;
const env = {
  sub: 0, kick: 0, lowMid: 0, highMid: 0, air: 0,
  bass: 0, mid: 0, high: 0, full: 0,
};

// Peak-hold: max-then-decay. Useful for "freeze the bright frame" effects
// where you want the most recent transient color/intensity to linger.
const PEAK_DECAY = 0.94;
const peak = { sub: 0, kick: 0, lowMid: 0, highMid: 0, air: 0 };

// Spectral flux for onset detection.
// flux[n] = Σ max(0, fft[n][i] - fft[n-1][i]) — sum of positive frame-to-frame
// deltas. Onset fires when flux exceeds rolling-mean + k·stddev, with a
// refractory to prevent double-triggers on a single transient.
let prevFft = null;
const fluxWindow = [];
const FLUX_WINDOW = 30;
const FLUX_K = 1.5;
const ONSET_MIN_INTERVAL = 0.07;
let lastOnsetT = 0;

// Legacy bass-spike beat (unchanged math; kept for backward-compat)
const bassWindow = [];
const BEAT_WINDOW = 30;
const BEAT_THRESHOLD = 1.4;
const BEAT_MIN_INTERVAL = 0.15;
let lastBeatT = 0;

// ============================================================================
// Musical clock state
// ============================================================================
// Anchored on first valid BPM tap. Resets if BPM changes by >1 (operator
// re-tapped or MIDI clock shifted phrase).
let clockAnchorT = null;
let clockAnchorBpm = 0;
function ensureClockAnchor(t, bpm) {
  if (bpm <= 0) return;
  if (clockAnchorT === null || Math.abs(bpm - clockAnchorBpm) > 1) {
    clockAnchorT = t;
    clockAnchorBpm = bpm;
  }
}

// ============================================================================
// Drop detector state
// ============================================================================
// 5-second rolling RMS history. Drop heuristic:
//   1. Sustained energy in the 3s..0.8s ago window (preMid > threshold)
//   2. Energy dip in the 0.8s..0.3s ago window (dipMin < preMid * 0.3)
//   3. Re-attack in last 0.3s with an onset spike
// Then dropFlag holds for DROP_HOLD_MS so a fragment-shader effect has time
// to play out (invert-on-drop, hue-pop, etc).
const rmsHistory = [];
const RMS_HISTORY_S = 5;
const DROP_HOLD_MS = 800;
const DROP_COOLDOWN_S = 2.0;
let lastDropT = -10;

const taps = [];

// ============================================================================
// Init / device handling (unchanged from pre-v0.6.0)
// ============================================================================
export async function initAudio(deviceId = null) {
  if (ctx && currentDeviceId === (deviceId || 'default') && analyser) return ctx;
  if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
  if (source) { try { source.disconnect(); } catch {} source = null; }
  initPromise = (async () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audioConstraints = {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    };
    if (deviceId) audioConstraints.deviceId = { exact: deviceId };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (e) {
      if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        console.warn('[audio] saved deviceId not usable, falling back to default:', deviceId, e.name);
        delete audioConstraints.deviceId;
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        deviceId = null;
      } else throw e;
    }
    source = ctx.createMediaStreamSource(stream);
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.7;
      fftBins = new Uint8Array(analyser.frequencyBinCount);
    }
    source.connect(analyser);
    currentDeviceId = deviceId || 'default';
    return ctx;
  })();
  return initPromise;
}

export async function listAudioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(d => d.kind === 'audioinput')
    .map(d => ({ id: d.deviceId, label: d.label || `audio input ${d.deviceId.slice(0, 6)}` }));
}

export function currentAudioDeviceId() { return currentDeviceId; }
export function getAudioStream() { return stream; }
export function audioReady() { return !!ctx && !!analyser; }

// ============================================================================
// FFT helpers
// ============================================================================
function hzToBin(hz) {
  if (!ctx || !analyser) return 0;
  return Math.round(hz / (ctx.sampleRate / analyser.fftSize));
}

function bandAvg(lo, hi) {
  const a = Math.max(0, hzToBin(lo));
  const b = Math.min(fftBins.length - 1, hzToBin(hi));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i <= b; i++) sum += fftBins[i];
  return (sum / (b - a + 1)) / 255;
}

// Asymmetric envelope: fast attack, slow release.
function attRel(prev, x) {
  return x > prev
    ? prev + (x - prev) * ENV_ATTACK
    : prev + (x - prev) * ENV_RELEASE;
}

// ============================================================================
// Per-frame update — call once from the main render loop
// ============================================================================
export function updateAudio(t) {
  if (!audioReady()) return defaultUniforms();
  analyser.getByteFrequencyData(fftBins);

  // -- 5-band raw averages --
  const sub     = bandAvg(...BAND_SUB_HZ);
  const kick    = bandAvg(...BAND_KICK_HZ);
  const lowMid  = bandAvg(...BAND_LOWMID_HZ);
  const highMid = bandAvg(...BAND_HIGHMID_HZ);
  const air     = bandAvg(...BAND_AIR_HZ);

  // -- Legacy 3-band raw averages (backward-compat) --
  const bass = bandAvg(...BAND_BASS_HZ);
  const mid  = bandAvg(...BAND_MID_HZ);
  const high = bandAvg(...BAND_HIGH_HZ);

  // -- Full-band envelope --
  let full = 0;
  for (let i = 0; i < fftBins.length; i++) full += fftBins[i];
  full = (full / fftBins.length) / 255;

  // -- Asymmetric envelope follower per band --
  env.sub     = attRel(env.sub,     sub);
  env.kick    = attRel(env.kick,    kick);
  env.lowMid  = attRel(env.lowMid,  lowMid);
  env.highMid = attRel(env.highMid, highMid);
  env.air     = attRel(env.air,     air);
  env.bass    = attRel(env.bass,    bass);
  env.mid     = attRel(env.mid,     mid);
  env.high    = attRel(env.high,    high);
  env.full    = attRel(env.full,    full);

  // -- Peak hold (slow decay) --
  peak.sub     = Math.max(env.sub,     peak.sub     * PEAK_DECAY);
  peak.kick    = Math.max(env.kick,    peak.kick    * PEAK_DECAY);
  peak.lowMid  = Math.max(env.lowMid,  peak.lowMid  * PEAK_DECAY);
  peak.highMid = Math.max(env.highMid, peak.highMid * PEAK_DECAY);
  peak.air     = Math.max(env.air,     peak.air     * PEAK_DECAY);

  // -- Spectral flux + onset detection --
  let flux = 0;
  if (prevFft && prevFft.length === fftBins.length) {
    for (let i = 0; i < fftBins.length; i++) {
      const d = fftBins[i] - prevFft[i];
      if (d > 0) flux += d;
    }
    flux /= fftBins.length * 255;
  }
  if (!prevFft || prevFft.length !== fftBins.length) {
    prevFft = new Uint8Array(fftBins.length);
  }
  prevFft.set(fftBins);

  fluxWindow.push(flux);
  if (fluxWindow.length > FLUX_WINDOW) fluxWindow.shift();
  let fmean = 0;
  for (const v of fluxWindow) fmean += v;
  fmean /= fluxWindow.length;
  let fvar = 0;
  for (const v of fluxWindow) fvar += (v - fmean) * (v - fmean);
  const fstd = Math.sqrt(fvar / Math.max(1, fluxWindow.length - 1));
  let onset = 0;
  if (
    fluxWindow.length >= 5 &&
    flux > fmean + FLUX_K * fstd &&
    (t - lastOnsetT) > ONSET_MIN_INTERVAL
  ) {
    onset = 1;
    lastOnsetT = t;
  }

  // -- Legacy bass-spike beat (unchanged) --
  bassWindow.push(bass);
  if (bassWindow.length > BEAT_WINDOW) bassWindow.shift();
  let rollingMean = 0;
  for (const v of bassWindow) rollingMean += v;
  rollingMean /= bassWindow.length;
  let beat = 0;
  if (bass > rollingMean * BEAT_THRESHOLD && (t - lastBeatT) > BEAT_MIN_INTERVAL) {
    beat = 1;
    lastBeatT = t;
  }

  // -- Musical clock from BPM --
  const bpm = computeBpm();
  ensureClockAnchor(t, bpm);
  let beatMod4 = 0, barMod16 = 0, phrasePos = 0;
  if (bpm > 0 && clockAnchorT !== null) {
    const beatsElapsed = (t - clockAnchorT) * (bpm / 60);
    beatMod4  = beatsElapsed % 4;                  // 0..4 continuous (floor = beat-in-bar)
    const barsElapsed = beatsElapsed / 4;
    barMod16  = barsElapsed % 16;                  // 0..16
    phrasePos = (barsElapsed % 8) / 8;             // 0..1 inside an 8-bar phrase
  }

  // -- Drop detector --
  rmsHistory.push({ t, rms: env.full });
  while (rmsHistory.length > 1 && t - rmsHistory[0].t > RMS_HISTORY_S) rmsHistory.shift();

  let dropFlag = 0;
  if (t - lastDropT > DROP_COOLDOWN_S && rmsHistory.length >= 60) {
    const recent    = rmsHistory.filter(s => t - s.t < 0.3);
    const dip       = rmsHistory.filter(s => t - s.t >= 0.3 && t - s.t < 0.8);
    const preRecent = rmsHistory.filter(s => t - s.t >= 0.8 && t - s.t < 3);
    if (recent.length && dip.length && preRecent.length) {
      const recentMax = Math.max(...recent.map(s => s.rms));
      const dipMin    = Math.min(...dip.map(s => s.rms));
      const preMid    = preRecent.reduce((a, s) => a + s.rms, 0) / preRecent.length;
      if (
        preMid > 0.25 &&
        dipMin < preMid * 0.3 &&
        recentMax > preMid * 1.1 &&
        onset
      ) {
        lastDropT = t;
      }
    }
  }
  if (t - lastDropT < DROP_HOLD_MS / 1000) dropFlag = 1;

  return {
    // Legacy 3-band (backward-compat — existing shaders read these)
    bass: env.bass,
    mid:  env.mid,
    high: env.high,
    env:  env.full,
    beat,
    bpm,
    fftBins,
    time: t,

    // v0.6.0 — 5-band split
    sub:     env.sub,
    kick:    env.kick,
    lowMid:  env.lowMid,
    highMid: env.highMid,
    air:     env.air,

    // v0.6.0 — peak hold per band (slow decay)
    peakSub:     peak.sub,
    peakKick:    peak.kick,
    peakLowMid:  peak.lowMid,
    peakHighMid: peak.highMid,
    peakAir:     peak.air,

    // v0.6.0 — spectral flux + onset (cleaner than bass-spike beat)
    flux,
    onset,

    // v0.6.0 — musical clock
    beatMod4,
    barMod16,
    phrasePos,

    // v0.6.0 — drop detector flag (held for DROP_HOLD_MS after detection)
    dropFlag,
  };
}

export function tap() {
  const now = performance.now() / 1000;
  taps.push(now);
  while (taps.length > 1 && now - taps[0] > 4) taps.shift();
}

function computeBpm() {
  try {
    const { clockBpm } = (window.__r0n1n_midi ??= {});
    if (typeof clockBpm === 'function') {
      const b = clockBpm();
      if (b > 0) return b;
    }
  } catch {}
  if (taps.length < 2) return 0;
  let acc = 0;
  for (let i = 1; i < taps.length; i++) acc += taps[i] - taps[i - 1];
  const avg = acc / (taps.length - 1);
  if (avg <= 0) return 0;
  return Math.round(60 / avg);
}

function defaultUniforms() {
  return {
    bass: 0, mid: 0, high: 0, env: 0, beat: 0, bpm: 0, fftBins: null, time: 0,
    sub: 0, kick: 0, lowMid: 0, highMid: 0, air: 0,
    peakSub: 0, peakKick: 0, peakLowMid: 0, peakHighMid: 0, peakAir: 0,
    flux: 0, onset: 0,
    beatMod4: 0, barMod16: 0, phrasePos: 0, dropFlag: 0,
  };
}
