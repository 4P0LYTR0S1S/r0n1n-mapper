// Pointer drag controller for surface control points. Mode-aware via picker.

import { screenToClip, hitTest } from './picker.js';

export function attachDrag(canvas, getSelectedSurface, {
  onDragMove = () => {},   // (kind, index, clip)
} = {}) {
  let active = null;       // { kind, index }
  let pointerId = -1;

  function down(ev) {
    const surface = getSelectedSurface();
    if (!surface) return;
    const hit = hitTest(surface, canvas, ev);
    if (!hit) return;
    active = hit;
    pointerId = ev.pointerId;
    canvas.setPointerCapture(pointerId);
    ev.preventDefault();
  }

  function move(ev) {
    if (!active || ev.pointerId !== pointerId) return;
    onDragMove(active.kind, active.index, screenToClip(canvas, ev));
  }

  function up(ev) {
    if (!active || ev.pointerId !== pointerId) return;
    canvas.releasePointerCapture(pointerId);
    active = null;
    pointerId = -1;
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
  };
}
