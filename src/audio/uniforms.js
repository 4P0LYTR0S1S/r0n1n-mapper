// Audio uniforms for shader layers. Owns a 1×N R8 texture mirroring the
// analyser's FFT bins, plus a snapshot of per-band envelopes the shader can
// read via simple float uniforms.

import { audioReady, updateAudio } from './analyser.js';

export function createAudioState(regl) {
  let fftTex = null;
  let lastUniforms = { bass: 0, mid: 0, high: 0, env: 0, beat: 0, bpm: 0, time: 0 };

  function tick(t) {
    const u = updateAudio(t);
    lastUniforms = u;

    if (u.fftBins && !fftTex) {
      fftTex = regl.texture({
        width: u.fftBins.length, height: 1,
        format: 'luminance', type: 'uint8',
        min: 'linear', mag: 'linear', wrap: 'clamp',
      });
    }
    if (u.fftBins && fftTex) {
      fftTex({ width: u.fftBins.length, height: 1, data: u.fftBins, format: 'luminance', type: 'uint8' });
    }
  }

  // replace() lets a consumer (e.g. the output tab) accept audio state
  // computed elsewhere (e.g. broadcast from the editor) instead of running
  // a local analyser. Pass { ...uniforms, fftBins } as received.
  function replace(received) {
    if (!received) return;
    const { fftBins, ...u } = received;
    lastUniforms = u;
    if (fftBins && fftBins.length) {
      if (!fftTex) {
        fftTex = regl.texture({
          width: fftBins.length, height: 1,
          format: 'luminance', type: 'uint8',
          min: 'linear', mag: 'linear', wrap: 'clamp',
        });
      }
      fftTex({ width: fftBins.length, height: 1, data: fftBins, format: 'luminance', type: 'uint8' });
    }
  }

  return {
    tick,
    replace,
    get uniforms() { return lastUniforms; },
    get fftTexture() { return fftTex; },
    get ready() { return audioReady(); },
  };
}
