// 3D LUT support — parses Adobe Cube format, builds a 2D-tiled texture suitable
// for trilinear sampling in a WebGL1-compatible shader (no sampler3D).
//
// Tile layout (the standard "horizontal strip"): width = N×N, height = N.
// Each N×N tile encodes one blue slice. Tile k holds all (r, g) for b = k/(N-1).
// Within a tile, x = r × (N-1), y = g × (N-1).
//
// Cube file ordering per Adobe spec: R varies fastest, then G, then B.
// So entry i = (b * N + g) * N + r corresponds to color (r/(N-1), g/(N-1), b/(N-1)).

const HEADER_KEYS = ['TITLE', 'LUT_3D_SIZE', 'DOMAIN_MIN', 'DOMAIN_MAX', 'LUT_1D_SIZE'];

export function parseCube(text) {
  const lines = text.split(/\r?\n/);
  let size = 0;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const values = [];

  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    if (HEADER_KEYS.some(k => line.startsWith(k))) {
      const parts = line.split(/\s+/);
      if (parts[0] === 'LUT_3D_SIZE') size = parseInt(parts[1], 10);
      else if (parts[0] === 'LUT_1D_SIZE') throw new Error('1D LUTs not supported in M5');
      else if (parts[0] === 'DOMAIN_MIN') domainMin = parts.slice(1, 4).map(Number);
      else if (parts[0] === 'DOMAIN_MAX') domainMax = parts.slice(1, 4).map(Number);
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length === 3 && !isNaN(parts[0])) {
      values.push([+parts[0], +parts[1], +parts[2]]);
    }
  }
  if (!size) throw new Error('LUT_3D_SIZE missing');
  if (values.length !== size * size * size) {
    throw new Error(`expected ${size ** 3} entries, found ${values.length}`);
  }
  return { size, values, domainMin, domainMax };
}

// Build an RGBA8 array sized [N×N, N] (width × height) for upload to a 2D texture.
export function tile3DLut(lut) {
  const { size: n, values } = lut;
  const W = n * n;
  const H = n;
  const data = new Uint8Array(W * H * 4);
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const srcIdx = (b * n + g) * n + r;
        const [R, G, B] = values[srcIdx];
        const dstX = b * n + r;
        const dstY = g;
        const di = (dstY * W + dstX) * 4;
        data[di]     = Math.max(0, Math.min(255, Math.round(R * 255)));
        data[di + 1] = Math.max(0, Math.min(255, Math.round(G * 255)));
        data[di + 2] = Math.max(0, Math.min(255, Math.round(B * 255)));
        data[di + 3] = 255;
      }
    }
  }
  return { width: W, height: H, data };
}

export function uploadLutTexture(regl, lut) {
  const tile = tile3DLut(lut);
  return regl.texture({
    width: tile.width,
    height: tile.height,
    data: tile.data,
    format: 'rgba',
    type: 'uint8',
    min: 'linear',
    mag: 'linear',
    wrap: 'clamp',
    flipY: false,
  });
}

// GLSL for trilinear 3D LUT sampling from a 2D-tiled texture.
// Use as: vec3 graded = sampleLut(srcRgb, u_lut, u_lutSize);
export const LUT_GLSL = `
  vec3 sampleLut(vec3 col, sampler2D lut, float n) {
    col = clamp(col, 0.0, 1.0);
    float scale = (n - 1.0) / n;          // map [0,1] → [0, (N-1)/N]
    float bias  = 0.5 / n;                // texel-center offset within a tile
    float W     = n * n;

    float bf = col.b * (n - 1.0);
    float b0 = floor(bf);
    float b1 = min(b0 + 1.0, n - 1.0);
    float t  = bf - b0;

    float xWithin = col.r * scale + bias;
    float y       = col.g * scale + bias;
    vec3 lo = texture2D(lut, vec2((b0 + xWithin) / n, y)).rgb;
    vec3 hi = texture2D(lut, vec2((b1 + xWithin) / n, y)).rgb;
    return mix(lo, hi, t);
  }
`;
