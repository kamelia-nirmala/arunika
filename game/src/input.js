// Keyboard + mouse input. Keys are tracked by code; actions map to config KEYS.
import { KEYS } from './config.js';
const down = new Set();
// Queued presses: a tap that lands between two frames (slow machine, or a
// fast key press) must still fire once — `edge` consumes from this queue,
// it is not cleared by keyup.
const queued = new Set();
let mouseDX = 0, mouseDY = 0, mouseDown = false;
// Right button (aim) is tracked on its own state: it must never be confused
// with the left button (fire). Right click aims, left click shoots.
let mouseRightDown = false;
let locked = false;
export const input = {
  get mouseDX() { const v = mouseDX; mouseDX = 0; return v; },
  get mouseDY() { const v = mouseDY; mouseDY = 0; return v; },
  get mouseDown() { return mouseDown; },
  get mouseRightDown() { return mouseRightDown; },
  get locked() { return locked; },
  held(action) {
    // Mouse buttons bypass the keyboard Set (KEYS still names them, so the
    // binding table stays the single description of the scheme).
    if (action === 'fire') return mouseDown;
    if (action === 'aim') return mouseRightDown;
    const keys = KEYS[action];
    if (!keys) return false;
    for (const k of keys) if (down.has(k)) return true;
    return false;
  },
  // One-shot edge: true once per physical press, even if the key went up
  // before the next frame ran.
  edge(action) {
    const keys = KEYS[action];
    if (!keys) return false;
    for (const k of keys) {
      if (queued.has(k)) { queued.delete(k); return true; }
    }
    return false;
  },
};
export function bindInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!down.has(e.code)) queued.add(e.code); // ignore auto-repeat
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => { down.delete(e.code); });
  window.addEventListener('blur', () => { down.clear(); queued.clear(); mouseDown = false; mouseRightDown = false; });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouseDown = true;
    else if (e.button === 2) { mouseRightDown = true; e.preventDefault(); }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
    else if (e.button === 2) mouseRightDown = false;
  });
  // Right click is the aim button, so the browser menu must never open on it.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousemove', (e) => { mouseDX += e.movementX || 0; mouseDY += e.movementY || 0; });
  canvas.addEventListener('click', () => {
    if (!locked && canvas.requestPointerLock) { canvas.requestPointerLock(); locked = true; }
  });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
}
export function clearInput() { down.clear(); queued.clear(); mouseDown = false; mouseRightDown = false; }
