import createREGL from 'regl';

// Boot a regl context on a given canvas, request WebGL2 + the extensions we depend on.
// Capability probe results are attached to ctx.caps for downstream feature gating.

export function initRegl(canvas) {
  const opts = {
    canvas,
    attributes: {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance'
    },
    extensions: [],
    optionalExtensions: [
      'EXT_color_buffer_float',
      'OES_texture_float_linear',
      'WEBGL_color_buffer_float'
    ],
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2)
  };
  const regl = createREGL(opts);
  regl.caps = {
    webgl2: !!regl._gl.getParameter && regl._gl instanceof WebGL2RenderingContext,
    maxTextureSize: regl.limits.maxTextureSize,
    floatFbo: regl.hasExtension('EXT_color_buffer_float') || regl.hasExtension('WEBGL_color_buffer_float'),
    floatLinear: regl.hasExtension('OES_texture_float_linear'),
    instancing: regl.hasExtension('ANGLE_instanced_arrays') || regl.limits.glsl === '3.00'
  };
  return regl;
}

// fitCanvas — resizes the canvas backing buffer.
//   config: undefined → fit window (legacy)
//           { mode: 'fit' }                → fit window
//           { mode: 'fixed', width, height } → set backing buffer to exact pixel size
//
// Fixed mode is what you want for projector / Chromecast / OBS NDI — the GL
// buffer is rendered at native projector resolution regardless of how big the
// browser window is, then CSS scales the display element with object-fit:contain.
export function fitCanvas(canvas, config) {
  if (config && config.mode === 'fixed' && config.width && config.height) {
    if (canvas.width !== config.width || canvas.height !== config.height) {
      canvas.width = config.width;
      canvas.height = config.height;
    }
    return;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
