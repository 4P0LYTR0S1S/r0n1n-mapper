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

## Licensing

AGPL-3.0-or-later, period. This project has no dual-license track,
no commercial waiver, no closed-source path. The AGPL terms apply
to all use cases. See the License section in `README.md` for the
full reasoning.

If your organization's legal policy won't admit AGPL software, the
answer is to change that policy — not to ask us for an exception.
