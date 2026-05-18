// Browser-side OSC client. Connects to the osc-bridge WebSocket and maps
// inbound OSC messages to state paths via bindings of the same shape as MIDI.
//
// Bindings:
//   state.osc.bindings = [{ id, path, address, argIndex, min, max }]
//
// Learn mode mirrors the MIDI flow: user touches a UI param (touchParam(path))
// then enables learn → next inbound OSC binds.

import { touchParam, getLastTouchedPath } from './midi.js';

let ws = null;
let store = null;
let learnPending = false;
let learnCallback = null;
let onStatus = () => {};

export function setStatusListener(fn) { onStatus = fn; }

export function connect(storeRef, url = 'ws://127.0.0.1:8787') {
  store = storeRef;
  if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();

  ws = new WebSocket(url);
  ws.onopen   = () => onStatus({ connected: true, url });
  ws.onclose  = () => onStatus({ connected: false });
  ws.onerror  = () => onStatus({ connected: false, error: 'connect failed' });
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.dir === 'in') handleInbound(msg);
  };
}

export function disconnect() {
  if (ws) ws.close();
  ws = null;
}

export function startOscLearn(cb) { learnPending = true; learnCallback = cb; }
export function isOscLearning() { return learnPending; }
export function cancelOscLearn() { learnPending = false; learnCallback = null; }

function handleInbound({ address, args }) {
  if (!store) return;

  if (learnPending) {
    const path = getLastTouchedPath();
    if (path) {
      const binding = {
        id: 'ob_' + crypto.randomUUID().slice(0, 8),
        path,
        address,
        argIndex: 0,
        min: 0,
        max: 1,
      };
      store.update('', (st) => {
        if (!st.osc) st.osc = { bindings: [] };
        st.osc.bindings.push(binding);
      });
      learnPending = false;
      if (learnCallback) try { learnCallback(binding); } catch {}
      learnCallback = null;
      return;
    }
  }

  const bindings = store.state.osc?.bindings ?? [];
  for (const b of bindings) {
    if (b.address !== address) continue;
    const raw = args[b.argIndex ?? 0];
    if (typeof raw !== 'number') continue;
    const v = b.min + raw * (b.max - b.min);
    store.set(b.path, v);
  }
}

export function send(address, args = []) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ dir: 'out', address, args }));
}
