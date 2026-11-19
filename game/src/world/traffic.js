// Traffic: cars that follow the road graph, obey lights, avoid the player,
// and pull over for sirens. On-rails along edges — robust and cheap.
import { createVehicle } from '../physics/vehicle.js';
import { clamp, pick, range } from '../random.js';
import { groundHeight } from '../world/roads.js';

const KINDS = ['compact', 'sedan', 'compact', 'sedan', 'truck', 'compact'];
const COLORS = [0xc8c8c8, 0x8a2f2f, 0x2f5d8a, 0xd8b13c, 0x4a7a4a, 0xe8e0d0, 0x5a5a6a];
const TARGET = 38, CAP = 45;

export function createTraffic(scene, roads, rng) {
  return { scene, roads, rng, cars: [], spawnT: 0, lightT: 0 };
}
// Traffic light at the two main crossings: 20 s green, 20 s red, alternating.
function lightState(t, axis) {
  const phase = (t + (axis === 'x' ? 0 : 20)) % 40;
  return phase < 20 ? 'green' : 'red';
}
export function spawnTrafficCar(tr, x, z, heading, edge) {
  const kind = pick(tr.rng, KINDS);
  const v = createVehicle(kind, x, z, heading, pick(tr.rng, COLORS));
  v.mesh.group.position.y = groundHeight(x, z, 0.5);
  tr.scene.add(v.mesh.group);
  const c = { v, edge, dist: 0, speed: 0, target: range(tr.rng, 10, 14), stopped: false };
  tr.cars.push(c);
  return c;
}
function pickNextEdge(tr, nodeIdx, fromEdge) {
  const opts = tr.roads.adj[nodeIdx].filter((o) => o.edge !== fromEdge);
  if (!opts.length) return null;
  return pick(tr.rng, opts);
}
export function updateTraffic(tr, dt, player, siren) {
  const roads = tr.roads;
  tr.spawnT -= dt; tr.lightT += dt;
  // Spawn to keep density near the player.
  if (tr.cars.length < TARGET && tr.spawnT <= 0) {
    tr.spawnT = 0.16;
    const e = pick(tr.rng, roads.edges);
    const t = tr.rng();
    const x = e.ax + (e.bx - e.ax) * t, z = e.az + (e.bz - e.az) * t;
    const d = Math.hypot(x - player.pos.x, z - player.pos.z);
    if (d > 60 && d < 150) {
      const heading = Math.atan2(e.bx - e.ax, e.bz - e.az);
      const c = spawnTrafficCar(tr, x, z, heading, roads.edges.indexOf(e));
      c.dist = e.len * t;
      c.v.pos.y = groundHeight(x, z, 0.5);
    }
  }
  for (let i = tr.cars.length - 1; i >= 0; i--) {
    const c = tr.cars[i];
    const v = c.v;
    const d = Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z);
    if (d > 190) { tr.scene.remove(v.mesh.group); tr.cars.splice(i, 1); continue; }
    const e = roads.edges[c.edge];
    const ex = e.bx - e.ax, ez = e.bz - e.az;
    const elen = e.len || 1;
    const dirX = ex / elen, dirZ = ez / elen;
    // Lane offset: right-hand traffic, 1.75 m from centre.
    const lx = -dirZ * 1.75, lz = dirX * 1.75;
    // Red light: stop before the next node.
    const toNode = elen - c.dist;
    const nodeZ = e.bz, nodeX = e.bx;
    const major = (Math.abs(nodeX) === 45 || Math.abs(nodeZ) === 45);
    const red = major && lightState(tr.lightT, Math.abs(ex) > Math.abs(ez) ? 'x' : 'z') === 'red';
    let want = c.target;
    if (red && toNode < 35) want = toNode < 6 ? 0 : Math.max(0, (toNode - 6) * 0.4);
    // Player ahead in the lane: slow down, honk under 12 m.
    const pdx = player.pos.x - v.pos.x, pdz = player.pos.z - v.pos.z;
    const ahead = pdx * dirX + pdz * dirZ;
    const side = Math.abs(pdx * -dirZ + pdz * dirX);
    if (ahead > 0 && ahead < 35 && side < 4) want = Math.min(want, ahead < 6 ? 0 : ahead * 0.3);
    // Siren: pull over and stop.
    if (siren && d < 60) want = 0;
    c.speed = lerp(c.speed, want, clamp(dt * (want < c.speed ? 3.5 : 1.2), 0, 1));
    c.dist += c.speed * dt;
    const px = e.ax + dirX * c.dist + lx, pz = e.az + dirZ * c.dist + lz;
    v.pos.x = px; v.pos.z = pz;
    v.pos.y = groundHeight(px, pz, 0.5);
    v.heading = Math.atan2(dirX, dirZ);
    v.mesh.group.position.copy(v.pos);
    v.mesh.group.rotation.y = v.heading;
    // Arrived at the node: pick the next edge.
    if (c.dist >= elen - 0.5) {
      const next = pickNextEdge(tr, e.b, c.edge);
      if (!next) { tr.scene.remove(v.mesh.group); tr.cars.splice(i, 1); continue; }
      c.edge = next.edge; c.dist = 0;
    }
  }
}
export function lerp(a, b, t) { return a + (b - a) * t; }
