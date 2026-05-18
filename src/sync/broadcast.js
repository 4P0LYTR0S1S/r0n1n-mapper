// BroadcastChannel wrapper. Editor publishes state deltas; output mirrors.
// M1 uses 'state:full' on every dirty tick (state is small) plus 'transport'
// pings for video sync. M2 will add 'state:delta' coalesced at 60Hz.

const CHANNEL = 'r0n1n-mapper';

export function makeChannel(role) {
  const ch = new BroadcastChannel(CHANNEL);
  const listeners = new Set();
  ch.onmessage = (ev) => { for (const fn of listeners) fn(ev.data); };
  return {
    role,
    send(type, payload) {
      ch.postMessage({ type, payload, role, t: performance.now() });
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    close() { ch.close(); },
  };
}
