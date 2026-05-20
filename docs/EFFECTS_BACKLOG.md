# Audio-reactive effects backlog

Researched 2026-05-20. Top 3 recommendations split out for v0.3 ship (Wire Frame Dancer, Onset State Machine / Strobe Bloom, Sub-Kick Pressure Wave). The 5 below are the remaining candidates — each spec is self-contained, can be picked up by a future implementer cold.

Uniform contract assumed (see `src/audio/uniforms.js`): `u_bass`, `u_mid`, `u_high`, `u_env`, `u_beat`, `u_bpm`, `u_fft` (sampler2D 1×N R8), plus the new `u_audioIntensity` scalar from the per-layer slider added in this batch. Where the spec asks for `u_sub` / `u_f1`/`u_f2`/`u_f3` / `u_beatPhase` — those are uniforms the matching v0.3 ship work introduces.

---

## SPECTRAL TERRAIN — 8-10h

**Visual.** Scrolling raymarched/heightmap terrain where the spectrum IS the elevation profile. Bass forms low rolling hills foreground, highs spike sharp on the horizon. Camera floats forward; terrain advects.

**Audio mapping.** `u_fft` sampled along camera depth axis. Per-frame write current FFT into a row of a persistent FBO, sample row-by-z. `u_beat` triggers full-terrain color shift. `u_high` controls fog density.

**Sketch.** `h(x,z) = texture(u_fft, vec2(fract(x*0.5), 0.5)).r * z_falloff(z)` plus persistence FBO. Raymarch with iq's heightfield sphere-tracing trick. Cap step count at 48.

**Risk.** Raymarch loop cost; bandwidth cheap on `u_fft` itself. Log-warp x-axis or bass dominates visually.

**4-hour version (80% as good):** skip the persistence FBO, use rolling time-offset noise modulated by a single FFT slice.

---

## FEEDBACK SLIME — "PETRI" (Gray-Scott reaction-diffusion) — 8-12h

**Visual.** Black field with neon trails that grow, branch, and decay like slime mold or coral. Bass injects growth seeds at frame center; mids steer growth via vector-field rotation; highs raise decay rate; beats spawn random seeds.

**Audio mapping.** Modulate Gray-Scott chemistry parameters directly (not just colour appearance):
- `f = 0.04 + u_bass*0.03` (feed rate)
- `k = 0.06 + u_high*0.01` (kill rate)
- `u_mid` → vector-field rotation bias
- `u_beat` → seed injection at random uv

**Math.** Two FBOs ping-ponged:
```
A' = A + (Dₐ ∇²A - A*B² + f*(1-A)) * dt
B' = B + (D_b ∇²B + A*B² - (f+k)*B) * dt
```
Render pass samples B, maps `mix(coldColor, hotColor, B)`.

**Risk.** Reaction-diffusion is ~200 Shadertoy entries already; the *audio-modulated chemistry* (not just appearance) is what's novel. Bandwidth: 2× FBO r/w at full res. Run at half-res and upscale for safety on Chromebook 1080p.

---

## FORMANT VEIL (vocal-formant effect) — 5-6h

**Visual.** Translucent rippling membrane that resonates only when there's vocal content — vowels bloom specific shapes, consonants make it shiver. Stays still during instrumental.

**Audio mapping.** JS-side compute three mid-range bins:
- F1: 250-1000 Hz (open vowels — "ahh", "ohh")
- F2: 1000-3000 Hz (closed vowels — "eee", "iii")
- F3: 3000-5000 Hz (sibilance — consonants)

Expose `u_f1, u_f2, u_f3`. Vowel-ness = `(F1+F2)/2 - F3`; positive = vowels, negative = noise.

**Sketch.**
```glsl
float vowel = max(0.0, (u_f1+u_f2)*0.5 - u_f3);
vec2 p = (v_uv-0.5) * 4.0;
float w1 = sin(length(p) * (4.0 + u_f1*20.0) - u_time*3.0);
float w2 = sin(length(p) * (4.0 + u_f2*20.0) - u_time*2.0);
float veil = (w1*w2) * vowel;
vec3 col = mix(vec3(0), u_tint, smoothstep(-0.2, 0.6, veil));
col.rg += u_f3 * 0.1 * hash22(v_uv*u_time);  // sibilance grain
```

**Risk.** Formant-band classification is crude — instrumental mid-energy will also trigger. Honest framing: "sing into the mic → visual happens", not a real vocal classifier.

---

## ASCII SPECTRUM RAIN — 4h

**Visual.** Matrix-style falling glyphs. Each column's fall speed + density = FFT bin at that x. Bass-heavy frequencies → thick dense columns; treble → sparse fast sparks. Pure cyberpunk.

**Audio mapping.** Column x-coordinate maps to log-warped FFT bin. Bin energy → column density + fall speed.

**Sketch.**
```glsl
vec2 cell = floor(v_uv * vec2(80.0, 45.0));
float bin = texture2D(u_fft, vec2(cell.x/80.0, 0.5)).r;
float fall = u_time * (1.0 + bin*4.0);
float lit = step(0.5 + bin*0.4, hash21(cell + vec2(0.0, floor(fall*8.0))));
vec3 col = vec3(0.1, 1.0, 0.4) * lit * (0.5 + bin);
```

**Risk.** Cliché if not clearly audio-driven. Verify columns visibly cluster around bass when track is bass-heavy. v2: real glyph rendering via SDF font texture.

---

## DRIFT WEAVE (Hydra-livecoder palette) — 3h

**Visual.** Hydra's `osc().modulate(noise())` aesthetic rendered natively — soft interlaced bands warping through each other. Familiar starting point for Hydra livecoders.

**Audio mapping.**
- `u_bass` → carrier osc frequency
- `u_mid` → modulator amplitude
- `u_high` → modulator frequency
- `u_env` → final brightness

**Sketch.**
```glsl
vec2 p = v_uv - 0.5;
float angle = atan(p.y, p.x);
float r = length(p);
float carrier = sin(r * (20.0 + u_bass*40.0) + u_time);
float modAmp = 0.3 + u_mid;
float modulator = sin(angle*6.0 + u_time*0.7) * fbm(p*8.0 + u_high*4.0);
float w = sin(carrier + modAmp * modulator);
vec3 col = mix(u_colorA, u_colorB, 0.5+0.5*w) * (0.5 + u_env*0.5);
```

**Risk.** Mediocre individually but completes the "Hydra-without-Hydra" story. Skip if time-constrained — `plasma` covers similar ground.

---

## Key files for any of the above

- `src/layers/shader-effects.js` — add new entries to `EFFECTS` registry (`frag`, `defaultParams`, `schema`)
- `src/audio/uniforms.js` — add new uniforms (`u_sub`, `u_f1/f2/f3`, `u_beatPhase`, etc.)
- `src/layers/shader-layer.js` — wire new uniforms into the draw call's `uniforms` map (matching the `(audioState?.uniforms?.X ?? 0) * (layer.audioIntensity ?? 1)` pattern from v0.2.1)
