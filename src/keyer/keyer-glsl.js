// GLSL for chroma/luma keying. Embedded into the compositor's `above` sample
// path so a keyed source produces a pre-multiplied-alpha output that blends
// correctly with whatever's below.
//
// Color math: BT.709 (HD/web standard). All sources in this build are sRGB
// blob videos / canvas-derived images — BT.709 is the right pick. BT.601 only
// for SD analog content, which we don't deal with here.

export const KEY_MODES = ['none', 'luma', 'chroma'];

export function keyModeIndex(name) {
  const i = KEY_MODES.indexOf(name);
  return i < 0 ? 0 : i;
}

export const KEYER_GLSL = `
  uniform int   u_keyMode;     // 0 none, 1 luma, 2 chroma
  uniform vec3  u_keyColor;    // RGB target for chroma
  uniform float u_keyLow;      // luma low / chroma similarity radius
  uniform float u_keyHigh;     // luma high / chroma similarity + smoothness
  uniform float u_keySpill;    // chroma despill amount [0,1]

  float kn_luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float kn_cb  (vec3 c) { return -0.114572*c.r - 0.385428*c.g + 0.500000*c.b + 0.5; }
  float kn_cr  (vec3 c) { return  0.500000*c.r - 0.454153*c.g - 0.045847*c.b + 0.5; }

  vec4 applyKey(vec4 src) {
    if (u_keyMode == 1) {
      // Luma key: alpha = smoothstep(low, high, Y)
      // For black-background VJ clips, set low ~ 0.02-0.08 and high ~ 0.12-0.25.
      float L = kn_luma(src.rgb);
      float a = smoothstep(u_keyLow, u_keyHigh, L);
      return vec4(src.rgb, src.a * a);
    }
    if (u_keyMode == 2) {
      // Chroma key: distance in Cb/Cr plane. similarity-to-(similarity+smoothness).
      float srcCb = kn_cb(src.rgb);
      float srcCr = kn_cr(src.rgb);
      float keyCb = kn_cb(u_keyColor);
      float keyCr = kn_cr(u_keyColor);
      float d = sqrt((srcCb - keyCb) * (srcCb - keyCb) + (srcCr - keyCr) * (srcCr - keyCr));
      float a = smoothstep(u_keyLow, u_keyHigh, d);

      // Despill (OBS-style channel clamp generalized): for each pixel near the
      // key color (alpha low), pull source away from key hue. Reduces fringing.
      vec3 outRGB = src.rgb;
      if (u_keySpill > 0.0) {
        vec3 keyDir = normalize(u_keyColor + vec3(1e-5));
        float spillAmount = max(0.0, dot(src.rgb, keyDir) - 0.5) * u_keySpill * (1.0 - a);
        outRGB = max(vec3(0.0), src.rgb - keyDir * spillAmount);
      }
      return vec4(outRGB, src.a * a);
    }
    return src;
  }
`;

// Default per-layer key block for new video/webcam layers.
export function defaultKey() {
  return {
    mode: 'none',
    color: [0, 1, 0],   // green by default for chroma
    low: 0.05,
    high: 0.25,
    spill: 0.5,
  };
}
