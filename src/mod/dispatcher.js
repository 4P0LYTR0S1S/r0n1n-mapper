// v0.8.0 — Modulation matrix dispatcher.
//
// Bind any continuous parameter to a modulation source (LFO or audio band)
// and the dispatcher walks the bindings every frame, evaluates each source,
// and writes the modulated value back into the param. Foundation for
// turning every existing slider into a creative surface.
//
// Per-tab dispatch model: both editor and output run their own dispatcher
// in their respective frame loops, reading the SAME mods + lfos from broadcast
// state but evaluating them locally at each tab's framerate. Avoids the
// 60fps state:full broadcast storm you'd get if the editor resolved mods and
// broadcast every-frame param mutations.

// ============================================================================
// Wave shapes
// ============================================================================
const TAU = Math.PI * 2;

function shapeSin(phi)  { return 0.5 + 0.5 * Math.sin(phi * TAU); }
function shapeTri(phi)  { const p = phi - Math.floor(phi); return p < 0.5 ? p * 2 : 2 - p * 2; }
function shapeSaw(phi)  { return phi - Math.floor(phi); }
function shapeSqr(phi)  { return ((phi - Math.floor(phi)) < 0.5) ? 0 : 1; }
// Sample-and-hold: random value held until phase crosses 1.0 (next "tick")
const _shState = new Map();
function shapeSH(phi, lfoId) {
  const tick = Math.floor(phi);
  const st = _shState.get(lfoId);
  if (!st || st.tick !== tick) {
    const v = Math.random();
    _shState.set(lfoId, { tick, v });
    return v;
  }
  return st.v;
}

const SHAPES = {
  sin: (phi) => shapeSin(phi),
  tri: (phi) => shapeTri(phi),
  saw: (phi) => shapeSaw(phi),
  sqr: (phi) => shapeSqr(phi),
  sh:  (phi, id) => shapeSH(phi, id),
};

// ============================================================================
// BPM-synced rate table (in BEATS per cycle)
// ============================================================================
// 1/16 = 0.25 beats, 1/8 = 0.5, 1/4 = 1, 1/2 = 2, 1bar = 4, 2bar = 8, 4bar = 16
export const RATE_LABELS = {
  '1/16': 0.25,
  '1/8':  0.5,
  '1/4':  1.0,
  '1/2':  2.0,
  '1bar': 4.0,
  '2bar': 8.0,
  '4bar': 16.0,
  '8bar': 32.0,
};
export const RATE_NAMES = Object.keys(RATE_LABELS);

// ============================================================================
// Audio source registry
// ============================================================================
// Each source maps to a uniform value in audio.uniforms. Most are 0..1 (band
// envelopes); onset/dropFlag are 0 or 1; beatMod4/barMod16/phrasePos are ramps.
// Normalized to 0..1 so depth scaling stays predictable.
export const AUDIO_SOURCES = {
  'audio:sub':       (a) => a?.sub        ?? 0,
  'audio:kick':      (a) => a?.kick       ?? 0,
  'audio:lowMid':    (a) => a?.lowMid     ?? 0,
  'audio:highMid':   (a) => a?.highMid    ?? 0,
  'audio:air':       (a) => a?.air        ?? 0,
  'audio:env':       (a) => a?.env        ?? 0,
  'audio:peakKick':  (a) => a?.peakKick   ?? 0,
  'audio:peakAir':   (a) => a?.peakAir    ?? 0,
  'audio:onset':     (a) => a?.onset      ?? 0,
  'audio:dropFlag':  (a) => a?.dropFlag   ?? 0,
  'audio:phrasePos': (a) => a?.phrasePos  ?? 0,
  'audio:barMod16':  (a) => (a?.barMod16  ?? 0) / 16,  // normalize to 0..1
  'audio:beatMod4':  (a) => (a?.beatMod4  ?? 0) / 4,
  // Legacy bands for backward compat with old shaders
  'audio:bass':      (a) => a?.bass ?? 0,
  'audio:mid':       (a) => a?.mid  ?? 0,
  'audio:high':      (a) => a?.high ?? 0,
};

export const AUDIO_SOURCE_NAMES = Object.keys(AUDIO_SOURCES);

// ============================================================================
// LFO evaluation
// ============================================================================
// LFO id format: 'lfo:0', 'lfo:1', ... — index into state.lfos array.
// Each LFO has { id, wave, rate, phaseOffset, polarity }.
// Phase = (beatsElapsed / beatsPerCycle + phaseOffset) → wave evaluator.
export function evaluateLfo(lfo, audio) {
  if (!lfo) return 0;
  const bpm = audio?.bpm > 0 ? audio.bpm : 120;
  const t   = audio?.time ?? (performance.now() / 1000);
  const beatsPerCycle = RATE_LABELS[lfo.rate] ?? 1.0;
  const beatsElapsed  = t * (bpm / 60);
  const phi = beatsElapsed / beatsPerCycle + (lfo.phaseOffset ?? 0);
  const shape = SHAPES[lfo.wave] ?? SHAPES.sin;
  return shape(phi, lfo.id);  // 0..1
}

// ============================================================================
// Source evaluation (unified API)
// ============================================================================
// Source format: 'audio:<band>' or 'lfo:<index>'.
// Returns 0..1.
export function evaluateSource(sourceId, audio, lfos) {
  if (typeof sourceId !== 'string') return 0;
  if (sourceId.startsWith('audio:')) {
    const fn = AUDIO_SOURCES[sourceId];
    return fn ? fn(audio) : 0;
  }
  if (sourceId.startsWith('lfo:')) {
    const idx = parseInt(sourceId.slice(4), 10);
    if (Number.isFinite(idx) && lfos && lfos[idx]) {
      return evaluateLfo(lfos[idx], audio);
    }
  }
  return 0;
}

// ============================================================================
// Param path resolver
// ============================================================================
// Resolves "layers[2].audioIntensity" → state.layers[2] (the parent object)
// + key 'audioIntensity'. Supports nested .params.key and array indices.
// Returns { obj, key } or null if the path doesn't resolve.
export function resolveParamPath(state, path) {
  if (!state || !path || typeof path !== 'string') return null;
  // Split by . and [n] tokens.
  const tokens = [];
  const re = /([a-zA-Z_$][\w$]*)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1]);
    else tokens.push(parseInt(m[2], 10));
  }
  if (tokens.length === 0) return null;
  let cur = state;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (cur == null) return null;
    cur = cur[tokens[i]];
  }
  if (cur == null || typeof cur !== 'object') return null;
  return { obj: cur, key: tokens[tokens.length - 1] };
}

// ============================================================================
// Per-frame dispatcher
// ============================================================================
// Walks the bindings list, evaluates each source, and writes:
//   target = baseValue + (source × depth)             [polarity: uni, 0..1 source]
//   target = baseValue + ((source - 0.5) × 2 × depth) [polarity: bi, -1..1 source]
//
// `baseValue` is stored on each binding when it's created (snapshot of the
// param at bind time). Modulation is ADDITIVE on top of that base — it does
// not destroy the user's underlying slider value.
//
// If a binding's path doesn't resolve (layer deleted, etc), the binding is
// silently skipped (no auto-cleanup; operator can prune via UI).
export function applyMods(state, audio) {
  if (!state?.mods?.length) return;
  for (const binding of state.mods) {
    if (binding.enabled === false) continue;
    const resolved = resolveParamPath(state, binding.paramPath);
    if (!resolved) continue;
    const { obj, key } = resolved;
    const cur = obj[key];
    // Operator-drag-while-modulating detection: if the current value differs
    // from what we last wrote (within float tolerance), the operator must have
    // dragged the slider — update baseValue so modulation moves with the slider
    // instead of fighting it.
    if (
      typeof cur === 'number' &&
      binding._lastApplied !== undefined &&
      Math.abs(cur - binding._lastApplied) > 0.0001
    ) {
      binding.baseValue = cur;
    }
    const raw = evaluateSource(binding.source, audio, state.lfos);
    const polarity = binding.polarity ?? 'uni';
    const depth    = binding.depth ?? 0;
    const base     = binding.baseValue ?? 0;
    const offset = polarity === 'bi'
      ? (raw - 0.5) * 2 * depth
      : raw * depth;
    const newVal = base + offset;
    obj[key] = newVal;
    binding._lastApplied = newVal;
  }
}

// ============================================================================
// Convenience: snapshot the current value of a param as the binding's base
// ============================================================================
export function captureBaseValue(state, paramPath) {
  const r = resolveParamPath(state, paramPath);
  if (!r) return 0;
  const v = r.obj[r.key];
  return typeof v === 'number' ? v : 0;
}

// ============================================================================
// Default LFOs / empty mod (factory helpers)
// ============================================================================
export function emptyLfos() {
  return [
    { id: 'lfo:0', wave: 'sin', rate: '1/4',  phaseOffset: 0 },
    { id: 'lfo:1', wave: 'tri', rate: '1/2',  phaseOffset: 0 },
    { id: 'lfo:2', wave: 'saw', rate: '1bar', phaseOffset: 0 },
    { id: 'lfo:3', wave: 'sqr', rate: '1/8',  phaseOffset: 0 },
    { id: 'lfo:4', wave: 'sh',  rate: '1/4',  phaseOffset: 0 },
  ];
}

export function emptyMod(id, paramPath = '', source = 'audio:kick') {
  return {
    id,
    enabled: true,
    paramPath,
    source,
    depth: 0.5,
    polarity: 'uni',
    baseValue: 0,
  };
}
