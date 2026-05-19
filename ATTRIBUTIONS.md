# Third-party attributions

r0n1n-mapper depends on the following third-party software. Licenses are
permissive or copyleft as listed; full text of each license should be
preserved in any redistribution.

## Browser runtime (loaded via ESM importmap)

| Package | Version | License | Source |
|---|---|---|---|
| [regl](https://github.com/regl-project/regl) | 2.1.0 | MIT | https://esm.sh/regl@2.1.0 |
| [hydra-synth](https://github.com/hydra-synth/hydra) | 1.3.29 | AGPL-3.0-or-later | https://esm.sh/hydra-synth@1.3.29 |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | 1.18.0 | MIT | https://esm.sh/onnxruntime-web@1.18.0 (post-v0.1.0; deferred) |

## OSC bridge (Node)

| Package | Version | License |
|---|---|---|
| [ws](https://github.com/websockets/ws) | ^8.18.0 | MIT |
| [osc-min](https://github.com/russellmcc/node-osc-min) | ^1.1.2 | BSD-2-Clause |

## Models (post-v0.1.0)

| Model | License | Source |
|---|---|---|
| [Robust Video Matting (RVM)](https://github.com/PeterL1n/RobustVideoMatting) | Creative Commons BY-NC-SA 4.0 | Non-commercial use only without separate license. Operator must verify license terms before commercial deployment. |

## Algorithms

- **Perspective homography** — Paul Heckbert, *Fundamentals of Texture Mapping and Image Warping* (Master's thesis, UC Berkeley, 1989), §3.3 closed-form unit-square → quad map.
- **Catmull-Rom interpolation** — standard bicubic formulation, uniform parameterization.
- **OBS-style despill** — derived from OBS Studio's chroma key shader (GPL-2.0-or-later); the GLSL has been reimplemented from the algorithmic description, not copied verbatim.
- **W3C Compositing & Blending Level 1** — blend mode formulas follow the W3C specification.

## License interactions

This project is released under AGPL-3.0-or-later. AGPL is compatible with MIT
and BSD-licensed dependencies (the more permissive licenses do not impose
copyleft on the combined work, and AGPL's copyleft applies to the resulting
work as a whole). hydra-synth is itself AGPL, which is consistent with this
project's license.

For dual-licensing of this project under terms other than AGPL, contact the
collective via the address in `SECURITY.md`. Note that dual-licensing this
project under proprietary terms would require either replacing hydra-synth
with a permissively-licensed equivalent or negotiating a license exception
with the hydra-synth maintainers.
