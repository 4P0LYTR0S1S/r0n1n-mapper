import { initRegl, fitCanvas } from './core/regl-init.js';
import { createClock } from './core/clock.js';
import { makeChannel } from './sync/broadcast.js';
import { createStore } from './project/state.js';
import { emptyProject, emptySurface, emptyVideoLayer, emptyImageLayer, emptySolidLayer, migrate } from './project/schema.js';
import { loadProject, saveProject, autosaver, exportProjectFile, importProjectFile } from './storage/project-io.js';
import { ingestVideoFile, attachVideo } from './layers/video-layer.js';
import { ingestImageFile, attachImage } from './layers/image-layer.js';
import { attachSolid } from './layers/solid-layer.js';
import { attachWebcam, emptyWebcamLayer } from './layers/webcam-layer.js';
import { attachShader, emptyShaderLayer } from './layers/shader-layer.js';
import { attachHydra, emptyHydraLayer } from './layers/hydra-layer.js';
import { attachDancerImg, emptyDancerImgLayer, ingestPartImage, PART_KEYS, PART_LABELS } from './layers/dancer-img-layer.js?v=4';
import { attachTitle, emptyTitleLayer } from './layers/title-layer.js?v=1';
import { EFFECT_NAMES } from './layers/shader-effects.js?v=4';
import { initAudio, tap as tapTempo, listAudioInputs, currentAudioDeviceId } from './audio/analyser.js';
import { createAudioState } from './audio/uniforms.js';
import { emptySnapshot, captureSnapshot, applySnapshot, djMorph } from './project/snapshots.js';
import { emptyCue, createCueEngine } from './project/cues.js';
import { initMidi, midiInputs, setHandler, touchParam, startLearn, isLearning, cancelLearn, createDispatcher, clockBpm, clockRunning } from './input/midi.js';
// Expose clockBpm to the audio module so its computeBpm prefers MIDI Clock when live.
window.__r0n1n_midi = { clockBpm, clockRunning };
import { connect as oscConnect, disconnect as oscDisconnect, setStatusListener as setOscStatus, startOscLearn, isOscLearning, cancelOscLearn } from './input/osc.js';
import { createRecorder } from './io/recorder.js';
import { parseCube, uploadLutTexture } from './grade/lut.js';
import { putLut, getLut, listLuts } from './storage/idb.js';
import { newSurface, resetCorners, setCorner, setMeshPoint, resetMesh, resizeMesh } from './surface/surface.js';
import { attachDrag } from './surface/drag.js';
import { createPipeline } from './render/pipeline.js';
import { createOverlay } from './render/overlay.js';
import { BLEND_MODES } from './render/blend-modes.js';
import { KEY_MODES, defaultKey } from './keyer/keyer-glsl.js';

const $ = (id) => document.getElementById(id);

// Hoisted constants used by build functions that may fire during boot-time
// store subscribers, before their declaration site is reached.
const NUM_SLOTS = 16;

const canvas        = $('view');
const fpsEl         = $('fps');
const syncEl        = $('sync-state');
const btnAddSurface = $('btn-add-surface');
const btnOutput     = $('btn-output');
const btnSave       = $('btn-save');
const btnLoad       = $('btn-load');
const btnExport     = $('btn-export');
const btnAddVideo   = $('btn-add-video');
const btnAddImage   = $('btn-add-image');
const btnAddSolid   = $('btn-add-solid');
const fileVideo     = $('file-video');
const fileImage     = $('file-image');
const importFile    = $('import-file');
const emptyHint     = $('empty-hint');
const surfaceListEl = $('surface-list');
const layerStackEl  = $('layer-stack');
const propsEl       = $('surface-props');
const propName      = $('prop-name');
const propMode      = $('prop-mode');
const propGridX     = $('prop-gridx');
const propGridY     = $('prop-gridy');
const propOpacity   = $('prop-opacity');
const propZ         = $('prop-z');
const propVisible   = $('prop-visible');
const meshControls  = $('mesh-controls');
const btnResetWarp  = $('btn-reset-warp');
const btnResetMesh  = $('btn-reset-mesh');
const btnDelete     = $('btn-delete-surface');

// ---- bootstrap ----
const regl = initRegl(canvas);
const clock = createClock();
const ch = makeChannel('editor');
const pipeline = createPipeline(regl);
const overlay  = createOverlay(regl);
const restored = loadProject();
const store = createStore(restored ? migrate(restored) : emptyProject());

const layerRuntimes = new Map();   // layerId → runtime
const audioState = createAudioState(regl);
window.__r0n1n_audio = audioState;

// Cue engine — uses the same snapshot lookup the UI uses.
function findSnapshot(id) { return store.state.snapshots.find(s => s.id === id) ?? null; }
const cueEngine = createCueEngine(store, findSnapshot, attachLayerRuntime, layerRuntimes);

// Recorder targets the editor canvas.
const recorder = createRecorder(canvas, { fps: 60, bitrate: 8_000_000 });

// MIDI dispatcher (lazy-init on user gesture).
let midiReady = false;

// LUT manager — map of lutId → { texture, size, name }
const lutManager = new Map();
const getLutEntry = (id) => lutManager.get(id);

async function loadLutFile(file) {
  const text = await file.text();
  let parsed;
  try { parsed = parseCube(text); }
  catch (e) { console.error('[lut] parse', e); alert('Invalid .cube file: ' + e.message); return null; }
  const buffer = new TextEncoder().encode(text);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const id = 'lut_' + hash;
  await putLut(id, new Blob([text], { type: 'text/plain' }), file.name);
  const texture = uploadLutTexture(regl, parsed);
  lutManager.set(id, { texture, size: parsed.size, name: file.name });
  return id;
}

async function restoreLuts() {
  const records = await listLuts();
  for (const rec of records) {
    if (lutManager.has(rec.id)) continue;
    try {
      const text = await rec.blob.text();
      const parsed = parseCube(text);
      const texture = uploadLutTexture(regl, parsed);
      lutManager.set(rec.id, { texture, size: parsed.size, name: rec.name });
    } catch (e) { console.error('[lut] restore', rec.id, e); }
  }
}
restoreLuts();

async function attachLayerRuntime(layer) {
  switch (layer.type) {
    case 'video':  return attachVideo(regl, layer);
    case 'image':  return attachImage(regl, layer);
    case 'solid':  return attachSolid(regl, layer);
    case 'webcam': return attachWebcam(regl, layer);
    case 'shader': return attachShader(regl, layer, audioState);
    case 'hydra':  return attachHydra(regl, layer);
    case 'dancer-img': return attachDancerImg(regl, layer, audioState);
    case 'title': return attachTitle(regl, layer, audioState);
    default: throw new Error(`unknown layer type: ${layer.type}`);
  }
}

(async function bootRuntimes() {
  for (const layer of store.state.layers) {
    try {
      const rt = await attachLayerRuntime(layer);
      layerRuntimes.set(layer.id, rt);
    } catch (e) {
      console.error('[editor] attach failed', layer.id, e);
    }
  }
  syncUI();
})();

// ---- broadcast + autosave ----
let broadcastPending = false;
const autosave = autosaver(store);
store.subscribe(() => { broadcastPending = true; autosave(); syncUI(); });
function broadcastState() { ch.send('state:full', store.state); }

// ---- output handshake ----
let outputAlive = false;
let lastPong = 0;
ch.on((msg) => {
  if (msg.type === 'pong') { outputAlive = true; lastPong = performance.now(); }
  if (msg.type === 'hello' && msg.payload?.role === 'output') broadcastState();
  if (msg.type === 'request-state') broadcastState();
});

// ---- state accessors ----
function selectedSurface() {
  const id = store.state.ui.selectedSurfaceId;
  return id ? store.state.surfaces.find(s => s.id === id) ?? null : null;
}

function selectSurface(id) {
  store.update('', (st) => { st.ui.selectedSurfaceId = id; });
}

// ---- UI builders ----
// Drag-aware sync guard. When a user is actively dragging a slider, calling
// syncUI() rebuilds the sidebar DOM which destroys the slider element mid-drag
// — every input event would otherwise tear down the very element receiving
// the next event. While isDragging is true, syncUI() is skipped; pointerup
// flips the flag and triggers a single catch-up sync.
let isDragging = false;
let syncPending = false;
function syncUI() {
  if (isDragging) { syncPending = true; return; }
  emptyHint.style.display = store.state.surfaces.length ? 'none' : 'block';
  buildSurfaceList();
  buildSnapshotGrid();
  buildCueList();
  buildMidiBindings();
  buildOscBindings();
  buildDjDeckPickers();
  const sel = selectedSurface();
  if (!sel) { propsEl.hidden = true; return; }
  propsEl.hidden = false;

  if (document.activeElement !== propName)    propName.value    = sel.name;
  if (document.activeElement !== propOpacity) propOpacity.value = sel.opacity ?? 1;
  if (document.activeElement !== propZ)       propZ.value       = sel.z ?? 0;
  propVisible.checked = sel.visible !== false;
  propMode.value      = sel.warp.mode;
  meshControls.hidden = sel.warp.mode !== 'mesh';
  buildLutDropdown(sel);
  propLutIntensity.value = sel.grade?.intensity ?? 1.0;
  if (document.activeElement !== propGridX) propGridX.value = sel.warp.mesh.gridX;
  if (document.activeElement !== propGridY) propGridY.value = sel.warp.mesh.gridY;
  btnResetWarp.textContent = sel.warp.mode === 'mesh' ? 'reset quad' : 'reset quad';

  buildLayerStack(sel);
}

function buildSurfaceList() {
  surfaceListEl.innerHTML = '';
  const selId = store.state.ui.selectedSurfaceId;
  for (const surf of store.state.surfaces) {
    const li = document.createElement('li');
    if (surf.id === selId) li.classList.add('selected');
    const name = document.createElement('span');
    name.textContent = surf.name;
    const meta = document.createElement('span');
    meta.className = 'ltype';
    meta.textContent = `${surf.warp.mode} · ${surf.layerIds.length}L`;
    li.appendChild(name); li.appendChild(meta);
    li.onclick = () => selectSurface(surf.id);
    surfaceListEl.appendChild(li);
  }
}

function buildLayerStack(surface) {
  layerStackEl.innerHTML = '';
  const ids = surface.layerIds;
  for (let i = 0; i < ids.length; i++) {
    const layer = store.state.layers.find(l => l.id === ids[i]);
    if (!layer) continue;
    layerStackEl.appendChild(buildLayerRow(surface, layer, i));
  }
}

function buildLayerRow(surface, layer, indexInStack) {
  const li = document.createElement('li');

  const head = document.createElement('div');
  head.className = 'lhead';
  const visBtn = document.createElement('button');
  visBtn.textContent = layer.enabled !== false ? '◉' : '◯';
  visBtn.title = 'toggle visible';
  visBtn.onclick = () => store.update('', () => { layer.enabled = layer.enabled === false; });
  const nameEl = document.createElement('span');
  nameEl.className = 'lname';
  nameEl.textContent = layer.name;
  const typeEl = document.createElement('span');
  typeEl.className = 'ltype';
  typeEl.textContent = layer.type;
  const ctrls = document.createElement('span');
  ctrls.className = 'lcontrols';
  const upBtn = document.createElement('button');
  upBtn.textContent = '↑'; upBtn.disabled = indexInStack === surface.layerIds.length - 1;
  upBtn.onclick = () => moveLayer(surface, indexInStack, +1);
  const dnBtn = document.createElement('button');
  dnBtn.textContent = '↓'; dnBtn.disabled = indexInStack === 0;
  dnBtn.onclick = () => moveLayer(surface, indexInStack, -1);
  const rmBtn = document.createElement('button');
  rmBtn.textContent = '×'; rmBtn.className = 'danger';
  rmBtn.onclick = () => removeLayer(surface, layer);
  ctrls.append(upBtn, dnBtn, rmBtn);
  head.append(visBtn, nameEl, typeEl, ctrls);

  const props = document.createElement('div');
  props.className = 'lprops';
  props.append(label('blend'), blendSelect(layer));
  props.append(label('opacity'), opacityRange(layer));
  if (layer.type === 'solid') {
    props.append(label('color'), colorInput(layer));
  }

  li.append(head, props);

  if (layer.type === 'video' || layer.type === 'webcam') {
    li.append(buildKeyControls(layer));
  }
  if (layer.type === 'shader') {
    li.append(buildShaderControls(layer));
  }
  if (layer.type === 'hydra') {
    li.append(buildHydraControls(layer));
  }
  if (layer.type === 'dancer-img') {
    li.append(buildDancerImgControls(layer));
  }
  if (layer.type === 'title') {
    li.append(buildTitleControls(layer));
  }
  return li;
}

function buildTitleControls(layer) {
  const wrap = document.createElement('div');
  wrap.className = 'lkey';

  // text content (single-line input)
  const textLbl = document.createElement('span');
  textLbl.textContent = 'text';
  textLbl.style.cssText = 'grid-column: 1 / -1; opacity:0.6;';
  wrap.append(textLbl);

  const textIn = document.createElement('input');
  textIn.type = 'text';
  textIn.value = layer.text;
  textIn.style.cssText = 'grid-column: 1 / -1; min-width:0; background:#15151d; color:#ddd; border:1px solid #2a2a30; padding:3px 6px; font-family:monospace; font-size:11px;';
  let textTimer = null;
  textIn.oninput = () => {
    if (textTimer) clearTimeout(textTimer);
    textTimer = setTimeout(() => store.update('', () => { layer.text = textIn.value; }), 200);
  };
  wrap.append(textIn);

  // font + reveal mode side by side
  wrap.append(label('font'));
  const fontSel = document.createElement('select');
  for (const f of ['monospace', 'serif', 'sans-serif', 'Courier New', 'Georgia', 'Helvetica', 'Impact']) {
    const opt = document.createElement('option');
    opt.value = f; opt.textContent = f;
    if (f === layer.font) opt.selected = true;
    fontSel.appendChild(opt);
  }
  fontSel.onchange = () => store.update('', () => { layer.font = fontSel.value; });
  wrap.append(fontSel);

  wrap.append(label('reveal'));
  const modeSel = document.createElement('select');
  for (const [val, name] of [[0,'instant'],[1,'char-by-char'],[2,'word-by-word'],[3,'fade-in']]) {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = name;
    if (val === layer.revealMode) opt.selected = true;
    modeSel.appendChild(opt);
  }
  modeSel.onchange = () => store.update('', () => { layer.revealMode = +modeSel.value; });
  wrap.append(modeSel);

  wrap.append(label('font size'));
  wrap.append(rangeInput(layer, 'fontSize', 24, 240, 2));
  wrap.append(label('reveal speed'));
  wrap.append(rangeInput(layer, 'revealSpeed', 0.5, 16, 0.5));

  wrap.append(label('scale'));
  wrap.append(rangeInput(layer, 'scale', 0.2, 3.0, 0.05));
  wrap.append(label('rotation°'));
  wrap.append(rangeInput(layer, 'rotation', -180, 180, 1));

  wrap.append(label('x pos'));
  wrap.append(rangeInput(layer, 'xPos', 0, 1, 0.005));
  wrap.append(label('y pos'));
  wrap.append(rangeInput(layer, 'yPos', 0, 1, 0.005));

  wrap.append(label('glow'));
  wrap.append(rangeInput(layer, 'glow', 0, 3, 0.05));
  wrap.append(label('Audio Reactivity'));
  wrap.append(rangeInput(layer, 'audioIntensity', 0, 3, 0.05));

  wrap.append(label('color'));
  wrap.append(colorArrInput(layer, 'color'));
  wrap.append(label('glow color'));
  wrap.append(colorArrInput(layer, 'glowColor'));

  return wrap;
}

function buildDancerImgControls(layer) {
  const wrap = document.createElement('div');
  wrap.className = 'lkey';
  const filePartInput = $('file-dancer-part');

  // Per-part collapsible blocks. Each <details> spans both columns of the
  // .lkey grid. Summary row = label + upload button + filename + flip toggles.
  // Expanded body = rotation / scale / width / offsetX/Y sliders.
  for (const key of PART_KEYS) {
    if (layer.parts[key].rotation === undefined) layer.parts[key].rotation = 0;
    if (layer.parts[key].scale === undefined) layer.parts[key].scale = 1.0;
    if (layer.parts[key].widthScale === undefined) layer.parts[key].widthScale = 1.0;
    if (layer.parts[key].offsetX === undefined) layer.parts[key].offsetX = 0;
    if (layer.parts[key].offsetY === undefined) layer.parts[key].offsetY = 0;
    if (layer.parts[key].flipX === undefined) layer.parts[key].flipX = false;
    if (layer.parts[key].flipY === undefined) layer.parts[key].flipY = false;

    const det = document.createElement('details');
    det.style.cssText = 'grid-column: 1 / -1; min-width:0; margin:2px 0; border:1px solid #2a2a30; border-radius:3px; padding:2px 4px;';

    const sum = document.createElement('summary');
    sum.style.cssText = 'display:flex; align-items:center; gap:8px; cursor:pointer; list-style:none;';

    const lbl = document.createElement('span');
    lbl.textContent = PART_LABELS[key];
    lbl.style.cssText = 'min-width:60px; font-size:11px; opacity:0.7;';
    sum.append(lbl);

    const btn = document.createElement('button');
    btn.textContent = layer.parts[key]?.imageId ? 'replace' : 'upload';
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!filePartInput) return;
      filePartInput.value = '';
      const onChange = async () => {
        filePartInput.removeEventListener('change', onChange);
        const file = filePartInput.files?.[0];
        if (!file) return;
        try {
          await ingestPartImage(layer, key, file);
          const rt = layerRuntimes.get(layer.id);
          if (rt?.reloadPart) {
            await rt.reloadPart(key);
          } else {
            try { rt?.dispose?.(); } catch {}
            layerRuntimes.set(layer.id, await attachDancerImg(regl, layer, audioState));
          }
          store.update('', () => {});
        } catch (e) {
          console.error('[dancer-img] upload failed', key, e);
          alert('upload failed: ' + e.message);
        }
      };
      filePartInput.addEventListener('change', onChange);
      filePartInput.click();
    };
    sum.append(btn);

    const name = document.createElement('span');
    name.textContent = layer.parts[key]?.name || '(empty)';
    name.style.cssText = 'font-size:10px; opacity:0.5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0;';
    sum.append(name);

    det.append(sum);

    // Expanded body — per-part transform controls
    const body = document.createElement('div');
    body.style.cssText = 'display:grid; grid-template-columns: 1fr 1fr; gap:4px 6px; padding:6px 0 4px 4px; font-size:10px;';

    function addRow(text, ctrl) {
      const l = document.createElement('span');
      l.textContent = text;
      l.style.cssText = 'opacity:0.6; align-self:center;';
      body.append(l, ctrl);
    }

    addRow('rotation°',  rangeInput(layer.parts[key], 'rotation',   -180, 180, 1));
    addRow('length',     rangeInput(layer.parts[key], 'scale',      0.3,  2.5, 0.05));
    addRow('width',      rangeInput(layer.parts[key], 'widthScale', 0.3,  2.5, 0.05));
    addRow('offset x',   rangeInput(layer.parts[key], 'offsetX',    -0.3, 0.3, 0.005));
    addRow('offset y',   rangeInput(layer.parts[key], 'offsetY',    -0.3, 0.3, 0.005));
    // splitV only meaningful for arms/legs in v2 bend mode — where the
    // elbow/knee is in the source image. Hidden for head + torso (no bend).
    if (key === 'armL' || key === 'armR' || key === 'legL' || key === 'legR') {
      if (layer.parts[key].splitV === undefined) layer.parts[key].splitV = 0.5;
      addRow('split v',  rangeInput(layer.parts[key], 'splitV', 0.2, 0.8, 0.01));
    }

    // Flip checkboxes side-by-side
    const flipRow = document.createElement('div');
    flipRow.style.cssText = 'grid-column: 1 / -1; display:flex; gap:14px; padding:2px 0;';
    for (const axis of ['flipX', 'flipY']) {
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex; align-items:center; gap:4px; cursor:pointer;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!layer.parts[key][axis];
      cb.onchange = () => store.update('', () => { layer.parts[key][axis] = cb.checked; });
      lab.append(cb);
      const span = document.createElement('span');
      span.textContent = axis;
      lab.append(span);
      flipRow.append(lab);
    }
    body.append(flipRow);

    det.append(body);
    wrap.append(det);
  }

  wrap.append(label('Audio Reactivity'));
  if (layer.audioIntensity === undefined) layer.audioIntensity = 1.0;
  wrap.append(rangeInput(layer, 'audioIntensity', 0, 3, 0.05));

  wrap.append(label('width head'));
  wrap.append(rangeInput(layer, 'widthHead', 0.02, 0.30, 0.005));
  wrap.append(label('width limb'));
  wrap.append(rangeInput(layer, 'widthLimb', 0.02, 0.20, 0.005));
  wrap.append(label('width torso'));
  wrap.append(rangeInput(layer, 'widthTorso', 0.04, 0.30, 0.005));

  // v2 bend mode toggle — arms split shoulder→elbow→wrist, legs hip→knee→ankle
  if (layer.bendLimbs === undefined) layer.bendLimbs = true;
  const bendRow = document.createElement('div');
  bendRow.style.cssText = 'grid-column: 1 / -1; display:flex; align-items:center; gap:6px; padding:4px 0; font-size:11px;';
  const bendLab = document.createElement('label');
  bendLab.style.cssText = 'display:flex; align-items:center; gap:4px; cursor:pointer; opacity:0.85;';
  const bendCB = document.createElement('input');
  bendCB.type = 'checkbox';
  bendCB.checked = !!layer.bendLimbs;
  bendCB.onchange = () => store.update('', () => { layer.bendLimbs = bendCB.checked; });
  bendLab.append(bendCB);
  const bendSpan = document.createElement('span');
  bendSpan.textContent = 'bend limbs (split at elbow/knee)';
  bendLab.append(bendSpan);
  bendRow.append(bendLab);
  wrap.append(bendRow);

  wrap.append(label('bg'));
  wrap.append(colorArrInput(layer, 'bg'));

  return wrap;
}

function buildShaderControls(layer) {
  const wrap = document.createElement('div');
  wrap.className = 'lkey';
  wrap.append(label('effect'));

  const sel = document.createElement('select');
  for (const name of EFFECT_NAMES) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === layer.effect) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    store.update('', () => {
      layer.effect = sel.value;
      // re-init params to defaults of new effect
      import('./layers/shader-effects.js?v=4').then(m => {
        layer.params = structuredClone(m.EFFECTS[sel.value].defaultParams);
        // re-attach runtime
        const old = layerRuntimes.get(layer.id);
        if (old) old.dispose?.();
        layerRuntimes.set(layer.id, attachShader(regl, layer, audioState));
        syncUI();
      });
    });
  };
  wrap.append(sel);

  // audio reactivity intensity — scales u_bass/mid/high/env going into the shader
  wrap.append(label('Audio Reactivity'));
  if (layer.audioIntensity === undefined) layer.audioIntensity = 1.0;
  wrap.append(rangeInput(layer, 'audioIntensity', 0, 3, 0.05));

  // params from current effect's schema
  import('./layers/shader-effects.js?v=4').then(m => {
    const schema = m.EFFECTS[layer.effect]?.schema || [];
    for (const s of schema) {
      wrap.append(label(s.key));
      if (s.type === 'range') {
        wrap.append(rangeInput(layer.params, s.key, s.min, s.max, s.step));
      } else if (s.type === 'color') {
        wrap.append(colorArrInput(layer.params, s.key));
      }
    }
  });
  return wrap;
}

function colorArrInput(obj, key) {
  const i = document.createElement('input');
  i.type = 'color';
  const c = obj[key] ?? [1, 1, 1];
  i.value = '#' + c.slice(0, 3).map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  i.oninput = () => {
    const hex = i.value.slice(1);
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    store.update('', () => { obj[key] = [r, g, b]; });
  };
  return i;
}

function buildHydraControls(layer) {
  const wrap = document.createElement('div');
  wrap.className = 'lkey';
  wrap.append(label('code'));
  const ta = document.createElement('textarea');
  ta.value = layer.code;
  ta.rows = 4;
  ta.style.cssText = 'width:100%; font-family: ui-monospace, monospace; font-size: 10px; background: #0a0a10; color: #d7d7df; border: 1px solid #1a1a22; padding: 4px;';
  let timer = null;
  ta.oninput = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => store.update('', () => { layer.code = ta.value; }), 300);
  };
  wrap.append(ta);
  return wrap;
}

function buildKeyControls(layer) {
  if (!layer.key) layer.key = defaultKey();
  const wrap = document.createElement('div');
  wrap.className = 'lkey';
  wrap.append(label('key'));

  const sel = document.createElement('select');
  for (const m of KEY_MODES) {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    if (m === layer.key.mode) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => store.update('', () => { layer.key.mode = sel.value; });
  wrap.append(sel);

  if (layer.key.mode === 'luma') {
    const low  = rangeInput(layer.key, 'low',  0, 1, 0.005);
    const high = rangeInput(layer.key, 'high', 0, 1, 0.005);
    wrap.append(label('low'), low, label('high'), high);
  } else if (layer.key.mode === 'chroma') {
    const color = document.createElement('input');
    color.type = 'color';
    const c = layer.key.color ?? [0, 1, 0];
    color.value = '#' + c.slice(0, 3).map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    color.oninput = () => {
      const hex = color.value.slice(1);
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;
      store.update('', () => { layer.key.color = [r, g, b]; });
    };
    const similarity = rangeInput(layer.key, 'low',   0, 1,    0.005);
    const smoothness = rangeInput(layer.key, 'high',  0, 1.4,  0.005);
    const spill      = rangeInput(layer.key, 'spill', 0, 1,    0.005);
    wrap.append(label('color'), color, label('similarity'), similarity, label('smoothness'), smoothness, label('spill'), spill);
  }
  return wrap;
}

function rangeInput(obj, prop, min, max, step) {
  const i = document.createElement('input');
  i.type = 'range'; i.min = min; i.max = max; i.step = step;
  i.value = obj[prop] ?? min;
  attachDragGuard(i);
  i.oninput = () => store.update('', () => { obj[prop] = +i.value; });
  return i;
}

// Marks the slider as actively dragged so syncUI() can skip rebuilding the
// sidebar mid-drag (which would tear the slider out of the DOM and kill the
// drag). On pointerup, flips the flag back and runs a deferred sync if one
// was suppressed during the drag.
function attachDragGuard(input) {
  const onDown = () => { isDragging = true; };
  const onUp   = () => {
    if (!isDragging) return;
    isDragging = false;
    if (syncPending) { syncPending = false; syncUI(); }
  };
  input.addEventListener('pointerdown', onDown);
  // pointerup may fire outside the slider (drag-release-off-element), so
  // listen on window for the release.
  window.addEventListener('pointerup', onUp);
  // keyboard arrows: change events fire on key release; no drag guard needed
  // beyond the click already focusing the element. Arrow keys work natively.
}
function label(text) { const s = document.createElement('span'); s.textContent = text; return s; }
function blendSelect(layer) {
  const sel = document.createElement('select');
  for (const m of BLEND_MODES) {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    if (m === (layer.blendMode ?? 'normal')) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = () => store.update('', () => { layer.blendMode = sel.value; });
  return sel;
}
function opacityRange(layer) {
  const i = document.createElement('input');
  i.type = 'range'; i.min = 0; i.max = 1; i.step = 0.01; i.value = layer.opacity ?? 1;
  attachDragGuard(i);
  i.oninput = () => {
    const layerIdx = store.state.layers.indexOf(layer);
    touchParam(`/layers/${layerIdx}/opacity`);
    store.update('', () => { layer.opacity = +i.value; });
  };
  return i;
}
function colorInput(layer) {
  const i = document.createElement('input');
  i.type = 'color';
  const c = layer.color || [1, 1, 1, 1];
  i.value = '#' + [c[0], c[1], c[2]].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  i.oninput = () => {
    const hex = i.value.slice(1);
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    store.update('', () => { layer.color = [r, g, b, c[3] ?? 1]; });
  };
  return i;
}

// ---- layer mutations ----
function moveLayer(surface, indexInStack, dir) {
  store.update('', () => {
    const ids = surface.layerIds;
    const j = indexInStack + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[indexInStack], ids[j]] = [ids[j], ids[indexInStack]];
  });
}
function removeLayer(surface, layer) {
  store.update('', (st) => {
    surface.layerIds = surface.layerIds.filter(id => id !== layer.id);
    // remove the layer record + runtime if no other surface references it
    if (!st.surfaces.some(s => s.layerIds.includes(layer.id))) {
      st.layers = st.layers.filter(l => l.id !== layer.id);
      const rt = layerRuntimes.get(layer.id);
      if (rt) { rt.dispose?.(); layerRuntimes.delete(layer.id); }
    }
  });
}

// ---- surface props bindings ----
propName.oninput     = () => store.update('', () => { const s = selectedSurface(); if (s) s.name = propName.value; });
propOpacity.oninput  = () => {
  const sel = selectedSurface();
  if (!sel) return;
  const idx = store.state.surfaces.indexOf(sel);
  touchParam(`/surfaces/${idx}/opacity`);
  store.update('', () => { sel.opacity = +propOpacity.value; });
};
propZ.oninput        = () => store.update('', () => { const s = selectedSurface(); if (s) s.z = +propZ.value; });
propVisible.onchange = () => store.update('', () => { const s = selectedSurface(); if (s) s.visible = propVisible.checked; });
propMode.onchange    = () => store.update('', () => { const s = selectedSurface(); if (s) s.warp.mode = propMode.value; });
propGridX.oninput    = () => store.update('', () => { const s = selectedSurface(); if (s) resizeMesh(s, +propGridX.value, s.warp.mesh.gridY); });
propGridY.oninput    = () => store.update('', () => { const s = selectedSurface(); if (s) resizeMesh(s, s.warp.mesh.gridX, +propGridY.value); });
btnResetWarp.onclick = () => store.update('', () => { const s = selectedSurface(); if (s) resetCorners(s); });
btnResetMesh.onclick = () => store.update('', () => { const s = selectedSurface(); if (s) resetMesh(s); });
btnDelete.onclick    = () => deleteSelectedSurface();

// 3D LUT controls
const propLut          = document.getElementById('prop-lut');
const propLutIntensity = document.getElementById('prop-lut-intensity');
const btnLoadLut       = document.getElementById('btn-load-lut');
const btnClearLut      = document.getElementById('btn-clear-lut');
const fileLut          = document.getElementById('file-lut');

btnLoadLut.onclick = () => fileLut.click();
fileLut.onchange = async () => {
  const f = fileLut.files[0];
  if (!f) return;
  const id = await loadLutFile(f);
  if (id) {
    const sel = selectedSurface();
    if (sel) store.update('', () => { sel.grade.lutId = id; });
    syncUI();
  }
  fileLut.value = '';
};
btnClearLut.onclick = () => store.update('', () => { const s = selectedSurface(); if (s) s.grade.lutId = null; });
propLut.onchange = () => store.update('', () => {
  const s = selectedSurface();
  if (!s) return;
  s.grade.lutId = propLut.value || null;
});
propLutIntensity.oninput = () => store.update('', () => {
  const s = selectedSurface();
  if (s) s.grade.intensity = +propLutIntensity.value;
});

function buildLutDropdown(sel) {
  propLut.innerHTML = '<option value="">— no LUT —</option>';
  for (const [id, entry] of lutManager) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = entry.name;
    if (sel && sel.grade?.lutId === id) opt.selected = true;
    propLut.appendChild(opt);
  }
}

function deleteSelectedSurface() {
  const id = store.state.ui.selectedSurfaceId;
  if (!id) return;
  store.update('', (st) => {
    const surf = st.surfaces.find(s => s.id === id);
    if (!surf) return;
    const orphanLayerIds = new Set(surf.layerIds);
    st.surfaces = st.surfaces.filter(s => s.id !== id);
    // collect ids still referenced
    for (const s of st.surfaces) for (const lid of s.layerIds) orphanLayerIds.delete(lid);
    for (const orphan of orphanLayerIds) {
      st.layers = st.layers.filter(l => l.id !== orphan);
      const rt = layerRuntimes.get(orphan);
      if (rt) { rt.dispose?.(); layerRuntimes.delete(orphan); }
    }
    st.ui.selectedSurfaceId = st.surfaces[0]?.id ?? null;
  });
}

// ---- add surface / layer ----
btnAddSurface.onclick = () => {
  const id = 'surf_' + crypto.randomUUID().slice(0, 8);
  store.update('', (st) => {
    st.surfaces.push(newSurface(id, null, { name: 'surface ' + (st.surfaces.length + 1) }));
    st.ui.selectedSurfaceId = id;
  });
};

async function addVideoLayer(file) {
  const layerId = 'layer_' + crypto.randomUUID().slice(0, 8);
  let layer;
  try { layer = await ingestVideoFile(layerId, file); }
  catch (e) { console.error('[editor] video ingest', e); return; }
  let rt;
  try { rt = await attachVideo(regl, layer); }
  catch (e) { console.error('[editor] video attach', e); return; }
  layerRuntimes.set(layer.id, rt);
  addLayerToSelectedOrNewSurface(layer);
}

async function addImageLayer(file) {
  const layerId = 'layer_' + crypto.randomUUID().slice(0, 8);
  let layer;
  try { layer = await ingestImageFile(layerId, file); }
  catch (e) { console.error('[editor] image ingest', e); return; }
  let rt;
  try { rt = await attachImage(regl, layer); }
  catch (e) { console.error('[editor] image attach', e); return; }
  layerRuntimes.set(layer.id, rt);
  addLayerToSelectedOrNewSurface(layer);
}

function addSolidLayer() {
  const layerId = 'layer_' + crypto.randomUUID().slice(0, 8);
  const layer = emptySolidLayer(layerId, [1, 0.2, 0.4, 1]);
  const rt = attachSolid(regl, layer);
  layerRuntimes.set(layer.id, rt);
  addLayerToSelectedOrNewSurface(layer);
}

async function addWebcamLayer() {
  const layerId = 'layer_' + crypto.randomUUID().slice(0, 8);
  const layer = emptyWebcamLayer(layerId);
  let rt;
  try { rt = await attachWebcam(regl, layer); }
  catch (e) { console.error('[editor] webcam attach', e); alert('webcam access denied or unavailable'); return; }
  layerRuntimes.set(layer.id, rt);
  layer.name = `webcam ${rt.video.videoWidth}×${rt.video.videoHeight}`;
  addLayerToSelectedOrNewSurface(layer);
}

function addShaderLayer(effect = 'fbm') {
  const layerId = 'layer_' + crypto.randomUUID().slice(0, 8);
  const layer = emptyShaderLayer(layerId, effect);
  const rt = attachShader(regl, layer, audioState);
  layerRuntimes.set(layer.id, rt);
  addLayerToSelectedOrNewSurface(layer);
}

async function addHydraLayer() {
  const layerId = 'layer_' + crypto.randomUUID().slice(0, 8);
  const layer = emptyHydraLayer(layerId);
  let rt;
  try { rt = await attachHydra(regl, layer); }
  catch (e) { console.error('[editor] hydra attach', e); alert('hydra-synth load failed: ' + e.message); return; }
  layerRuntimes.set(layer.id, rt);
  addLayerToSelectedOrNewSurface(layer);
}

async function addDancerImgLayer() {
  const layerId = 'layer_' + crypto.randomUUID().slice(0, 8);
  const layer = emptyDancerImgLayer(layerId);
  let rt;
  try { rt = await attachDancerImg(regl, layer, audioState); }
  catch (e) { console.error('[editor] dancer-img attach', e); alert('dancer-img attach failed: ' + e.message); return; }
  layerRuntimes.set(layer.id, rt);
  addLayerToSelectedOrNewSurface(layer);
}

async function addTitleLayer() {
  const layerId = 'layer_' + crypto.randomUUID().slice(0, 8);
  const layer = emptyTitleLayer(layerId);
  let rt;
  try { rt = await attachTitle(regl, layer, audioState); }
  catch (e) { console.error('[editor] title attach', e); alert('title attach failed: ' + e.message); return; }
  layerRuntimes.set(layer.id, rt);
  addLayerToSelectedOrNewSurface(layer);
}

function addLayerToSelectedOrNewSurface(layer) {
  store.update('', (st) => {
    st.layers.push(layer);
    let surf = selectedSurface();
    if (!surf) {
      const sid = 'surf_' + crypto.randomUUID().slice(0, 8);
      surf = newSurface(sid, layer.id, { name: layer.name });
      st.surfaces.push(surf);
      st.ui.selectedSurfaceId = sid;
    } else {
      surf.layerIds.push(layer.id);
    }
  });
}

btnAddVideo.onclick = () => fileVideo.click();
btnAddImage.onclick = () => fileImage.click();
btnAddSolid.onclick = () => addSolidLayer();
const btnAddWebcam = document.getElementById('btn-add-webcam');
const btnAddShader = document.getElementById('btn-add-shader');
const btnAddHydra  = document.getElementById('btn-add-hydra');
const selShader    = document.getElementById('shader-effect');
const btnAudio     = document.getElementById('btn-enable-audio');
if (btnAddWebcam) btnAddWebcam.onclick = () => addWebcamLayer();
if (btnAddShader) btnAddShader.onclick = () => addShaderLayer(selShader?.value || 'fbm');
if (btnAddHydra)  btnAddHydra.onclick  = () => addHydraLayer();
const btnAddDancerImg = document.getElementById('btn-add-dancer-img');
if (btnAddDancerImg) btnAddDancerImg.onclick = () => addDancerImgLayer();
const btnAddTitle = document.getElementById('btn-add-title');
if (btnAddTitle) btnAddTitle.onclick = () => addTitleLayer();

// Output resolution dropdown — controls the canvas backing-buffer size on the
// output tab (decouples it from window size, needed for projector / Chromecast
// / OBS NDI native-resolution pipelines).
const selOutputRes = document.getElementById('output-res');
if (selOutputRes) {
  // initial: reflect current state.output
  const initStr = (() => {
    const o = store.state.output ?? { mode: 'fit' };
    return o.mode === 'fixed' ? `${o.width}x${o.height}` : 'fit';
  })();
  selOutputRes.value = initStr;
  selOutputRes.onchange = () => {
    const v = selOutputRes.value;
    store.update('', (st) => {
      if (v === 'fit') st.output = { mode: 'fit', width: 1920, height: 1080 };
      else {
        const [w, h] = v.split('x').map(Number);
        st.output = { mode: 'fixed', width: w, height: h };
      }
    });
    broadcastState();
  };
}
if (selShader) {
  selShader.innerHTML = '';
  for (const name of EFFECT_NAMES) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    selShader.appendChild(opt);
  }
}
const audioDeviceSel = document.getElementById('audio-device');
async function refreshAudioDevices() {
  if (!audioDeviceSel) return;
  const inputs = await listAudioInputs();
  // Always show the picker once audio is engaged so the user can verify
  // which device is captured (and pick a Stereo Mix / loopback if available).
  audioDeviceSel.hidden = inputs.length === 0;
  audioDeviceSel.innerHTML = '';
  const cur = currentAudioDeviceId();
  // 'default' option lets the OS pick (matches getUserMedia({audio:true}) behavior)
  const defOpt = document.createElement('option');
  defOpt.value = ''; defOpt.textContent = 'default';
  if (!cur || cur === 'default') defOpt.selected = true;
  audioDeviceSel.appendChild(defOpt);
  for (const d of inputs) {
    const opt = document.createElement('option');
    opt.value = d.id; opt.textContent = d.label;
    if (d.id === cur) opt.selected = true;
    audioDeviceSel.appendChild(opt);
  }
}

if (btnAudio) {
  btnAudio.onclick = async () => {
    try {
      const saved = store.state.audio?.deviceId || null;
      await initAudio(saved);
      btnAudio.textContent = '🎤 live';
      btnAudio.disabled = false; // stays clickable for re-prompt if needed
      await refreshAudioDevices();
    } catch (e) {
      console.error('[editor] audio init', e);
      alert('audio access denied: ' + e.message);
    }
  };
}

if (audioDeviceSel) {
  audioDeviceSel.onchange = async () => {
    const id = audioDeviceSel.value || null;
    try {
      await initAudio(id);
      store.update('', (st) => { st.audio.deviceId = id; });
    } catch (e) {
      console.error('[editor] audio swap', e);
      alert('audio source swap failed: ' + e.message);
      await refreshAudioDevices(); // revert UI to actual state
    }
  };
}

// Tap tempo on spacebar; N/P to cue advance/prev; 1-9 to recall snapshot,
// Shift+1-9 to save into that slot.
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); tapTempo(); }
  else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); cueEngine.advance(); }
  else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); cueEngine.previous(); }
  else if (/^Digit[1-9]$/.test(e.code)) {
    const slot = +e.code.slice(5) - 1;  // 0-8
    e.preventDefault();
    if (e.shiftKey) saveToSlot(slot);
    else recallSlot(slot);
  }
});

// ---- snapshots ----
function ensureSlots() {
  store.update('', (st) => {
    while (st.snapshots.length < NUM_SLOTS) {
      st.snapshots.push(emptySnapshot('snap_' + crypto.randomUUID().slice(0, 8), st.snapshots.length));
    }
  });
}
ensureSlots();

function buildSnapshotGrid() {
  const grid = document.getElementById('snapshot-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < NUM_SLOTS; i++) {
    const slot = store.state.snapshots[i];
    const btn = document.createElement('button');
    btn.textContent = String(i + 1).padStart(2, '0');
    btn.title = slot?.savedAt ? `${slot.name} · saved ${new Date(slot.savedAt).toLocaleTimeString()}` : 'empty';
    btn.className = slot?.state ? 'filled' : 'empty';
    btn.onclick = (ev) => {
      if (ev.shiftKey) saveToSlot(i);
      else if (ev.altKey) clearSlot(i);
      else recallSlot(i);
    };
    grid.appendChild(btn);
  }
}

function saveToSlot(i) {
  const id = store.state.snapshots[i]?.id || ('snap_' + crypto.randomUUID().slice(0, 8));
  const snap = captureSnapshot(store.state, id);
  store.update('', (st) => { st.snapshots[i] = { ...snap, name: `slot ${i + 1}` }; });
}

function clearSlot(i) {
  store.update('', (st) => {
    st.snapshots[i] = emptySnapshot('snap_' + crypto.randomUUID().slice(0, 8), i);
  });
}

async function recallSlot(i) {
  const snap = store.state.snapshots[i];
  if (!snap?.state) return;
  // diff layer set; attach newly-introduced runtimes / dispose orphans
  const oldIds = new Set(store.state.layers.map(l => l.id));
  const newIds = new Set(snap.state.layers.map(l => l.id));
  const toAdd = [...newIds].filter(id => !oldIds.has(id));
  const toRemove = [...oldIds].filter(id => !newIds.has(id));

  store.update('', (st) => { applySnapshot(st, snap); });

  for (const id of toRemove) {
    const rt = layerRuntimes.get(id);
    if (rt) { rt.dispose?.(); layerRuntimes.delete(id); }
  }
  for (const id of toAdd) {
    const layer = store.state.layers.find(l => l.id === id);
    if (!layer) continue;
    try { layerRuntimes.set(id, await attachLayerRuntime(layer)); }
    catch (e) { console.error('[snapshot] re-attach', e); }
  }
}

// ---- cue list ----
const btnCueAdd  = document.getElementById('btn-cue-add');
const btnCueNext = document.getElementById('btn-cue-next');
const btnCuePrev = document.getElementById('btn-cue-prev');
const cueList    = document.getElementById('cue-list');
const cueStatus  = document.getElementById('cue-status');

btnCueAdd.onclick = () => {
  // Find a snapshot slot the user has filled most recently. Fallback: save current to slot 0 first.
  const filled = store.state.snapshots.filter(s => s.state).slice(-1)[0];
  if (!filled) { alert('No snapshot to add. Shift-click a snapshot slot first.'); return; }
  store.update('', (st) => { st.cues.push(emptyCue(filled.id, 1000)); });
};
btnCueNext.onclick = () => cueEngine.advance();
btnCuePrev.onclick = () => cueEngine.previous();

function buildCueList() {
  const el = document.getElementById('cue-list');
  if (!el) return;
  el.innerHTML = '';
  store.state.cues.forEach((cue, i) => {
    const snap = findSnapshot(cue.snapshotId);
    const li = document.createElement('li');
    if (i === cueEngine.index) li.classList.add('active');
    const name = document.createElement('span');
    name.className = 'cname';
    name.textContent = `${i + 1}. ${snap?.name || '(missing)'}`;
    name.onclick = () => cueEngine.goto(i);
    const xfade = document.createElement('input');
    xfade.type = 'number'; xfade.min = 0; xfade.max = 60000; xfade.step = 100;
    xfade.value = cue.crossfadeMs;
    xfade.oninput = () => store.update('', () => { cue.crossfadeMs = +xfade.value; });
    const del = document.createElement('button');
    del.textContent = '×'; del.className = 'danger';
    del.onclick = () => store.update('', (st) => { st.cues.splice(i, 1); });
    li.append(name, xfade, del);
    el.appendChild(li);
  });
  const status = document.getElementById('cue-status');
  if (status) status.textContent = cueEngine.crossfading ? 'crossfading…' :
    (cueEngine.index >= 0 ? `cue ${cueEngine.index + 1}/${store.state.cues.length}` : 'idle');
}

// ---- midi ----
const btnEnableMidi = document.getElementById('btn-enable-midi');
const btnMidiLearn  = document.getElementById('btn-midi-learn');
const midiDeviceSel = document.getElementById('midi-device');
const midiBindingsEl = document.getElementById('midi-bindings');

btnEnableMidi.onclick = async () => {
  try {
    await initMidi();
    midiReady = true;
    setHandler(createDispatcher(store, {
      recallSnapshot: (i) => recallSlot(i),
      cueNext:        () => cueEngine.advance(),
      cuePrev:        () => cueEngine.previous(),
    }));
    btnEnableMidi.textContent = 'midi live';
    btnEnableMidi.disabled = true;
    refreshMidiDevices();
  } catch (e) {
    console.error('[midi]', e);
    alert('MIDI access denied or unavailable');
  }
};

btnMidiLearn.onclick = () => {
  if (!midiReady) { alert('Enable MIDI first.'); return; }
  if (isLearning()) { cancelLearn(); btnMidiLearn.classList.remove('learning'); btnMidiLearn.textContent = 'learn'; return; }
  startLearn(() => { btnMidiLearn.classList.remove('learning'); btnMidiLearn.textContent = 'learn'; syncUI(); });
  btnMidiLearn.classList.add('learning');
  btnMidiLearn.textContent = 'learning…';
};

function refreshMidiDevices() {
  const inputs = midiInputs();
  midiDeviceSel.hidden = inputs.length === 0;
  midiDeviceSel.innerHTML = '';
  for (const i of inputs) {
    const opt = document.createElement('option');
    opt.value = i.id;
    opt.textContent = `${i.name}${i.manufacturer ? ' — ' + i.manufacturer : ''}`;
    midiDeviceSel.appendChild(opt);
  }
}

function buildMidiBindings() {
  const el = document.getElementById('midi-bindings');
  if (!el) return;
  el.innerHTML = '';
  const bindings = store.state.midi?.bindings ?? [];
  for (const b of bindings) {
    const li = document.createElement('li');
    const p = document.createElement('span');
    p.className = 'mpath';
    p.textContent = `${b.path}  →  ch${b.channel + 1} cc${b.cc}`;
    const del = document.createElement('button');
    del.textContent = '×';
    del.onclick = () => store.update('/midi/bindings', (arr) => {
      const idx = arr.findIndex(x => x.id === b.id);
      if (idx >= 0) arr.splice(idx, 1);
    });
    li.append(p, del);
    el.appendChild(li);
  }
}

// ---- OSC ----
const btnConnectOsc = document.getElementById('btn-connect-osc');
const btnOscLearn   = document.getElementById('btn-osc-learn');
const oscStatusEl   = document.getElementById('osc-status');
const oscBindingsEl = document.getElementById('osc-bindings');

setOscStatus((s) => {
  if (s.connected) { oscStatusEl.textContent = `connected · ${s.url}`; oscStatusEl.classList.add('pass'); }
  else { oscStatusEl.textContent = s.error ? `failed: ${s.error}` : 'disconnected'; oscStatusEl.classList.remove('pass'); }
});
btnConnectOsc.onclick = () => oscConnect(store, store.state.osc?.url || 'ws://127.0.0.1:8787');
btnOscLearn.onclick = () => {
  if (isOscLearning()) { cancelOscLearn(); btnOscLearn.classList.remove('learning'); btnOscLearn.textContent = 'learn'; return; }
  startOscLearn(() => { btnOscLearn.classList.remove('learning'); btnOscLearn.textContent = 'learn'; syncUI(); });
  btnOscLearn.classList.add('learning');
  btnOscLearn.textContent = 'learning…';
};

function buildOscBindings() {
  const el = document.getElementById('osc-bindings');
  if (!el) return;
  el.innerHTML = '';
  const bindings = store.state.osc?.bindings ?? [];
  for (const b of bindings) {
    const li = document.createElement('li');
    const p = document.createElement('span');
    p.className = 'mpath';
    p.textContent = `${b.path}  →  ${b.address}`;
    const del = document.createElement('button');
    del.textContent = '×';
    del.onclick = () => store.update('/osc/bindings', (arr) => {
      const idx = arr.findIndex(x => x.id === b.id);
      if (idx >= 0) arr.splice(idx, 1);
    });
    li.append(p, del);
    el.appendChild(li);
  }
}

// ---- dj mode ----
// IDs resolved lazily inside builders to dodge boot-time TDZ: store.update()
// from ensureSlots() above fires syncUI() before this section's bindings run.
function buildDjDeckPickers() {
  const djEnabled = document.getElementById('dj-enabled');
  const djDeckA   = document.getElementById('dj-deck-a');
  const djDeckB   = document.getElementById('dj-deck-b');
  const djValue   = document.getElementById('dj-value');
  if (!djDeckA || !djDeckB) return;
  const dj = store.state.djMode || {};
  const filled = store.state.snapshots.filter(s => s.state);
  for (const sel of [djDeckA, djDeckB]) {
    const cur = sel === djDeckA ? dj.deckASnapId : dj.deckBSnapId;
    sel.innerHTML = '<option value="">— pick —</option>';
    for (const snap of filled) {
      const opt = document.createElement('option');
      opt.value = snap.id;
      opt.textContent = snap.name;
      if (snap.id === cur) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  if (djEnabled) djEnabled.checked = !!dj.enabled;
  if (djValue && document.activeElement !== djValue) djValue.value = dj.value ?? 0;
}

const djEnabled = document.getElementById('dj-enabled');
const djDeckA   = document.getElementById('dj-deck-a');
const djDeckB   = document.getElementById('dj-deck-b');
const djValue   = document.getElementById('dj-value');
const btnDjayPreset = document.getElementById('btn-dj-preset-djay');

djEnabled.onchange = () => store.update('', (st) => { st.djMode.enabled = djEnabled.checked; });
djDeckA.onchange   = () => store.update('', (st) => { st.djMode.deckASnapId = djDeckA.value || null; });
djDeckB.onchange   = () => store.update('', (st) => { st.djMode.deckBSnapId = djDeckB.value || null; });
djValue.oninput    = () => {
  touchParam('/djMode/value');
  store.update('', (st) => { st.djMode.value = +djValue.value; });
};

btnDjayPreset.onclick = async () => {
  let preset;
  try {
    const res = await fetch('presets/dj-algoriddim.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    preset = await res.json();
  } catch (e) {
    console.error('[dj] preset fetch', e); alert('Failed to load djay preset: ' + e.message); return;
  }
  store.update('', (st) => {
    for (const b of preset.midiBindings) {
      st.midi.bindings.push({
        id: 'mb_' + crypto.randomUUID().slice(0, 8),
        ...b,
      });
    }
  });
};

// ---- recording ----
const btnRecord = document.getElementById('btn-record');
btnRecord.onclick = async () => {
  if (recorder.recording) {
    btnRecord.textContent = '● rec';
    btnRecord.classList.remove('live');
    await recorder.stopAndDownload(`r0n1n-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`);
  } else {
    recorder.start();
    btnRecord.textContent = '■ stop';
    btnRecord.classList.add('live');
  }
};
fileVideo.onchange = () => { const f = fileVideo.files[0]; if (f) addVideoLayer(f); fileVideo.value = ''; };
fileImage.onchange = () => { const f = fileImage.files[0]; if (f) addImageLayer(f); fileImage.value = ''; };

// drag-drop on the page
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) document.body.classList.remove('dragging'); });
window.addEventListener('dragover',  (e) => { e.preventDefault(); });
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = e.dataTransfer.files?.[0];
  if (!f) return;
  if (/\.(mp4|webm)$/i.test(f.name)) addVideoLayer(f);
  else if (/\.(png|jpe?g|webp|gif)$/i.test(f.name)) addImageLayer(f);
});

// ---- save / load / export / import ----
btnSave.onclick = () => { saveProject(store.state); store.clean(); };
btnLoad.onclick = () => {
  const p = loadProject();
  if (!p) return;
  const migrated = migrate(p);
  store.replace(migrated);
  for (const rt of layerRuntimes.values()) rt.dispose?.();
  layerRuntimes.clear();
  (async () => {
    for (const layer of store.state.layers) {
      try { layerRuntimes.set(layer.id, await attachLayerRuntime(layer)); }
      catch (e) { console.error('[editor] reload attach', e); }
    }
    syncUI();
  })();
};
btnExport.onclick = () => exportProjectFile(store.state, `${store.state.name || 'project'}.r0n1n.json`);
btnLoad.addEventListener('contextmenu', (e) => { e.preventDefault(); importFile.click(); });
importFile.onchange = async () => {
  const f = importFile.files[0]; if (!f) return;
  try { store.replace(migrate(await importProjectFile(f))); }
  catch (e) { console.error('[editor] import', e); }
  importFile.value = '';
};

btnOutput.onclick = () => window.open('output.html', '_blank');

// Manual push — force full state to output tab. Use when auto-sync stalls.
const btnPush = $('btn-push');
if (btnPush) {
  btnPush.onclick = () => {
    broadcastState();
    console.log('[broadcast] manual push: state:full sent', {
      surfaces: store.state.surfaces?.length ?? 0,
      layers: store.state.layers?.length ?? 0,
    });
    btnPush.classList.add('flash');
    setTimeout(() => btnPush.classList.remove('flash'), 200);
  };
}

// Preset scene dropdown — applies a full-screen audio-reactive showcase
// (replaces surfaces + layers with the preset's bundle).
import('./project/presets.js?v=1').then(({ PRESETS, PRESET_IDS }) => {
  const selPreset = $('preset-scene');
  if (!selPreset) return;
  // Populate options (preserving the placeholder ◇)
  for (const id of PRESET_IDS) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = PRESETS[id].name;
    opt.title = PRESETS[id].description;
    selPreset.appendChild(opt);
  }
  selPreset.onchange = async () => {
    const id = selPreset.value;
    if (!id) return;
    const preset = PRESETS[id];
    const { surfaces, layers } = preset.build();
    console.log('[preset] applying', id, { surfaces: surfaces.length, layers: layers.length });
    // Dispose all old runtimes; we're replacing layers wholesale.
    for (const rt of layerRuntimes.values()) {
      try { rt.dispose?.(); } catch {}
    }
    layerRuntimes.clear();
    // Replace state
    store.update('', (st) => {
      st.surfaces = surfaces;
      st.layers = layers;
      st.ui.selectedSurfaceId = surfaces[0]?.id ?? null;
      st.ui.selectedLayerId = null;
    });
    // Attach new runtimes
    for (const layer of layers) {
      try {
        layerRuntimes.set(layer.id, await attachLayerRuntime(layer));
      } catch (e) {
        console.error('[preset] attach failed', layer.id, e);
      }
    }
    syncUI();
    broadcastState();  // immediate sync to output
    // Reset dropdown to placeholder so user can pick same preset again later
    selPreset.value = '';
  };
});
// Also expose for devtools console use
window.__broadcastState = broadcastState;

// ---- drag corners / mesh CPs ----
attachDrag(canvas, selectedSurface, {
  onDragMove: (kind, index, clip) => {
    store.update('', () => {
      const s = selectedSurface();
      if (!s) return;
      if (kind === 'corner') setCorner(s, index, clip);
      else if (kind === 'mesh') setMeshPoint(s, index, clip);
    });
  },
});

// ---- render loop ----
function frame() {
  fitCanvas(canvas);
  const { fps, t } = clock.tick();
  regl.poll();

  audioState.tick(t);
  cueEngine.tick();

  // DJ mode morph: per-frame in-place blend of snapshot A vs B by djMode.value.
  // Skips structuredClone for live performance — see snapshots.js:djMorph.
  const dj = store.state.djMode;
  if (dj?.enabled && dj.deckASnapId && dj.deckBSnapId) {
    const snapA = findSnapshot(dj.deckASnapId);
    const snapB = findSnapshot(dj.deckBSnapId);
    if (snapA && snapB) {
      djMorph(store.state, snapA, snapB, dj.value ?? 0);
      broadcastPending = true;
    }
  }

  pipeline.render(store.state, layerRuntimes, { getLut: getLutEntry });
  overlay.render(store.state, store.state.ui.selectedSurfaceId);

  if (broadcastPending) { broadcastPending = false; broadcastState(); }
  ch.send('ping', null);

  const now = performance.now();
  fpsEl.textContent = `fps ${fps.toFixed(0)}`;
  const bpm = audioState.uniforms.bpm || 0;
  const bpmEl = document.getElementById('bpm');
  if (bpmEl) bpmEl.textContent = bpm ? `bpm ${bpm}` : 'bpm —';
  syncEl.textContent = (outputAlive && now - lastPong < 1500) ? 'sync ✓' : 'sync —';
  if (now - lastPong > 1500) outputAlive = false;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
console.log('[editor] M2 booted');

// ---- debug hooks ----
window.__r0n1n = {
  get state() { return store.state; },
  get runtimes() { return layerRuntimes; },
  pipeline, store,
};
