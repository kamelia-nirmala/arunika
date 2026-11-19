// Minimap: a round canvas drawn from the same road graph the world and
// traffic use — real street geometry, not a texture. Player, mission,
// police and tide flooding are blips on it.
import { CITY } from '../config.js';

export function drawMinimap(canvas, game) {
  const g = canvas.getContext('2d');
  const S = canvas.width, C = S / 2;
  const span = 760; // world metres across the map
  const px = (x) => C + (x / span) * S;
  const pz = (z) => C + ((z + 90) / span) * S; // world z centre is -90, not 0
  g.clearRect(0, 0, S, S);
  // Sea / ground.
  g.fillStyle = '#0e1a22'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#3a4a3a'; g.fillRect(0, 0, S, S);
  // River.
  g.fillStyle = '#2e7f9e';
  g.fillRect(0, pz(-360), S, pz(-270) - pz(-360));
  // Tide flooding: low roads near the river go teal at high tide.
  if (game.tide.t >= 0.75) {
    g.fillStyle = 'rgba(47,211,196,0.35)';
    g.fillRect(0, pz(-360), S, pz(-300) - pz(-360));
  }
  // Roads.
  g.strokeStyle = '#8a8a8a'; g.lineWidth = Math.max(2, S / 130);
  g.lineCap = 'round';
  for (const e of game.roads.edges) {
    g.beginPath(); g.moveTo(px(e.ax), pz(e.az)); g.lineTo(px(e.bx), pz(e.bz)); g.stroke();
  }
  // Bridge.
  g.strokeStyle = '#f5a623'; g.lineWidth = Math.max(3, S / 90);
  g.beginPath(); g.moveTo(px(-45), pz(-240)); g.lineTo(px(-45), pz(-390)); g.stroke();
  // Mission blip.
  const mk = game.missionMarker ? game.missionMarker() : null;
  if (mk) {
    g.fillStyle = '#f5a623';
    g.beginPath(); g.arc(px(mk.x), pz(mk.z), 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#0e1a22'; g.lineWidth = 2;
    g.beginPath(); g.arc(px(mk.x), pz(mk.z), 7, 0, Math.PI * 2); g.stroke();
  }
  // Police blips.
  g.fillStyle = '#e0453a';
  for (const u of game.police.cars) {
    g.beginPath(); g.arc(px(u.v.pos.x), pz(u.v.pos.z), 4, 0, Math.PI * 2); g.fill();
  }
  // Player arrow.
  const p = game.player;
  g.save();
  g.translate(px(p.pos.x), pz(p.pos.z));
  g.rotate(Math.PI - p.heading); // map: +x right, +z down; arrow drawn pointing up
  g.fillStyle = '#ede6d6';
  g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill();
  g.restore();
}
