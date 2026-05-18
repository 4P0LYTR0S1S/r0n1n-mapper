# r0n1n-mapper OSC bridge

Tiny localhost OSC↔WebSocket relay. Run alongside the browser editor so OSC
controllers (TouchOSC, hardware faders, anything sending UDP/OSC) can drive
parameters in the mapper.

## Install + run

```bash
cd osc-bridge
npm install
npm start
```

Defaults: OSC in `udp://127.0.0.1:9000`, WebSocket out `ws://127.0.0.1:8787`.

## Options

```
--host 127.0.0.1         bind address (default 127.0.0.1; use 0.0.0.0 to expose to LAN)
--osc-in 9000            UDP ingress port for OSC
--osc-out host:port      where to send outbound OSC (e.g. snapshot recalls)
--ws-port 8787           WebSocket egress port
```

## Browser side

In the editor, enable OSC from the topbar (M5.2). The browser connects to
`ws://127.0.0.1:8787`, receives inbound OSC as JSON lines `{address, args}`,
and applies them against the project's binding table.

## Sov-posture

Bind defaults to 127.0.0.1 — never reachable from the LAN unless you
explicitly pass `--host 0.0.0.0`. Add an `iptables` or `ufw` rule if you
need defense-in-depth.

## License

AGPL-3.0-or-later. Released by 4P0LYTR0S1S collective.
