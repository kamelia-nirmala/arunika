// Road graph for Arunika: a grid of avenues/streets, the river band, the
// Sekarwangi bridge (the only crossing), and the tidal mud ford. The same
// graph drives traffic AI, the minimap, and spawn points.
import { CITY } from '../config.js';
import { clamp, smooth } from '../random.js';

const VX = [-315, -225, -135, -45, 45, 135, 225, 315];
const HZ = [-405, -225, -135, -45, 45, 135, 225]; // no road inside the river band

export function buildRoads() {
  const nodes = [];
  const index = new Map();
  const key = (x, z) => x + ',' + z;
  function node(x, z) {
    const k = key(x, z);
    if (!index.has(k)) { index.set(k, nodes.length); nodes.push({ x, z }); }
    return index.get(k);
  }
  const edges = [];
  function edge(ax, az, bx, bz, bridge) {
    edges.push({ a: node(ax, az), b: node(bx, bz), ax, az, bx, bz, bridge: !!bridge,
      len: Math.hypot(bx - ax, bz - az) });
  }
  // Vertical roads: south side z -270..270, north side z -450..-360, bridge at x=-45 joins them.
  for (const x of VX) {
    const zs = x === CITY.bridgeX ? [-450, -405, -225, -135, -45, 45, 135, 225, 270]
      : [-270, -225, -135, -45, 45, 135, 225, 270];
    if (x !== CITY.bridgeX) {
      for (let i = 0; i < zs.length - 1; i++) edge(x, zs[i], x, zs[i + 1], false);
      // north (Sagara Hilir) stub
      edge(x, -450, x, -405, false);
    } else {
      for (let i = 0; i < zs.length - 1; i++) {
        const bridge = (zs[i] === -405 && zs[i + 1] === -225);
        edge(x, zs[i], x, zs[i + 1], bridge);
      }
    }
  }
  // Horizontal roads.
  for (const z of HZ) {
    for (let i = 0; i < VX.length - 1; i++) edge(VX[i], z, VX[i + 1], z, false);
  }
  // Adjacency for AI routing.
  const adj = nodes.map(() => []);
  edges.forEach((e, i) => { adj[e.a].push({ to: e.b, edge: i }); adj[e.b].push({ to: e.a, edge: i }); });
  return { nodes, edges, adj };
}

// Ground height at (x, z): bridge ramps/deck, mud ford. (Terrain is flat;
// Tunjung Mas reads as a hill through its tall white villas and the vista shot.)
import { tideLevel } from './water.js';
// Sekarwangi deck centre line: the S-curve the span is BUILT on (see
// city.js buildBridge) — it leaves the boulevard centreline x=-45 at both
// feet (z -390 and z -240) and swings 8 m off it at midspan. One definition
// only: the mesh, the walkable surface and the parapet corridor all read
// this, so they can never disagree.
export function bridgeCurveX(z) {
  return CITY.bridgeX + 8 * Math.sin(((z + 240) / -150) * Math.PI);
}
// The span's walkable corridor: 26 m of deck (|x - centre| < 13), parapets
// standing on the two edge lines. The rails are meshes only — no collision
// box — so walkers are clamped instead, by the helper below.
export const DECK_HALF = 13;
const RAIL_INNER = 12.85;   // rail centre 13 minus its 0.3 m thickness / 2
// Structure extents along z: the deck sits over the water band (-360..-270)
// and the two approach ramps carry the same parapets down to z -390 / -240.
const SPAN_Z0 = -390, SPAN_Z1 = -240;
const MIN_SPAN_Y = 1.0;     // below this the local surface is the street, not the span
// Keep a walker (player, pedestrian, officer) inside the bridge parapets.
// `y0` is the ground height the walker stood on BEFORE this frame's step:
// the clamp only engages when that was the elevated span itself, so a swimmer
// in the river under the deck, or someone on the pavement beside the ramp
// foot, is never yanked onto the structure. Returns true when the position
// had to be moved back inside the rails.
export function clampToBridgeDeck(pos, y0, r) {
  if (pos.z < SPAN_Z0 || pos.z > SPAN_Z1) return false;
  if (!(y0 > MIN_SPAN_Y)) return false;
  const cx = bridgeCurveX(pos.z);
  const half = RAIL_INNER - Math.min(r, 1);
  const dx = pos.x - cx;
  if (Math.abs(dx) <= half) return false;
  pos.x = cx + Math.sign(dx) * half;
  return true;
}
export function groundHeight(x, z, tide) {
  const t = typeof tide === 'number' ? tide : 0.5;
  let y = 0;
  // Bridge: deck y=6 over the river, ramps either side. The 26 m band follows
  // the deck's own S-curve: measuring it off the straight boulevard centre
  // (|x + 45| < 13) used to leave the eastern half of the painted deck at
  // midspan outside the walkable band — groundHeight() called it open water
  // there, so a player standing on the mesh fell ~7.3 m into the river.
  if (z > -390 && z < -240) {
    const cx = bridgeCurveX(z);
    if (Math.abs(x - cx) < 13) {
      if (z >= -360 && z <= -270) y = Math.max(y, CITY.bridgeY);
      else if (z > -270 && z < -240) y = Math.max(y, CITY.bridgeY * (1 - smooth((z + 270) / 30)));
      else y = Math.max(y, CITY.bridgeY * smooth((z + 390) / 30));
    }
  }
  if (y > 0) return y; // on the bridge deck or a ramp
  // Mud ford at x=180: wade at -1.5 in any tide. (It used to return -99 at
  // high tide, dropping player and cars 99 m through the world.)
  if (Math.abs(x - 180) < 8 && z >= -360 && z <= -270) return -1.5;
  // Open water — the river band and the harbour basin: wade just under the
  // surface instead of strolling on top of it at y=0.
  if (z >= -360 && z <= -270) return tideLevel(t) - 0.4;
  if (x >= 180 && x <= 360 && z >= -450 && z < -390) return tideLevel(t) - 0.4;
  return y;
}
export function onRoad(x, z) {
  const w = CITY.roadWidth / 2 + 1;
  for (const vx of VX) if (Math.abs(vx - x) < w) return true;
  for (const hz of HZ) if (Math.abs(hz - z) < w) return true;
  return false;
}
// Nearest point on any road edge, for snapping spawns.
export function nearestRoadPoint(roads, x, z) {
  let best = null, bd = Infinity;
  for (const e of roads.edges) {
    const dx = e.bx - e.ax, dz = e.bz - e.az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - e.ax) * dx + (z - e.az) * dz) / len2;
    t = clamp(t, 0, 1);
    const px = e.ax + dx * t, pz = e.az + dz * t;
    const d = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d < bd) { bd = d; best = { x: px, z: pz, edge: e }; }
  }
  return best;
}
export function roadDirection(e) {
  return Math.atan2(-(e.bz - e.az), e.bx - e.ax); // heading along the edge
}
