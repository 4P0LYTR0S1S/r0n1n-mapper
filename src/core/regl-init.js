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

export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
