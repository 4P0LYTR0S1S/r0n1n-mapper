// Preset scenes — full-screen audio-reactive showcases.
//
// Each preset's `build()` returns { surfaces, layers } that completely
// replace the current project state. Surfaces are full-canvas quads
// (corners at clip-space ±1). Layers stack bottom-to-top in the order
// they appear; the dancer is usually on top.
//
// The applyPreset() helper in main-editor.js handles state replacement
// + runtime re-attachment.

const FULL_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

let _id = 0;
function uid(prefix) {
  _id += 1;
  return `${prefix}_${Date.now().toString(36)}_${_id}`;
}

function shaderLayer(name, effect, params, opts = {}) {
  return {
    id: uid('layer'),
    type: 'shader',
    name,
    enabled: true,
    opacity: opts.opacity ?? 1.0,
    blendMode: opts.blendMode ?? 'normal',
    effect,
    params,
    audioIntensity: opts.audioIntensity ?? 1.0,
  };
}

function fullScreenSurface(name, layerIds) {
  return {
    id: uid('surf'),
    name,
    z: 0,
    visible: true,
    opacity: 1.0,
    blendMode: 'normal',
    layerIds,
    grade: { lutId: null, intensity: 1.0 },
    warp: {
      mode: 'quad',
      perspective: { corners: FULL_CORNERS.map(c => [...c]) },
      mesh: { gridX: 5, gridY: 4, points: [] },
    },
  };
}

function compose(name, ...layers) {
  const surface = fullScreenSurface(name, layers.map(l => l.id));
  return { surfaces: [surface], layers };
}

// ─────────────────────────────────────────────────────────────────────
// THE PRESETS — go nuts
// ─────────────────────────────────────────────────────────────────────

export const PRESETS = {
  'dancer-void': {
    name: '◉ Dancer Void',
    description: 'Pure dancer, deep-space backdrop. Minimal showcase, maximum signal.',
    build: () => compose('Void',
      shaderLayer('dancer', 'dancer', {
        bones:  [0.0, 1.0, 0.85],         // cyan
        joints: [1.0, 0.20, 0.85],        // magenta
        bg:     [0.005, 0.0, 0.04],       // near-black blue
        thick:  0.009,
      }, { audioIntensity: 1.4 }),
    ),
  },

  'neon-cathedral': {
    name: '✚ Neon Cathedral',
    description: 'Kaleidoscope rose-window backdrop, gold dancer center. Religious-festival energy.',
    build: () => compose('Cathedral',
      shaderLayer('kaleido bg', 'kaleido', { segments: 12 },
        { audioIntensity: 1.8, opacity: 0.9 }),
      shaderLayer('dancer', 'dancer', {
        bones:  [1.0, 0.78, 0.20],        // gold
        joints: [1.0, 0.40, 0.10],        // hot orange
        bg:     [0.02, 0.0, 0.02],
        thick:  0.011,
      }, { audioIntensity: 1.2, blendMode: 'screen' }),
    ),
  },

  'spectrum-rain': {
    name: '┃ Spectrum Rain',
    description: 'FFT bars rain backdrop, acid-green dancer. Audio-visualizer with body.',
    build: () => compose('Spectrum',
      shaderLayer('bars', 'fft-bars', { color: [0.20, 1.0, 0.40] },
        { audioIntensity: 2.0, opacity: 0.75 }),
      shaderLayer('dancer', 'dancer', {
        bones:  [0.20, 1.0, 0.40],        // acid green (matrix)
        joints: [1.0, 0.0, 0.20],         // blood red
        bg:     [0.0, 0.02, 0.0],
        thick:  0.008,
      }, { audioIntensity: 1.6, blendMode: 'screen' }),
    ),
  },

  'plasma-storm': {
    name: '⌇ Plasma Storm',
    description: 'Plasma vortex + VHS chromatic aberration + ghost dancer. Cyberpunk apocalypse.',
    build: () => compose('Storm',
      shaderLayer('plasma', 'plasma', {
        colorA: [0.4, 0.0, 0.0],          // deep red
        colorB: [1.0, 0.0, 0.6],          // hot pink
      }, { audioIntensity: 1.5 }),
      shaderLayer('vhs', 'vhs', {
        aberration: 0.025,
        tint: [1.0, 0.85, 0.95],
      }, { audioIntensity: 2.0, opacity: 0.6, blendMode: 'overlay' }),
      shaderLayer('dancer', 'dancer', {
        bones:  [1.0, 1.0, 1.0],          // white-hot
        joints: [0.0, 1.0, 1.0],          // cyan
        bg:     [0.05, 0.0, 0.08],
        thick:  0.009,
      }, { audioIntensity: 1.4, blendMode: 'add' }),
    ),
  },

  'deep-noise': {
    name: '≈ Deep Noise',
    description: 'FBM organic ground, copper dancer. Shamanic / underground.',
    build: () => compose('Deep',
      shaderLayer('fbm', 'fbm', {
        scale: 5.0,
        tint:  [0.6, 0.3, 0.1],           // earth brown
      }, { audioIntensity: 1.7, opacity: 0.85 }),
      shaderLayer('dancer', 'dancer', {
        bones:  [0.85, 0.45, 0.10],       // copper
        joints: [1.0, 0.65, 0.0],         // orange flame
        bg:     [0.04, 0.01, 0.0],
        thick:  0.012,
      }, { audioIntensity: 1.3, blendMode: 'screen' }),
    ),
  },

  'cyber-galactic': {
    name: '◯ Cyber Galactic',
    description: 'Raymarched sphere + FBM nebula + ice dancer. Cosmic stage.',
    build: () => compose('Galactic',
      shaderLayer('nebula', 'fbm', {
        scale: 3.0,
        tint:  [0.1, 0.25, 0.5],          // deep blue
      }, { audioIntensity: 1.2, opacity: 0.7 }),
      shaderLayer('sphere', 'raymarch', {},
        { audioIntensity: 1.8, opacity: 0.7, blendMode: 'screen' }),
      shaderLayer('dancer', 'dancer', {
        bones:  [0.6, 0.95, 1.0],         // ice blue
        joints: [1.0, 1.0, 1.0],          // white
        bg:     [0.0, 0.0, 0.0],
        thick:  0.008,
      }, { audioIntensity: 1.5, blendMode: 'add' }),
    ),
  },
};

export const PRESET_IDS = Object.keys(PRESETS);
