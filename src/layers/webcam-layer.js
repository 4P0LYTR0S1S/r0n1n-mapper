// Webcam layer — getUserMedia → <video> → regl texture. Same compositor contract
// as video-layer.js (flipY: true). Acquires the default camera unless layer.deviceId
// is set, in which case it constrains by deviceId.

import { defaultKey } from '../keyer/keyer-glsl.js';

export function emptyWebcamLayer(id, name = 'webcam') {
  return {
    id,
    type: 'webcam',
    name,
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    deviceId: null,
    key: defaultKey(),
  };
}

export async function listWebcams() {
  // Permission must already be granted (or about to be) for labels to be populated.
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput').map(d => ({ deviceId: d.deviceId, label: d.label || 'camera' }));
  } catch {
    return [];
  }
}

export async function attachWebcam(regl, layer) {
  const constraints = {
    video: layer.deviceId ? { deviceId: { exact: layer.deviceId } } : true,
    audio: false,
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    throw new Error(`webcam access denied or device unavailable: ${e.message}`);
  }

  const v = document.createElement('video');
  v.srcObject = stream;
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.style.cssText = 'position:fixed; left:-9999px; top:-9999px; width:1px; height:1px; opacity:0; pointer-events:none;';
  v.setAttribute('data-r0n1n-webcam-layer', layer.id);
  document.body.appendChild(v);

  await Promise.race([
    new Promise(resolve => v.addEventListener('loadedmetadata', resolve, { once: true })),
    new Promise(resolve => setTimeout(resolve, 4000)),
  ]);
  v.play().catch(() => {});

  const w = v.videoWidth || 640;
  const h = v.videoHeight || 480;
  const texture = regl.texture({
    width: w, height: h,
    min: 'linear', mag: 'linear', wrap: 'clamp', flipY: false,
  });

  return {
    video: v,
    stream,
    texture,
    layer,
    flipY: true,
    tick() {
      if (v.readyState >= 2) texture.subimage(v);
    },
    dispose() {
      for (const t of stream.getTracks()) t.stop();
      v.pause();
      v.srcObject = null;
      v.parentNode?.removeChild(v);
      texture.destroy?.();
    },
  };
}
