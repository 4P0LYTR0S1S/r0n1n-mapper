# Contributing

Welcome. This project is built for the commons. Read the **Values** section in
[README.md](README.md) first — contributions that align with those values are
welcome through the doors below.

## Who should contribute

- Performers, VJs, projection artists shipping the tool in the field
- Researchers experimenting with browser-native real-time graphics
- Students learning WebGL / regl / shader programming
- Hackers fixing bugs they hit, adding features they need
- Translators making the UI accessible in their language
- Documentarians writing better setup guides for hardware we don't own

## Who should not contribute

If you represent a for-profit entity intending to enclose this work into a
closed paid product without sharing the derived source back under AGPL —
this project is not for you. The license enforces share-back legally.
Contribution is also a values statement; align or be elsewhere.

## How to contribute

1. **Issues** — open an issue on Codeberg before sinking work into a large
   change. Quick fixes don't need an issue; just open a PR.
2. **Pull Requests** — fork, branch, make the change, open a PR against `main`.
3. **Code style** — match the surrounding code. Two-space indent, ES modules,
   no bundler, no transpilation. The whole project loads via importmap.
4. **Tests** — there's no automated harness. Each milestone has manual smoke
   tests in `docs/SMOKE.md`. If your change touches a milestone area, update
   that file or note in the PR which smoke step you ran.
5. **Browsers** — verified on Chromium-based browsers + recent Firefox. Safari
   has known gaps (WebMIDI, WebCodecs) — note Safari-specific impact if any.

## What contributions are NOT accepted

- Anti-features: tracking, telemetry, analytics, DRM, anti-piracy.
- Premium feature gates: any code path that hides behavior behind a paid
  tier, license server check, or cloud-only requirement.
- Closed-source dependencies: every direct dep must be FOSS, available on a
  mirror outside vendor-controlled infrastructure (vendored snapshot in
  `vendor/` is fine if upstream goes offline).
- Surveillance-flavored integrations: analytics SDKs, attribution trackers,
  fingerprinting libraries — even "anonymized."

## License agreement

By submitting a PR, you agree your contribution is released under the same
**AGPL-3.0-or-later** as the rest of the project. No CLA, no copyright
assignment. Your patch is your copyright; you license it AGPL to the
collective.

## Reaching us

- **Bug reports / features** — issues on Codeberg
- **Security disclosure** — see [SECURITY.md](SECURITY.md)
- **General** — `contact@apolytrosis.dev`

---

Released by **4P0LYTR0S1S** collective. AGPL-3.0-or-later.
