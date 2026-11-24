// Traffic: cars that follow the road graph, obey lights, avoid the player,
// and pull over for sirens. On-rails along edges — robust and cheap.
import { createVehicle } from '../physics/vehicle.js';
import { clamp, pick, range } from '../random.js';
import { groundHeight } from '../world/roads.js';

const KINDS = ['compact', 'sedan', 'compact', 'sedan', 'truck', 'compact'];
const COLORS = [0xc8c8c8, 0x8a2f2f, 0x2f5d8a, 0xd8b13c, 0x4a7a4a, 0xe8e0d0, 0x5a5a6a];
const TARGET = 38, CAP = 45;
// Lane centre offset from the street centreline, and how fast a car slides
// sideways between lanes (full 2 x 1.75 m swap in ~1 s, a single-lane change
// in ~0.5 s). Nothing may write a lane offset by teleport.
const LANE = 1.75, LAT_RATE = 3.5;

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
  const c = { v, edge, dist: 0, speed: 0, target: range(tr.rng, 10, 14), stopped: false,
    rev: false, lat: LANE };
  tr.cars.push(c);
  return c;
}
function pickNextEdge(tr, nodeIdx, fromEdge) {
  const opts = tr.roads.adj[nodeIdx].filter((o) => o.edge !== fromEdge);
  if (!opts.length) return null;
  return pick(tr.rng, opts);
}
// Gap a stopped car leaves behind the one in front, on top of the two bodies.
const FOLLOW_BUFFER = 1.8;
// Braking zone behind that gap: inside it the follower eases off the throttle.
const SLOW_ZONE = 12;

// Frame of a car's current edge. Two frames matter and they must not be
// confused: the EDGE frame (a -> b) is fixed, and (edge, dist, lat) is the
// durable state in it; the TRAVEL frame is the edge frame flipped when the car
// is driving back (rev). `dist` is always measured from the edge mouth the car
// entered, so `elen - dist` is the distance left to the next node either way.
// `lat` is a signed metres offset along the fixed edge normal, so flipping rev
// only changes the target sign — the car has to physically slide across 3.5 m
// instead of appearing there.
function railOf(roads, c) {
  const e = roads.edges[c.edge];
  const ex = e.bx - e.ax, ez = e.bz - e.az;
  const elen = e.len || 1;
  const ux = ex / elen, uz = ez / elen;           // edge frame
  const back = !!c.rev;
  return {
    e, ex, ez, elen, back,
    dirX: back ? -ux : ux, dirZ: back ? -uz : uz,      // travel direction
    ox: back ? e.bx : e.ax, oz: back ? e.bz : e.az,    // dist origin
    nx: -uz, nz: ux,                                   // edge-frame normal
    latTarget: back ? -LANE : LANE,
    nodeX: back ? e.ax : e.bx, nodeZ: back ? e.az : e.bz, // node ahead
  };
}
// Write a car's rail position back into the world. Traffic is on rails: the
// only durable state is (edge, dist, lat), so every correction ends here.
function placeOnRail(c, rail) {
  const { ox, oz, dirX, dirZ, nx, nz } = rail;
  const px = ox + dirX * c.dist + nx * c.lat, pz = oz + dirZ * c.dist + nz * c.lat;
  c.v.pos.x = px; c.v.pos.z = pz;
  c.v.pos.y = groundHeight(px, pz, 0.5);
  c.v.heading = Math.atan2(dirX, dirZ);
  c.v.mesh.group.position.copy(c.v.pos);
  c.v.mesh.group.rotation.y = c.v.heading;
}
// Move a car onto another edge at the node it just reached. `adj` lists an edge
// under BOTH endpoints, so the selected edge may leave the node from its `a` or
// its `b`; the direction must follow that, otherwise the car is placed at the
// opposite end of the new edge (measured: a 90 m teleport across the city).
// back = travel b -> a. The car's real position is taken as an offset from the
// node and re-expressed in the new edge's (dir, normal) frame, so the car stays
// where it is across the turn: the lateral part becomes the new `lat`, the
// along-road part the new `dist`.
function relane(c, roads, rail, nextEdge, atNode) {
  const px = rail.ox + rail.dirX * c.dist + rail.nx * c.lat;
  const pz = rail.oz + rail.dirZ * c.dist + rail.nz * c.lat;
  const wx = px - rail.nodeX, wz = pz - rail.nodeZ;
  const e = roads.edges[nextEdge];
  c.edge = nextEdge; c.rev = e.a !== atNode;
  const nr = railOf(roads, c);
  // The lane offset leaves the car up to LANE metres short of the new origin,
  // inside the junction box, so dist may legitimately start slightly negative.
  // Clamping that at 0 was a remaining ~1.8 m hop on right-angle turns.
  c.dist = clamp(wx * nr.dirX + wz * nr.dirZ, -LANE, nr.elen - 0.5);
  c.lat = clamp(wx * nr.nx + wz * nr.nz, -LANE, LANE);
  return nr;
}
// Second layer: after everyone has moved, repair anything that still overlaps.
// Traffic positions are re-derived from (edge, dist) every frame, so any fix
// has to be written back into dist — moving v.pos alone would be erased on the
// next frame.
//
// Same edge is handled as an ordered queue, which is the honest model: one
// lane, one direction, so the cars are sorted by dist and each one is placed
// behind the car in front. The pass is a plain projection (place the follower,
// then measure the next one against its new position), so it converges in one
// go and cannot cancel itself out. Adding a per-frame metre cap here was tried
// and it oscillated: the capped follower dropped behind the car it had just
// been sorted behind, the order flipped, and the pair stayed overlapped.
//
// The only case the projection cannot solve is a car pinned at dist 0 with its
// leader still inside one car length of the edge start (a fresh spawn right on
// top of another car). There is no room to back into, so the LEADER is nudged
// forward by exactly the shortfall — a few metres at most, applied pair by pair
// so the rest of the column follows through the same loop. Shifting the whole
// lane at once was the earlier mistake: one bad pair then teleported every car
// on the edge (measured: 75 m in a single frame).
//
// Different edges only meet at a node, where there is no shared "dist" to push
// back along. Nudging a car backwards on its own rail there was measured to make
// junction overlaps WORSE (712 -> 11545 overlap-frames) and cost a quarter of the
// throughput, because a car shoved back from the mouth just re-approaches and
// meets the same crossing car again. So cross-edge is right-of-way only: a car
// entering a junction eases to the pace of a car already crossing in its path.
const JUNCTION_ZONE = 12; // m around a node where a crossing car has priority
function separateTraffic(tr) {
  const roads = tr.roads;
  // --- Same edge, same direction: project the queue front-to-back ---------
  // Opposite directions on one street are two lanes, not one queue, so the
  // grouping key carries `rev`. Queue order is measured as progress from the
  // mouth the queue entered: reversed cars count from b, so progress is
  // elen - dist and the leader is the SMALLEST dist.
  const lanes = new Map();
  for (const c of tr.cars) {
    const key = c.edge * 2 + (c.rev ? 1 : 0);
    let q = lanes.get(key);
    if (!q) { q = []; lanes.set(key, q); }
    q.push(c);
  }
  for (const q of lanes.values()) {
    if (q.length < 2) continue;
    const rev = !!q[0].rev;
    const elen = roads.edges[q[0].edge].len;
    const prog = (c) => (rev ? elen - c.dist : c.dist);
    const setProg = (c, p) => { c.dist = rev ? elen - p : p; };
    q.sort((x, y) => prog(y) - prog(x)); // leader first
    for (let i = 1; i < q.length; i++) {
      const front = q[i - 1], back = q[i];
      const reach = (front.v.spec.len + back.v.spec.len) / 2 + FOLLOW_BUFFER;
      const limit = prog(front) - reach;      // farthest back this car may sit
      if (prog(back) > limit) {
        if (limit >= 0) {
          setProg(back, limit);
        } else {
          // No room behind the leader: the column in FRONT of this car moves up
          // by the shortfall. Shifting the whole prefix (not just the car
          // immediately ahead) keeps every gap in the column intact — moving
          // only the leader re-opened the gap it had just closed.
          const shift = -limit;
          for (let k = 0; k < i; k++) setProg(q[k], prog(q[k]) + shift);
          setProg(back, 0);
        }
      }
      // The follower must not out-run the leader — but only when it is actually
      // in the following zone. Capping it unconditionally made a single car
      // stopped at a red light hand its 0 m/s to every car behind it on the
      // same edge, including ones 40 m back that had clear road: that alone
      // cost a third of the city's throughput.
      if (back.speed > front.speed && prog(back) > limit - SLOW_ZONE) {
        back.speed = front.speed;
      }
    }
    for (const c of q) placeOnRail(c, railOf(roads, c));
  }
  // --- Different edges: yield at the junction mouth ------------------------
  // Rails meeting at a node share no "dist", so position repair is not even
  // expressible here; right-of-way is what actually holds the junction. A car
  // about to enter a node eases to the pace of a car still crossing in it.
  const cars = tr.cars;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    const ra = railOf(roads, a);
    if (ra.elen - a.dist > JUNCTION_ZONE) continue;   // not entering a junction
    for (let j = 0; j < cars.length; j++) {
      const b = cars[j];
      if (a === b || a.edge === b.edge) continue;     // same edge is a queue
      const rb = railOf(roads, b);
      // Anti-parallel rails are the two lanes of one street: those cars are
      // supposed to pass each other, so they must never brake for each other.
      if (ra.dirX * rb.dirX + ra.dirZ * rb.dirZ < -0.5) continue;
      const dx = b.v.pos.x - a.v.pos.x, dz = b.v.pos.z - a.v.pos.z;
      if (Math.hypot(dx, dz) > JUNCTION_ZONE) continue;
      // Only a car still inside the junction, ahead of a, is in a's way. A car
      // parked at its own red light is past the crossing and must not be
      // waited for — braking for those froze whole streams.
      const along = dx * ra.dirX + dz * ra.dirZ;
      if (along <= 0 || rb.elen - b.dist > JUNCTION_ZONE) continue;
      if (b.speed >= 1 && a.speed > b.speed) a.speed = b.speed;
    }
  }
}
export function updateTraffic(tr, dt, player, siren) {
  const roads = tr.roads;
  tr.spawnT -= dt; tr.lightT += dt;
  // Spawn to keep density near the player. One edge per tick was the old
  // bottleneck: with the band only 60-150 m most picks missed, so the city sat
  // at a handful of cars for minutes. Several edges per tick and a wider band
  // fill the target in seconds.
  if (tr.cars.length < TARGET && tr.spawnT <= 0) {
    tr.spawnT = 0.05;
    for (let k = 0; k < 8 && tr.cars.length < TARGET; k++) {
      const e = pick(tr.rng, roads.edges);
      const t = tr.rng();
      const x = e.ax + (e.bx - e.ax) * t, z = e.az + (e.bz - e.az) * t;
      const d = Math.hypot(x - player.pos.x, z - player.pos.z);
      if (d > 40 && d < 180) {
        // Do not drop a car onto a stretch of road already occupied: the queue
        // projection would have to shove someone by the overlap, and that shows
        // as a sideways/backwards jump. Cheap check, 38 cars at most.
        const idx = roads.edges.indexOf(e), at = e.len * t;
        let clear = true;
        for (const o of tr.cars) {
          if (o.edge !== idx) continue;
          const od = o.rev ? e.len - o.dist : o.dist;
          if (Math.abs(od - at) < 12) { clear = false; break; }
        }
        if (!clear) continue;
        const heading = Math.atan2(e.bx - e.ax, e.bz - e.az);
        const c = spawnTrafficCar(tr, x, z, heading, idx);
        c.dist = e.len * t;
        c.v.pos.y = groundHeight(x, z, 0.5);
      }
    }
  }
  for (let i = tr.cars.length - 1; i >= 0; i--) {
    const c = tr.cars[i];
    const v = c.v;
    const d = Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z);
    if (d > 190) { tr.scene.remove(v.mesh.group); tr.cars.splice(i, 1); continue; }
    const rail = railOf(roads, c);
    const { e, ex, ez, elen, dirX, dirZ } = rail;
    // Lane slide: the target flips side on a U-turn and rotates with the new
    // edge on a turn, and the car eases into it at LAT_RATE m/s.
    const step = LAT_RATE * dt, dl = rail.latTarget - c.lat;
    c.lat += dl > step ? step : dl < -step ? -step : dl;
    // Red light: stop before the next node (a when reversed, b otherwise).
    const toNode = elen - c.dist;
    const nodeZ = rail.nodeZ, nodeX = rail.nodeX;
    const major = (Math.abs(nodeX) === 45 || Math.abs(nodeZ) === 45);
    const red = major && lightState(tr.lightT, Math.abs(ex) > Math.abs(ez) ? 'x' : 'z') === 'red';
    let want = c.target;
    if (red && toNode < 35) want = toNode < 6 ? 0 : Math.max(0, (toNode - 6) * 0.4);
    // Player ahead in the lane: slow down, honk under 12 m.
    const pdx = player.pos.x - v.pos.x, pdz = player.pos.z - v.pos.z;
    const ahead = pdx * dirX + pdz * dirZ;
    const side = Math.abs(pdx * -dirZ + pdz * dirX);
    if (ahead > 0 && ahead < 35 && side < 4) want = Math.min(want, ahead < 6 ? 0 : ahead * 0.3);
    // Leader-follow: the nearest car ahead on THIS edge and direction is a
    // moving wall. A reversed car's "ahead" is a smaller dist, so its gap is
    // mirrored; oncoming cars share neither lane nor queue and are ignored.
    let lead = null, leadGap = Infinity;
    for (const o of tr.cars) {
      if (o === c || o.edge !== c.edge || !!o.rev !== !!c.rev) continue;
      const gap = c.rev ? c.dist - o.dist : o.dist - c.dist;
      if (gap > 0 && gap < leadGap) { lead = o; leadGap = gap; }
    }
    if (lead) {
      const safe = (lead.v.spec.len + v.spec.len) / 2 + FOLLOW_BUFFER;
      if (leadGap <= safe) want = 0;
      else if (leadGap < safe + SLOW_ZONE)
        want = Math.min(want, (leadGap - safe) * 0.5, lead.speed);
    }
    // Siren: pull over and stop.
    if (siren && d < 60) want = 0;
    c.speed = lerp(c.speed, want, clamp(dt * (want < c.speed ? 3.5 : 1.2), 0, 1));
    c.dist += c.speed * dt;
    placeOnRail(c, rail);
    // Arrived at the node: pick the next edge. A degree-1 node (dead end) has
    // no other edge, so the car turns around on the same rail — measured from
    // the other end, heading flipped, lane target on the other side — instead
    // of being deleted from the scene. Never remove a car here.
    if (c.dist >= elen - 0.5) {
      const atNode = c.rev ? e.a : e.b;
      const next = pickNextEdge(tr, atNode, c.edge);
      if (next) {
        relane(c, roads, rail, next.edge, atNode);
      } else {
        // Dead end: mirror the odometer so the car keeps its exact world spot,
        // flip heading, and let the lane slide take it to the other side.
        c.rev = !c.rev; c.dist = elen - c.dist;
      }
      placeOnRail(c, railOf(roads, c));
    }
  }
  separateTraffic(tr);
}
export function lerp(a, b, t) { return a + (b - a) * t; }
