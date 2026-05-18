# Manual smoke tests

Run these top-to-bottom at the close of each milestone. No automated harness.
Each test specifies "what to do" and "pass criterion". Note failures inline.

---

## M0 — Skeleton + sync sanity

1. **Open the editor.** Serve the repo (`python3 -m http.server` from the root), navigate to `http://localhost:8000/`. The editor canvas should show a cyan rectangle oscillating in a Lissajous pattern. FPS reads ≥58.
   **Pass:** rectangle moves smoothly, FPS ≥58, no console errors.

2. **Open the output tab.** Click "open output" in the editor topbar. A new tab opens with a black canvas and a "waiting for editor" overlay. As soon as it connects, overlay disappears; rectangle mirrors the editor's position. Both FPS counters read ≥58. Editor topbar status says "sync ✓ output".
   **Pass:** rectangles move in sync (visually identical), both FPS ≥58, sync indicator green.

3. **Close output, editor keeps running.** Editor topbar reverts to "sync — (open output)". No errors thrown.
   **Pass:** editor stable, status indicator updates.

4. **Hard-reload the editor while output is open.** Editor re-bootstraps. Output continues unaffected (will desync briefly then reconnect when editor starts broadcasting again).
   **Pass:** no crash on either side.

5. **Run all 5 spike pages.** From editor sidebar, click each spike. Fill `docs/SPIKES.md` results table.
   **Pass:** every spike returns at least one decision, no spike page crashes outright.

---

## M1 — Single surface vertical slice

*(Filled in at M1 close)*

---

## M2 — Surface family + compositor

*(Filled in at M2 close)*

---

## M3 — Keying / effects / sources

*(Filled in at M3 close)*

---

## M4 — Cues / MIDI / recording

*(Filled in at M4 close)*

---

## M5 — Release hardening

*(Filled in at M5 close)*
