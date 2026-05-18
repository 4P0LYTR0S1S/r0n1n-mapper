#!/usr/bin/env node
// r0n1n-mapper OSC↔WebSocket bridge.
// Run alongside the browser editor. Browsers cannot speak UDP, so this tiny
// Node helper exposes OSC traffic over a localhost WebSocket the browser can
// reach. Bind defaults to 127.0.0.1 — sov-posture: never reachable from a LAN
// without explicit --host.
//
// Usage:
//   node osc-bridge/server.mjs                 # OSC in 9000, WS out 8787
//   node osc-bridge/server.mjs --osc-in 9001   # custom OSC ingress port
//   node osc-bridge/server.mjs --host 0.0.0.0  # expose to LAN (NOT default)
//
// Wire format on the WS: line-delimited JSON.
//   inbound  → { dir:'in',  address:'/path', args:[1.0, 'x'], t: <perf-ms> }
//   outbound → { dir:'out', address:'/path', args:[...] } (browser asks bridge to send)

import dgram from 'node:dgram';
import { WebSocketServer } from 'ws';
import osc from 'osc-min';

const args = parseArgs(process.argv.slice(2));
const HOST     = args.host     || '127.0.0.1';
const OSC_IN   = +(args['osc-in']  || 9000);
const OSC_OUT  = args['osc-out']   || null;   // optional host:port for outbound OSC
const WS_PORT  = +(args['ws-port'] || 8787);

console.log(`[osc-bridge] OSC in udp://${HOST}:${OSC_IN} → ws://${HOST}:${WS_PORT}`);
if (OSC_OUT) console.log(`[osc-bridge] outbound OSC to udp://${OSC_OUT}`);

// UDP socket — receives OSC messages
const udp = dgram.createSocket('udp4');
udp.on('message', (msg, rinfo) => {
  try {
    const decoded = osc.fromBuffer(msg);
    const parsed = flatten(decoded);
    for (const m of parsed) broadcast({ dir: 'in', address: m.address, args: m.args, src: `${rinfo.address}:${rinfo.port}`, t: performance.now() });
  } catch (e) {
    console.warn('[osc-bridge] decode error', e.message);
  }
});
udp.bind(OSC_IN, HOST);

// WebSocket server — fan-out to all connected browsers
const wss = new WebSocketServer({ host: HOST, port: WS_PORT });
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ dir: 'hello', osc_in: OSC_IN, host: HOST }));
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (raw) => {
    if (!OSC_OUT) return;
    try {
      const obj = JSON.parse(raw.toString());
      if (obj.dir !== 'out' || !obj.address) return;
      const buf = osc.toBuffer({ address: obj.address, args: obj.args || [] });
      const [outHost, outPort] = OSC_OUT.split(':');
      udp.send(buf, +outPort, outHost);
    } catch (e) { console.warn('[osc-bridge] out error', e.message); }
  });
});

function broadcast(payload) {
  const line = JSON.stringify(payload);
  for (const ws of clients) {
    try { ws.send(line); } catch {}
  }
}

function flatten(packet, out = []) {
  if (packet.oscType === 'bundle') {
    for (const e of packet.elements) flatten(e, out);
  } else if (packet.oscType === 'message') {
    out.push({ address: packet.address, args: packet.args.map(a => a.value) });
  }
  return out;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

process.on('SIGINT', () => { console.log('\n[osc-bridge] shutting down'); udp.close(); wss.close(); process.exit(0); });
