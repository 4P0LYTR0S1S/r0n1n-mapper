// WebMIDI input. Single dispatcher subscribes to onmidimessage from all available
// inputs. Bindings map (channel, cc) → state path. MIDI Learn mode captures the
// next inbound CC and binds to the most-recently-touched UI param.
//
// Persisted state shape (in project JSON):
//   state.midi = {
//     deviceId: null | string,
//     bindings: [{ id, path, channel, cc, min, max }]
//   }

let access = null;
let inputs = [];
let onMessage = null;
let lastTouchedPath = null;
let learnPending = false;
let learnCallback = null;

export async function initMidi() {
  if (access) return access;
  access = await navigator.requestMIDIAccess({ sysex: false });
  refreshInputs();
  access.onstatechange = refreshInputs;
  return access;
}

function refreshInputs() {
  inputs = access ? [...access.inputs.values()] : [];
  for (const input of inputs) {
    input.onmidimessage = (ev) => {
      if (onMessage) onMessage(ev, input);
    };
  }
}

export function midiInputs() {
  return inputs.map(i => ({ id: i.id, name: i.name, manufacturer: i.manufacturer }));
}

export function setHandler(fn) { onMessage = fn; }

// Track the last param a user touched in the UI so MIDI Learn knows which path
// to bind to.
export function touchParam(path) { lastTouchedPath = path; }
export function getLastTouchedPath() { return lastTouchedPath; }

export function startLearn(cb) {
  learnPending = true;
  learnCallback = cb;
}
export function isLearning() { return learnPending; }
export function cancelLearn() { learnPending = false; learnCallback = null; }

// ---- MIDI Clock (FL Studio / Ableton-style transport sync) ----
// 0xF8 = Timing Clock (24 PPQN), 0xFA = Start, 0xFB = Continue, 0xFC = Stop.
//
// We average the last N pulse intervals to derive stable BPM. Math:
//   pulses-per-beat = 24, so BPM = 60_000 / (avg_pulse_interval_ms * 24).
//
// Exposed as `clockBpm()` + `clockRunning()`. Drop-in for the AnalyserNode's
// tap-tempo: prefer clock BPM when available, fall back to tap.
const CLOCK_WINDOW = 48;          // 2 beats of pulses → smooth BPM
const clockIntervals = [];
let lastClockT = 0;
let clockStarted = false;

export function handleClockByte(status) {
  if (status === 0xfa) { clockStarted = true; clockIntervals.length = 0; lastClockT = 0; return; }
  if (status === 0xfc) { clockStarted = false; return; }
  // 0xfb (Continue) = keep going
  if (status !== 0xf8) return;
  const now = performance.now();
  if (lastClockT > 0) {
    const dt = now - lastClockT;
    if (dt > 1 && dt < 200) {  // sanity gate (4 BPM to 50000 BPM)
      clockIntervals.push(dt);
      if (clockIntervals.length > CLOCK_WINDOW) clockIntervals.shift();
    }
  }
  lastClockT = now;
}

export function clockBpm() {
  if (clockIntervals.length < 6) return 0;
  let acc = 0;
  for (const v of clockIntervals) acc += v;
  const avg = acc / clockIntervals.length;
  return Math.round(60000 / (avg * 24));
}

export function clockRunning() { return clockStarted; }

// Parse a MIDI message into { type, channel, ccOrNote, value } or null if it's
// a system/realtime message we don't bind to. Clock messages route to the
// handleClockByte() side-channel before reaching the dispatcher.
export function parseMessage(ev) {
  const [status, d1, d2] = ev.data;
  // System real-time (0xF8–0xFF) — single byte, no channel
  if (status >= 0xf8) { handleClockByte(status); return null; }
  const type = status & 0xf0;
  const channel = status & 0x0f;
  if (type === 0xb0) return { type: 'cc',    channel, cc: d1, value: d2 };
  if (type === 0x90 && d2 > 0) return { type: 'noteOn',  channel, note: d1, value: d2 };
  if (type === 0x80 || (type === 0x90 && d2 === 0)) return { type: 'noteOff', channel, note: d1, value: 0 };
  if (type === 0xe0) return { type: 'pitch', channel, value: ((d2 << 7) | d1) / 16383 };
  return null;
}

// Default dispatcher: applies bindings to the store. Caller installs via setHandler.
// Two binding kinds:
//   - CC bindings: continuous, sets state.path to scaled value (0..127 → min..max)
//   - Note bindings: discrete triggers — fire an action.type with payload
//
// Built-in note-on actions (operator can extend via state.midi.bindings entries):
//   snapshot.recall  — payload: slot index (0..15)
//   cue.next         — payload: ignored
//   cue.previous     — payload: ignored
// Notes 60..75 (C3..D#4) auto-trigger snapshot.recall 0..15 even without explicit binding.
export function createDispatcher(store, hooks = {}) {
  return (ev, input) => {
    const msg = parseMessage(ev);
    if (!msg) return;

    if (learnPending) {
      if (msg.type === 'cc' && lastTouchedPath) {
        const binding = {
          id: 'mb_' + crypto.randomUUID().slice(0, 8),
          path: lastTouchedPath,
          channel: msg.channel,
          cc: msg.cc,
          min: 0, max: 1,
          deviceId: input.id,
        };
        store.update('/midi/bindings', (arr) => arr.push(binding));
        learnPending = false;
        if (learnCallback) try { learnCallback(binding); } catch {}
        learnCallback = null;
        return;
      }
    }

    if (msg.type === 'cc') {
      const bindings = store.state.midi?.bindings ?? [];
      for (const b of bindings) {
        if (b.kind === 'note') continue;
        if (b.channel === msg.channel && b.cc === msg.cc) {
          const v = b.min + (msg.value / 127) * (b.max - b.min);
          store.set(b.path, v);
        }
      }
      return;
    }

    if (msg.type === 'noteOn') {
      // Explicit note bindings first
      const bindings = store.state.midi?.bindings ?? [];
      for (const b of bindings) {
        if (b.kind !== 'note') continue;
        if (b.channel === msg.channel && b.note === msg.note) {
          dispatchAction(b.action, store, hooks);
          return;
        }
      }
      // Default mapping: notes 60..75 → recall snapshot 0..15
      if (msg.note >= 60 && msg.note <= 75) {
        const idx = msg.note - 60;
        dispatchAction({ type: 'snapshot.recall', payload: idx }, store, hooks);
      }
    }
  };
}

function dispatchAction(action, store, hooks) {
  if (!action) return;
  switch (action.type) {
    case 'snapshot.recall':
      hooks.recallSnapshot?.(action.payload);
      break;
    case 'cue.next':
      hooks.cueNext?.();
      break;
    case 'cue.previous':
      hooks.cuePrev?.();
      break;
    case 'cue.goto':
      hooks.cueGoto?.(action.payload);
      break;
  }
}
