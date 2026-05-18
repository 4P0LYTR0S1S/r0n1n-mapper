// Performance clock + FPS meter. Single source of truth for time/dt.

export function createClock() {
  let last = performance.now();
  let t = 0;
  let frameCount = 0;
  let fpsWindowStart = last;
  let fps = 0;
  return {
    tick() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      frameCount++;
      if (now - fpsWindowStart >= 500) {
        fps = (frameCount * 1000) / (now - fpsWindowStart);
        frameCount = 0;
        fpsWindowStart = now;
      }
      return { t, dt, fps };
    }
  };
}
