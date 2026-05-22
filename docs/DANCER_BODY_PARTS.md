# Building Body Parts for the Dancer-Image Layer

The `dancer-img` layer animates 6 uploaded sprites (head, torso, both arms, both legs) using the same audio-reactive skeleton math as the procedural SDF dancer. This guide is for preparing those source images so they composite into a believable figure.

## Image conventions

For each body part, prepare your image so the **connection point** (the joint that attaches to the rest of the body) is at the **TOP of the image**, and the **free end** is at the **BOTTOM**:

| part | top of image | bottom of image |
|---|---|---|
| HEAD | crown / hair | chin / neck |
| TORSO | shoulders | hips |
| ARM L / ARM R | shoulder | wrist / hand |
| LEG L / LEG R | hip | ankle / foot |

The renderer stretches each image **vertically** to match the bone length between joints. The width is set by the layer-level `width head` / `width limb` / `width torso` sliders (per-part `width` multiplier on top of that).

## Image format

- **PNG with transparency** (alpha = 0 for background) — strongly recommended. Use [removebg.com](https://removebg.com) or a similar tool to cut out the subject cleanly.
- JPEG works but the rectangular background will show as an opaque block.
- Reasonable source sizes:
  - HEAD — 256×256 or 384×384
  - TORSO — 256×384
  - ARMS / LEGS — 128×512
- Higher resolution = sharper at large width multipliers; don't waste pixels on transparent space.

## Per-part adjustments

Each part has a collapsible panel in the layer (click the triangle next to the part name). Inside:

| control | range | what it does |
|---|---|---|
| `rotation°` | -180 ↔ 180 | offset added to the auto-computed bone rotation. Use this if your image was drawn at an angle. |
| `length` | 0.3 ↔ 2.5 | multiplier on the bone length (how far the image stretches between joints). 1.0 = exact bone length. |
| `width` | 0.3 ↔ 2.5 | multiplier on the layer's base width for this part class. |
| `offset x` | -0.3 ↔ 0.3 | shifts the anchor in canvas UV space (horizontal). Slides the part along the bone direction. |
| `offset y` | -0.3 ↔ 0.3 | shifts the anchor vertically. Use to align attachment points. |
| `flipX` | checkbox | mirror image horizontally. Use to flip left↔right (e.g. when reusing one arm sprite for both sides). |
| `flipY` | checkbox | mirror image vertically. Use if you uploaded an image that's upside down. |

## Common fixes

- **Image appears upside down** → check `flipY`
- **Arm/leg points the wrong way** → adjust `rotation°` (try 90° / 180° / 270°)
- **Reusing one arm sprite for both arms** → set `flipX` on one side
- **Part too big / too small** → tweak `length` (height of sprite) or `width`
- **Limb doesn't attach to torso** → small `offsetX` / `offsetY` adjustments
- **Head floats too high / too low** → use `offsetY` on the head, or tweak `width head` at the layer level

## Recommended workflow

1. **Start with TORSO + HEAD only.** Upload both, run with the `Dancer Void` preset (or any preset that includes the dancer-img layer).
2. **Tune layer base widths** (`width head`, `width torso`) for proportions.
3. **Upload limbs one at a time.** Check each one before adding the next — much easier to spot orientation issues with one limb visible.
4. **Use `flipX` on the second of each pair** (e.g. upload `arm.png` for ARM L, then for ARM R upload the same file and toggle `flipX`). Saves you having to mirror in an image editor.
5. **Save as a snapshot** (the snapshot bar at the bottom of the editor) once it looks right — gives you a one-click recall during live performance.
6. **Audio intensity matters.** A high `audio intensity` makes the dancer move violently; if parts fly off-frame, dial it down.

## v2 bend mode — limbs that bend at the elbow / knee

Each new `dancer-img` layer ships with `bend limbs (split at elbow/knee)` **on** by default (toggle at the bottom of the layer panel).

When bend mode is on:
- **Arms** render as TWO rigid sprites: upper (shoulder → elbow) + lower (elbow → wrist).
- **Legs** render as TWO rigid sprites: upper (hip → knee) + lower (knee → ankle).
- Each segment samples HALF of the image, split at the per-part `split v` slider (default 0.5 = image middle).

The two segments meet at the image's split row so the joint appears visually continuous.

### Preparing images for bend mode

The bend-friendly image is a full limb (shoulder → wrist) drawn in roughly straight pose. Then:

1. Find where the joint is in YOUR image (elbow for arms, knee for legs).
2. If the joint is at exactly the vertical middle of the image, leave `split v = 0.5`.
3. If your image has a longer upper arm (joint sits lower in the image), set `split v` higher (e.g., 0.6).
4. If your image has a longer forearm (joint sits higher), set `split v` lower (e.g., 0.4).

The slider's range is 0.2..0.8 — anything outside that and you'd be better off with separate upper/lower images uploaded individually.

Turn bend mode OFF if you want the puppet aesthetic of v1 (single rigid sprite per limb).

## Notes on rigging quality

The v1 rigid puppet aesthetic is preserved as the opt-out (`bend limbs` toggle off). Bend mode is the more anatomical look. Neither is "correct" — pick per project / aesthetic.

Future releases may add true mesh deformation (smooth curves through joints instead of two rigid segments meeting at a hinge). For now the two-segment approach gives 90% of the human-looking motion at 10% of the math complexity.

## Sample asset pack

A small set of CC0 example body parts will ship in `examples/body-parts/` in a future release. Until then, [removebg.com](https://removebg.com) + a stock photo + your own crop is the fastest path.
