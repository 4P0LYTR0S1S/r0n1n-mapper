// Pool of regl framebuffers keyed by (w, h). Avoids per-frame allocation churn
// when layers and surfaces share resolutions.

export function createFBOPool(regl) {
  const free = new Map(); // "WxH" -> FBO[]

  function key(w, h) { return `${w}x${h}`; }

  function acquire(w, h) {
    const k = key(w, h);
    const list = free.get(k);
    if (list && list.length) return list.pop();
    return regl.framebuffer({
      color: regl.texture({ width: w, height: h, min: 'linear', mag: 'linear', wrap: 'clamp' }),
      depth: false,
      stencil: false,
    });
  }

  function release(fbo, w, h) {
    const k = key(w, h);
    if (!free.has(k)) free.set(k, []);
    free.get(k).push(fbo);
  }

  function destroyAll() {
    for (const list of free.values()) for (const fbo of list) fbo.destroy?.();
    free.clear();
  }

  return { acquire, release, destroyAll };
}
