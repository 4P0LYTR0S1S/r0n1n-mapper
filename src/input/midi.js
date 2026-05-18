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

// Parse a MIDI message into { type, channel, ccOrNote, value } or null if it's
// a system/realtime message we don't bind to.
export function parseMessage(ev) {
  const [status, d1, d2] = ev.data;
  const type = status & 0xf0;
  const channel = status & 0x0f;
  if (type === 0xb0) return { type: 'cc',    channel, cc: d1, value: d2 };
  if (type === 0x90 && d2 > 0) return { type: 'noteOn',  channel, note: d1, value: d2 };
  if (type === 0x80 || (type === 0x90 && d2 === 0)) return { type: 'noteOff', channel, note: d1, value: 0 };
  if (type === 0xe0) return { type: 'pitch', channel, value: ((d2 << 7) | d1) / 16383 };
  return null;
}

// Default dispatcher: applies bindings to the store. Caller installs via setHandler.
export function createDispatcher(store) {
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

    if (msg.type !== 'cc') return;
    const bindings = store.state.midi?.bindings ?? [];
    for (const b of bindings) {
      if (b.channel === msg.channel && b.cc === msg.cc) {
        const v = b.min + (msg.value / 127) * (b.max - b.min);
        store.set(b.path, v);
      }
    }
  };
}
