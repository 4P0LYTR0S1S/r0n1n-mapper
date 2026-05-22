import { initRegl, fitCanvas } from './core/regl-init.js';
import { createClock } from './core/clock.js';
import { makeChannel } from './sync/broadcast.js';
import { emptyProject, migrate } from './project/schema.js';
import { attachVideo } from './layers/video-layer.js';
import { attachImage } from './layers/image-layer.js';
import { attachSolid } from './layers/solid-layer.js';
import { attachWebcam } from './layers/webcam-layer.js';
import { attachShader } from './layers/shader-layer.js';
import { attachHydra } from './layers/hydra-layer.js';
import { attachDancerImg } from './layers/dancer-img-layer.js?v=3';
import { attachTitle } from './layers/title-layer.js?v=1';
import { createAudioState } from './audio/uniforms.js';
import { initAudio, getAudioStream } from './audio/analyser.js';
import { createPipeline } from './render/pipeline.js';
import { parseCube, uploadLutTexture } from './grade/lut.js';
import { getLut as idbGetLut, listLuts } from './storage/idb.js';

const canvas = document.getElementById('view');
const fpsEl  = document.getElementById('fps');
const syncEl = document.getElementById('sync-state');

const regl = initRegl(canvas);
const audioState = createAudioState(regl);
const lutManager = new Map();
const getLutEntry = (id) => lutManager.get(id);
(async () => {
  const records = await listLuts();
  for (const rec of records) {
    try {
      const text = await rec.blob.text();
      const parsed = parseCube(text);
      const texture = uploadLutTexture(regl, parsed);
      lutManager.set(rec.id, { texture, size: parsed.size, name: rec.name });
    } catch (e) { console.error('[output] lut restore', rec.id, e); }
  }
})();
const clock = createClock();
const ch = makeChannel('output');
const pipeline = createPipeline(regl);

let state = emptyProject();
const layerRuntimes = new Map();
let lastEditor = 0;

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

async function syncRuntimes(newState) {
  const incoming = new Set(newState.layers.map(l => l.id));
  for (const id of [...layerRuntimes.keys()]) {
    if (!incoming.has(id)) {
      layerRuntimes.get(id).dispose?.();
      layerRuntimes.delete(id);
    }
  }
  for (const layer of newState.layers) {
    if (layerRuntimes.has(layer.id)) continue;
    try {
      layerRuntimes.set(layer.id, await attachLayerRuntime(layer));
    } catch (e) {
      console.error('[output] attach failed', layer.id, e);
    }
  }
}

ch.on(async (msg) => {
  if (msg.type === 'state:full') {
    state = migrate(msg.payload);
    lastEditor = performance.now();
    document.body.classList.add('live');
    await syncRuntimes(state);
  }
  if (msg.type === 'ping') { ch.send('pong', null); lastEditor = performance.now(); }
});

ch.send('hello', { role: 'output' });
ch.send('request-state', null);
console.log('[output] M2 booted, awaiting editor state...');

window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
  // 'a' (audio) — request mic permission for this output tab. Required
  // because Chrome throttles the editor tab in background, so the output
  // can't rely on receiving audio from the editor. Each tab needs its
  // own analyser.
  if (e.key === 'a' || e.key === 'A') {
    initAudio(null).then(() => {
      console.log('[output] audio enabled on output tab');
      document.getElementById('idle')?.remove();
    }).catch(e => console.error('[output] audio enable failed', e));
  }
  // 'h' — toggle the HUD overlay (fps / sync / rec) so the projection is clean
  if (e.key === 'h' || e.key === 'H') {
    document.body.classList.toggle('hide-hud');
  }
  // 'r' — start/stop MediaRecorder on the output canvas (with mic audio if engaged)
  if (e.key === 'r' || e.key === 'R') toggleRecording();
});

// ---- canvas → WebM recorder (with optional mic audio) ----
let recorder = null;
let recordChunks = [];
function toggleRecording() {
  if (recorder?.state === 'recording') {
    recorder.stop();
    return;
  }
  try {
    const stream = canvas.captureStream(60);
    const micStream = getAudioStream();
    if (micStream) {
      for (const track of micStream.getAudioTracks()) stream.addTrack(track);
    }
    const opts = [
      { mimeType: 'video/webm;codecs=vp9,opus' },
      { mimeType: 'video/webm;codecs=vp8,opus' },
      { mimeType: 'video/webm' },
    ];
    recorder = null;
    for (const o of opts) {
      try { recorder = new MediaRecorder(stream, o); break; } catch {}
    }
    if (!recorder) { console.error('[output] no supported MediaRecorder mime'); return; }
    recordChunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) recordChunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(recordChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `r0n1n-output-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      document.body.classList.remove('recording');
      const dot = document.getElementById('rec-dot');
      if (dot) dot.hidden = true;
    };
    recorder.start(1000);  // 1s chunks → can stop cleanly even mid-stream
    document.body.classList.add('recording');
    const dot = document.getElementById('rec-dot');
    if (dot) dot.hidden = false;
    console.log('[output] recording started');
  } catch (e) {
    console.error('[output] record failed', e);
  }
}

// Auto-prompt for mic on first user interaction with the output canvas.
// Falls back gracefully if denied — output still mirrors editor state, just
// without audio reactivity from this tab's perspective. The idle banner is
// removed from the DOM entirely once audio is engaged so it can't reappear
// when sync goes briefly stale (>1.5s without an editor broadcast).
canvas.addEventListener('click', () => {
  if (audioState.ready) return;
  initAudio(null).then(() => {
    console.log('[output] audio enabled via canvas click');
    document.getElementById('idle')?.remove();
  }).catch(e => console.warn('[output] audio click-grant failed', e));
}, { once: true });

function frame() {
  fitCanvas(canvas, state.output);
  document.body.classList.toggle('fixed-output', state.output?.mode === 'fixed');
  const { fps, t } = clock.tick();
  regl.poll();

  audioState.tick(t);
  pipeline.render(state, layerRuntimes, { getLut: getLutEntry });

  const alive = performance.now() - lastEditor < 1500;
  fpsEl.textContent = `fps ${fps.toFixed(0)}`;
  syncEl.textContent = alive ? 'sync ✓' : 'sync —';
  if (!alive) document.body.classList.remove('live');

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__r0n1n = {
  get state() { return state; },
  get runtimes() { return layerRuntimes; },
  forceFrame() { fitCanvas(canvas, state.output); regl.poll(); pipeline.render(state, layerRuntimes); return 'rendered'; },
  surfaceCount() { return state.surfaces.length; },
};
