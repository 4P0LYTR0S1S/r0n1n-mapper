// Video layer — owns an HTMLVideoElement bound to an IndexedDB-stored blob.
// Hash-keyed so the same file imported twice doesn't duplicate storage.

import { putVideo, getVideo } from '../storage/idb.js';
import { defaultKey } from '../keyer/keyer-glsl.js';

async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// Persist a File/Blob and return the layer descriptor (to add to state.layers).
export async function ingestVideoFile(layerId, file) {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  await putVideo(hash, file, file.name);
  return {
    id: layerId,
    type: 'video',
    name: file.name,
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    videoId: hash,
    loop: true,
    muted: true,
    speed: 1.0,
    key: defaultKey(),
  };
}

// Attach a runtime to a layer record. Returns { video, texture, tick, dispose }.
// Resolves once the first frame is ready.
export async function attachVideo(regl, layer) {
  const rec = await getVideo(layer.videoId);
  if (!rec) throw new Error(`video blob missing for layer ${layer.id} (videoId=${layer.videoId})`);
  const url = URL.createObjectURL(rec.blob);
  const v = document.createElement('video');
  v.src = url;
  v.muted = true;
  v.loop = !!layer.loop;
  v.playsInline = true;
  v.autoplay = true;
  v.playbackRate = layer.speed ?? 1.0;
  v.crossOrigin = 'anonymous';
  // Off-screen but DOM-attached — otherwise Chromium will not decode frames.
  v.style.cssText = 'position:fixed; left:-9999px; top:-9999px; width:1px; height:1px; opacity:0; pointer-events:none;';
  v.setAttribute('data-r0n1n-video-layer', layer.id);
  document.body.appendChild(v);

  // Hidden tabs (Chrome backgrounding) won't fire 'loadeddata' until the tab is
  // visible. 'loadedmetadata' fires sooner and tells us the video dimensions.
  // Watchdog at 4s so we never deadlock — if metadata isn't here yet, fall back
  // to a 1x1 placeholder and let tick() upgrade once frames arrive.
  await Promise.race([
    new Promise((resolve, reject) => {
      v.addEventListener('loadedmetadata', resolve, { once: true });
      v.addEventListener('error', () => reject(new Error('video load error')), { once: true });
    }),
    new Promise(resolve => setTimeout(resolve, 4000)),
  ]);
  v.play().catch(() => {});

  const w = v.videoWidth  || 1;
  const h = v.videoHeight || 1;
  const texture = regl.texture({
    width: w, height: h,
    min: 'linear', mag: 'linear', wrap: 'clamp', flipY: false,
  });

  return {
    video: v,
    texture,
    layer,
    flipY: true,
    tick() {
      if (v.readyState >= 2) texture.subimage(v);
    },
    dispose() {
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.parentNode?.removeChild(v);
      URL.revokeObjectURL(url);
      texture.destroy?.();
    },
  };
}
