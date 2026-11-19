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
export function groundHeight(x, z, tide) {
  let y = 0;
  // Bridge: boulevard x=-45, deck y=6 over the river, ramps either side.
  if (Math.abs(x - CITY.bridgeX) < 13) {
    if (z >= -360 && z <= -270) y = Math.max(y, CITY.bridgeY);
    else if (z > -270 && z < -240) y = Math.max(y, CITY.bridgeY * (1 - smooth((z + 270) / 30)));
    else if (z > -390 && z < -360) y = Math.max(y, CITY.bridgeY * smooth((z + 390) / 30));
  }
  // Mud ford at x=180: only passable at low tide; otherwise deep water.
  if (Math.abs(x - 180) < 8 && z >= -360 && z <= -270) y = tide <= 0.35 ? -1.5 : -99;
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
