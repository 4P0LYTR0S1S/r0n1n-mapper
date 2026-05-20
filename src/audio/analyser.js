// Audio pipeline. Lazy-init on first user gesture (browser policy).
// getUserMedia({audio:true}) → MediaStreamSource → AnalyserNode.
//
// Per-frame computes:
//   bass / mid / high / env (low-pass envelope follower)
//   beat (onset flag — bass energy above rolling mean * threshold)
//   fft  (Uint8Array of magnitudes, exposed for shaders via a 1D R8 texture)
//
// Tap tempo: external code calls tap() on each spacebar press, we compute BPM
// from the rolling average of inter-tap intervals.

let ctx = null;
let analyser = null;
let stream = null;
let source = null;
let fftBins = null;
let initPromise = null;
let currentDeviceId = null;

// Bands (BT.709-ish musical bands, not strict freq cutoffs)
const BAND_BASS_HZ = [40,   250];
const BAND_MID_HZ  = [250,  2000];
const BAND_HIGH_HZ = [2000, 8000];

// State for envelope + beat detection
const env = { bass: 0, mid: 0, high: 0, full: 0 };
const decay = 0.85;             // env smoothing
const bassWindow = [];          // rolling samples for beat detection
const BEAT_WINDOW = 30;
const BEAT_THRESHOLD = 1.4;     // multiplier over rolling mean
let lastBeatT = 0;
const BEAT_MIN_INTERVAL = 0.15; // s, refractory

const taps = [];

export async function initAudio(deviceId = null) {
  if (ctx && currentDeviceId === (deviceId || 'default') && analyser) return ctx;
  // Tear down previous source if we're swapping devices.
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
      // Saved deviceId may be stale (device gone, ID rotated between sessions, or
      // test fixture left behind). Fall back to default rather than failing.
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

export function audioReady() {
  return !!ctx && !!analyser;
}

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

// Update derived uniforms. Call once per frame from the main render loop.
export function updateAudio(t) {
  if (!audioReady()) return defaultUniforms();
  analyser.getByteFrequencyData(fftBins);

  const bass = bandAvg(...BAND_BASS_HZ);
  const mid  = bandAvg(...BAND_MID_HZ);
  const high = bandAvg(...BAND_HIGH_HZ);
  let full = 0;
  for (let i = 0; i < fftBins.length; i++) full += fftBins[i];
  full = (full / fftBins.length) / 255;

  env.bass = Math.max(bass, env.bass * decay);
  env.mid  = Math.max(mid,  env.mid  * decay);
  env.high = Math.max(high, env.high * decay);
  env.full = Math.max(full, env.full * decay);

  // Beat detection on bass band
  bassWindow.push(bass);
  if (bassWindow.length > BEAT_WINDOW) bassWindow.shift();
  let rollingMean = 0;
  for (const v of bassWindow) rollingMean += v;
  rollingMean /= bassWindow.length;

  let beat = false;
  if (bass > rollingMean * BEAT_THRESHOLD && (t - lastBeatT) > BEAT_MIN_INTERVAL) {
    beat = true;
    lastBeatT = t;
  }

  return {
    bass:   env.bass,
    mid:    env.mid,
    high:   env.high,
    env:    env.full,
    beat:   beat ? 1 : 0,
    bpm:    computeBpm(),
    fftBins,
    time:   t,
  };
}

export function tap() {
  const now = performance.now() / 1000;
  taps.push(now);
  // Drop taps older than 4 seconds
  while (taps.length > 1 && now - taps[0] > 4) taps.shift();
}

function computeBpm() {
  // Prefer MIDI Clock when an external transport is feeding us (FL Studio /
  // Ableton via virtual MIDI port). Fall back to tap-tempo otherwise.
  try {
    // Lazy import so analyser.js stays decoupled from MIDI when MIDI isn't enabled.
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
  return { bass: 0, mid: 0, high: 0, env: 0, beat: 0, bpm: 0, fftBins: null, time: 0 };
}
