# Examples

Three sample `.map.json` projects. Load via the editor's **load** button (or
right-click load for "import from file").

| File | What it shows |
|---|---|
| `generative-only.map.json` | One surface, FBM shader bottom + hydra-synth `kaleid+osc` chain on top with screen blend. No external media needed — runs end-to-end on a fresh install. |
| `single-quad-with-key.map.json` | One quad surface with a plasma background layer and a video layer configured for **luma keying** of a black-background VJ clip. The `videoId` is a placeholder — import a clip via the editor, copy its hash from the saved project, and paste. |
| `dual-mesh-stereo.map.json` | Two side-by-side mesh surfaces (5×4 grids) demonstrating multi-surface output. Left mesh runs FBM; right mesh runs the kaleidoscope shader. |

## Replacing the placeholder video

The `single-quad-with-key.map.json` file references `videoId: "PLACEHOLDER_VIDEO_HASH"`. To use your own clip:

1. Drop your `.mp4` / `.webm` into the editor first (a new surface + layer will appear).
2. Open DevTools → Application → IndexedDB → `r0n1n-mapper` → `videos` and copy the `id` of your clip.
3. Edit `single-quad-with-key.map.json`, replace `PLACEHOLDER_VIDEO_HASH` with that id, save.
4. **load** the project. The video layer should attach to your clip.

(Future versions will surface the videoId in the layer UI so this is a no-DevTools operation.)
