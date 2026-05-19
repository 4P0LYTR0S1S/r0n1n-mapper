# Security disclosure

Found a security issue? Email **security@apolytrosis.dev** with a description
and reproduction steps. Encrypt sensitive details with the collective PGP key
(fingerprint published at apolytrosis.dev/keys).

For non-security-sensitive issues, file a Codeberg issue at
https://codeberg.org/4P0LYTR0S1S/r0n1n-mapper/issues.

## Scope

In scope:
- Browser-side `src/**` — XSS, prototype pollution, data exfiltration, sandbox escape
- OSC bridge `osc-bridge/**` — RCE, path traversal, DoS via malformed UDP/WS payloads
- Project file format (`.map.json`) — deserialization issues if you load
  untrusted projects

Out of scope:
- DoS from running the editor in a non-conformant browser (use `compat.html`)
- WebGL driver-level issues — report to your browser vendor
- Findings that require a malicious-actor-running-on-the-same-LAN-as-osc-bridge
  threat model: the bridge binds 127.0.0.1 by default. Don't expose it to the
  LAN without firewall rules.

## Disclosure timeline

Aim is response within 5 business days, fix within 30 days for confirmed
vulnerabilities. The collective follows a coordinated disclosure model: please
do not publicly disclose before a fix is shipped.

## Commercial dual-license

AGPL is free for the commons. If your use case is closed-source commercial
distribution or hosted SaaS that doesn't want to release source under AGPL,
you need a separate license. The collective maintains a dual-license track
that waives the network-use and copyleft clauses for commercial terms.

Contact `security@apolytrosis.dev` (also the disclosure mailbox above).
Terms scale with use case — bring your scope, we negotiate.
