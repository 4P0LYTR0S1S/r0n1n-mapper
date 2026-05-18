// Solid-color layer — useful as a background or for blend-mode color injection
// (e.g. "multiply red" to colorize a video). 1x1 RGBA texture, updated when
// the layer.color array mutates.

export function attachSolid(regl, layer) {
  const color = layer.color ?? [1, 1, 1, 1];
  let lastColor = color.slice();
  const data = new Uint8Array(4);
  for (let i = 0; i < 4; i++) data[i] = Math.round(color[i] * 255);
  const texture = regl.texture({ width: 1, height: 1, data, format: 'rgba', type: 'uint8', min: 'nearest', mag: 'nearest', wrap: 'clamp' });

  return {
    layer,
    texture,
    flipY: false,
    tick() {
      const c = layer.color ?? lastColor;
      let changed = false;
      for (let i = 0; i < 4; i++) {
        if (c[i] !== lastColor[i]) { changed = true; lastColor[i] = c[i]; }
      }
      if (changed) {
        for (let i = 0; i < 4; i++) data[i] = Math.round(lastColor[i] * 255);
        texture({ width: 1, height: 1, data, format: 'rgba', type: 'uint8' });
      }
    },
    dispose() { texture.destroy?.(); },
  };
}
