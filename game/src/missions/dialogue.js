// Dialog frames: a bottom panel with a two-colour vector portrait, the
// speaker's name and role, and lines advanced with Space / E / click.
// Portraits are drawn on canvas at runtime — no image files, no network.
import { CHARACTERS } from './jobs.js';

let panel, portrait, nameEl, roleEl, textEl, promptEl;
let queue = [], index = 0, onDone = null, open = false;

export function bindDialogue(doc) {
  panel = doc.getElementById('dialog');
  portrait = doc.getElementById('dialog-portrait');
  nameEl = doc.getElementById('dialog-name');
  roleEl = doc.getElementById('dialog-role');
  textEl = doc.getElementById('dialog-text');
  promptEl = doc.getElementById('dialog-prompt');
  panel.addEventListener('click', advance);
}
function drawPortrait(who) {
  const c = CHARACTERS[who];
  const g = portrait.getContext('2d');
  g.clearRect(0, 0, 160, 160);
  g.fillStyle = c.color; g.fillRect(0, 0, 160, 160);
  // Shoulders.
  g.fillStyle = '#0e1a22';
  g.beginPath(); g.moveTo(20, 160); g.quadraticCurveTo(80, 96, 140, 160); g.closePath(); g.fill();
  // Head.
  g.fillStyle = '#c98d5f';
  g.beginPath(); g.arc(80, 66, 30, 0, Math.PI * 2); g.fill();
  // Hair / headgear silhouette.
  g.fillStyle = '#0e1a22';
  g.beginPath(); g.arc(80, 58, 30, Math.PI, 0); g.fill();
  g.fillRect(50, 52, 60, 10);
  // Accent: a single stripe, the character's colour.
  g.fillStyle = c.accent; g.fillRect(0, 148, 160, 6);
  g.fillStyle = c.accent;
  g.font = 'bold 26px system-ui'; g.textAlign = 'center';
  g.fillText(c.name[0], 80, 138);
}
export function showDialog(lines, done) {
  queue = lines; index = 0; onDone = done || null;
  open = true; panel.classList.add('show');
  renderLine();
}
export function isDialogOpen() { return open; }
function renderLine() {
  const line = queue[index];
  const c = CHARACTERS[line.who];
  drawPortrait(line.who);
  nameEl.textContent = c.name;
  nameEl.style.color = c.accent;
  roleEl.textContent = c.role;
  textEl.textContent = '“' + line.text + '”';
  promptEl.textContent = index < queue.length - 1 ? '[SPASI] lanjut' : '[SPASI] tutup';
}
export function advance() {
  if (!open) return;
  index++;
  if (index >= queue.length) {
    open = false; panel.classList.remove('show');
    const cb = onDone; onDone = null;
    if (cb) cb();
  } else renderLine();
}
