// Image layer — static bitmap from a file. Hash-keyed IDB persistence like
// video-layer. tick() is a no-op; texture is uploaded once on attach.

import { putImage, getImage } from '../storage/idb.js';

async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function ingestImageFile(layerId, file) {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  await putImage(hash, file, file.name);
  return {
    id: layerId,
    type: 'image',
    name: file.name,
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    imageId: hash,
  };
}

export async function attachImage(regl, layer) {
  const rec = await getImage(layer.imageId);
  if (!rec) throw new Error(`image blob missing for layer ${layer.id} (imageId=${layer.imageId})`);
  const bitmap = await createImageBitmap(rec.blob);
  const texture = regl.texture({
    data: bitmap,
    min: 'linear', mag: 'linear', wrap: 'clamp', flipY: false,
  });
  return {
    layer,
    texture,
    // Both video and image have source row 0 = top; the compositor's flipY=true
    // path lands them in the FBO with bottom-of-FBO = bottom-of-source.
    flipY: true,
    tick() {},
    dispose() { bitmap.close?.(); texture.destroy?.(); },
  };
}
