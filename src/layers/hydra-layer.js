// Hydra-synth embedded layer. Per Spike B verdict: construct with
// `autoLoop: false`, drive `hydra.synth.tick(dt)` from our main render loop,
// sample hydra's canvas via `regl.texture({ data: hCanvas })` on the same tick.
//
// User-pasted code runs through `new Function('h', 'with (h) { ... }')` so
// expressions like `osc(10,0.1,0.8).out()` resolve to `h.osc(...).out()` —
// matches Hydra's documented livecoding ergonomics without needing makeGlobal.

const HYDRA_CDN = 'https://esm.sh/hydra-synth@1.3.29';
let HydraCtor = null;

async function loadHydra() {
  if (HydraCtor) return HydraCtor;
  const mod = await import(HYDRA_CDN);
  HydraCtor = mod.default;
  return HydraCtor;
}

export function emptyHydraLayer(id) {
  return {
    id,
    type: 'hydra',
    name: 'hydra',
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    code: 'osc(10, 0.1, 0.8).rotate(0.1).out()',
    resolution: 720,
  };
}

export async function attachHydra(regl, layer) {
  const Hydra = await loadHydra();
  const w = layer.resolution || 720;
  const h = Math.round(w * 9 / 16);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  // Hydra's canvas MUST be composited by Chromium or its framebuffer remains
  // empty. We park it at the bottom-right corner with low opacity so it
  // composites but is visually unobtrusive. Removing it from layout entirely
  // (left:-9999px, opacity:0, or width:1px) makes hydra not render.
  canvas.style.cssText = 'position:fixed; right:0; bottom:0; transform:scale(0.05); transform-origin:bottom right; opacity:0.5; pointer-events:none; z-index:9999;';
  canvas.setAttribute('data-r0n1n-hydra-layer', layer.id);
  document.body.appendChild(canvas);

  const hydra = new Hydra({
    canvas,
    detectAudio: false,
    makeGlobal: false,
    // autoLoop:true so hydra drives its own rAF — manual tick(dt) appears not
    // to trigger the full render in this version. We just sample the canvas
    // each frame in our main tick. (Spike B's "shared-rAF" path is theoretically
    // ideal but hydra-synth 1.3.29's tick semantics didn't cooperate; revisit
    // if perf demands precise sync.)
    autoLoop: true,
  });
  const h_ = hydra.synth;

  let compiled = null;
  let compiledFor = null;
  let lastT = performance.now() / 1000;
  let runErrors = 0;

  function compile(code) {
    try {
      // wrap in with(h) so the user can paste idiomatic hydra (osc().out() etc.)
      compiled = new Function('h', `with (h) { ${code} }`);
      compiledFor = code;
      runErrors = 0;
    } catch (e) {
      console.warn('[hydra]', e.message);
      compiled = null;
    }
  }

  function maybeRunUser() {
    if (layer.code !== compiledFor) compile(layer.code);
    if (!compiled) return;
    try { compiled(h_); }
    catch (e) {
      if (runErrors++ < 3) console.warn('[hydra] runtime', e.message);
      compiled = null;
    }
  }
  maybeRunUser();

  const texture = regl.texture({ width: w, height: h, min: 'linear', mag: 'linear', wrap: 'clamp', flipY: false });

  return {
    layer,
    canvas,
    hydra,
    texture,
    flipY: false,
    tick() {
      maybeRunUser();
      // Sample hydra's canvas directly. With the canvas composited (visible at
      // small scale in the corner), the compositor's framebuffer is valid for
      // texSubImage2D reads. If this turns out to lose frames in production,
      // switch to the captureStream→video path (kept in git history).
      try { texture.subimage(canvas); } catch {}
    },
    dispose() {
      try { h_.hush?.(); } catch {}
      canvas.parentNode?.removeChild(canvas);
      texture.destroy?.();
    },
  };
}
