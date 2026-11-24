// Pedestrians: they walk the sidewalks, cross at zebras, and panic — run
// from gunfire and carjackings. Cheap box figures, pooled.
import * as THREE from 'three';
import { clamp, pick, range } from '../random.js';
import { groundHeight, clampToBridgeDeck, nearestRoadPoint, roadDirection, onRoad } from '../world/roads.js';
import { resolveCircle } from '../physics/collision.js';
import { CITY } from '../config.js';

const SHIRTS = [0xd84a3a, 0x3a7ad8, 0x3a9a5a, 0xd8b13c, 0x8a5ad8, 0xe8e0d0, 0x2a2e33];
const TARGET = 60, CAP = 75;
// Sidewalk line: the kerb sits at roadWidth / 2 + 1 (that is where onRoad()
// stops calling it asphalt); 1.5 m further out keeps a walker off the kerb.
const SIDEWALK = CITY.roadWidth / 2 + 1.5; // 7.5 m from the centre line
const SNAP_MAX = 30;                       // snap a spawn only when the road is this close
// Heading that walks ALONG an edge. roadDirection() is written for meshes
// whose local +x is the direction of travel; walkers here move along local
// +z (pos.x += sin(heading), pos.z += cos(heading)), so add a quarter turn.
function edgeWalkHeading(e) { return roadDirection(e) + Math.PI / 2; }
// Nearest point on ONE named edge (same maths as nearestRoadPoint, no scan).
function nearestOnEdge(e, x, z) {
  const dx = e.bx - e.ax, dz = e.bz - e.az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((x - e.ax) * dx + (z - e.az) * dz) / len2;
  t = clamp(t, 0, 1);
  const px = e.ax + dx * t, pz = e.az + dz * t;
  return { x: px, z: pz, edge: e, dist: Math.hypot(px - x, pz - z) };
}
// Anything below street level is water, not pavement: groundHeight() returns
// the tide surface (-1.3) over the river band and the harbour basin, and -1.5
// at the mud ford. Walkers must never stand there.
const WADE_Y = -0.4;
function inWater(x, z) { return groundHeight(x, z, 0.5) < WADE_Y; }
// Nearest dry ground to a spot that ended up in water. Walks outward in
// 3 m rings over eight directions and returns the first sample whose
// groundHeight() is above the tide (the river band, the mud ford and the
// harbour basin all read as water). 20 rings reach 60 m, enough to cross the
// 90 m channel from anywhere. Null only if the whole search is wet.
const DRY_DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
function drySpot(x, z) {
  for (let ring = 1; ring <= 20; ring++) {
    for (const [dx, dz] of DRY_DIRS) {
      const sx = x + dx * ring * 3, sz = z + dz * ring * 3;
      if (sx < -350 || sx > 350 || sz < -440 || sz > 260) continue;
      if (!inWater(sx, sz)) return { x: sx, z: sz };
    }
  }
  return null;
}

function buildPedMesh(color) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.28), shirt);
  torso.position.y = 1.1; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.28), skin);
  head.position.y = 1.62; g.add(head);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.9 }));
    leg.position.set(s * 0.13, 0.4, 0); g.add(leg); legs.push(leg);
  }
  return { group: g, legs };
}
export function createPeds(scene, rng) {
  return { scene, rng, list: [], spawnT: 0 };
}
export function spawnPed(pd, x, z) {
  // Never open a walk on the river: a spawn point in the band is moved to the
  // nearest dry bank before the figure is built.
  if (inWater(x, z)) {
    const dry = drySpot(x, z);
    if (dry) { x = dry.x; z = dry.z; } else return null;
  }
  const m = buildPedMesh(pick(pd.rng, SHIRTS));
  m.group.position.set(x, groundHeight(x, z, 0.5), z);
  pd.scene.add(m.group);
  const p = { mesh: m, pos: new THREE.Vector3(x, 0, z), heading: pd.rng() * Math.PI * 2,
    speed: 1.3, state: 'walk', panic: 0, waitT: 0, side: pd.rng() < 0.5 ? -1 : 1,
    blocked: 0 };
  resolveCircle(p.pos, 0.4); // never spawn inside a building
  pd.list.push(p);
  return p;
}
export function panicPeds(pd, x, z, radius) {
  for (const p of pd.list) {
    const d = Math.hypot(p.pos.x - x, p.pos.z - z);
    if (d < radius) {
      p.state = 'panic'; p.panic = 6;
      p.heading = Math.atan2(p.pos.x - x, p.pos.z - z);
    }
  }
}
export function updatePeds(pd, dt, player, cars, roads) {
  pd.spawnT -= dt;
  if (pd.list.length < TARGET && pd.spawnT <= 0) {
    pd.spawnT = 0.25;
    const a = pd.rng() * Math.PI * 2, r = range(pd.rng, 20, 90);
    let x = player.pos.x + Math.sin(a) * r, z = player.pos.z + Math.cos(a) * r;
    // R10/bug3 — new walkers must open on a SIDEWALK, not in the middle of a
    // lane or in a back garden. The random point is snapped to the nearest
    // road centre line and then pushed 7.5 m out along the perpendicular, on
    // a random side; the opening heading runs along the edge so the figure
    // starts straight away down the pavement. When the nearest road is
    // further than SNAP_MAX the random point is kept as-is (open ground).
    let heading = null;
    const near = roads ? nearestRoadPoint(roads, x, z) : null;
    if (near && Math.hypot(near.x - x, near.z - z) <= SNAP_MAX) {
      const along = edgeWalkHeading(near.edge);
      const side = pd.rng() < 0.5 ? -1 : 1;
      // perpendicular of the walk direction (sin h, cos h) is (cos h, -sin h)
      const sx = near.x + Math.cos(along) * SIDEWALK * side;
      const sz = near.z - Math.sin(along) * SIDEWALK * side;
      if (sx > -350 && sx < 350 && sz > -440 && sz < 260 && !inWater(sx, sz)) {
        x = sx; z = sz;
        heading = along + range(pd.rng, -0.25, 0.25);
      }
    }
    if (x > -350 && x < 350 && z > -440 && z < 260) {
      const ped = spawnPed(pd, x, z);
      if (ped) {
        if (heading !== null) ped.heading = heading;
        // spawnPed pushes the figure out of any building it landed in, and at
        // a corner that push can carry it back onto the asphalt (measured
        // 1.3 m from a centre line against a 7 m kerb). Nudge it back out to
        // the sidewalk line on the side it ended up on; if that spot is wet,
        // drop it rather than open the walk in the river.
        if (roads && onRoad(ped.pos.x, ped.pos.z)) {
          const nr2 = nearestRoadPoint(roads, ped.pos.x, ped.pos.z);
          const a2 = edgeWalkHeading(nr2.edge);
          const px = Math.cos(a2), pz = -Math.sin(a2);
          const sd = (ped.pos.x - nr2.x) * px + (ped.pos.z - nr2.z) * pz >= 0 ? 1 : -1;
          const cx = nr2.x + px * SIDEWALK * sd, cz = nr2.z + pz * SIDEWALK * sd;
          if (!inWater(cx, cz)) { ped.pos.x = cx; ped.pos.z = cz; }
          else { pd.scene.remove(ped.mesh.group); pd.list.pop(); }
        }
      }
    }
  }
  for (let i = pd.list.length - 1; i >= 0; i--) {
    const p = pd.list[i];
    const d = Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z);
    if (d > 130) { pd.scene.remove(p.mesh.group); pd.list.splice(i, 1); continue; }
    // Nearest pavement line for this walker, measured once per frame and
    // reused by the wander damping and the kerb steering below. At an
    // intersection two kerbs are equally near, and taking the global nearest
    // every frame made a walker flip between the crossing edges and stall on
    // the spot; it therefore keeps walking its current edge unless another
    // one is clearly closer.
    let near = null;
    if (roads) {
      near = nearestRoadPoint(roads, p.pos.x, p.pos.z);
      if (near && p.edge) {
        const stay = nearestOnEdge(p.edge, p.pos.x, p.pos.z);
        if (stay.dist < near.dist + 6) near = stay;
      }
      if (near) p.edge = near.edge;
    }
    const offLine = near ? Math.hypot(near.x - p.pos.x, near.z - p.pos.z) : Infinity;
    // R10/bug3 — on the pavement a walker should stroll ALONG it: within
    // ~2.5 m of the sidewalk line the random turn is damped, so drift off the
    // kerb into the asphalt or a yard is rare. Never while panicking, never
    // while standing in water, and never out on the asphalt — there the
    // perpendicular return below is in charge, and aligning it along the road
    // would only make the two rules pull against each other.
    const onAsphalt = onRoad(p.pos.x, p.pos.z);
    const atCurb = !!near && !onAsphalt && offLine < SIDEWALK + 2.5
      && !inWater(p.pos.x, p.pos.z);
    if (p.state === 'panic') {
      p.panic -= dt;
      p.speed = 5.5;
      if (p.panic <= 0) p.state = 'walk';
    } else {
      p.speed = 1.3;
      // Wander: mostly straight along sidewalks, turn at random.
      if (pd.rng() < dt * 0.05) {
        const amp = atCurb ? 0.3 : 1.2;
        p.heading += range(pd.rng, -amp, amp);
      }
    }
    // Ease the heading onto the edge direction while on the kerb, so the
    // pavement run stays parallel instead of slowly diverging. The forward
    // sense is kept (whichever of the two edge directions is nearer the
    // current heading), so nobody does a U-turn just to be "aligned".
    // A walker that resolution could not move forward (a wall, a shop front)
    // is steered off the line instead: without this the alignment alone would
    // hold it pressed against the same wall forever.
    if (atCurb && p.state === 'walk' && p.blocked < 0.35) {
      let t = edgeWalkHeading(near.edge) - p.heading;
      t = Math.atan2(Math.sin(t), Math.cos(t));
      if (Math.abs(t) > Math.PI / 2) t = t > 0 ? t - Math.PI : t + Math.PI;
      p.heading += clamp(t, -1.1 * dt, 1.1 * dt);
    }
    // Water avoidance, before the step: probe the next 2.6 m of the walk. If
    // it is water, turn toward the nearest dry heading instead of wading in.
    // The scan runs from the preferred side outward so a figure walking the
    // bank keeps one consistent direction along it instead of jittering.
    const lookX = p.pos.x + Math.sin(p.heading) * 2.6;
    const lookZ = p.pos.z + Math.cos(p.heading) * 2.6;
    if (inWater(lookX, lookZ) && !inWater(p.pos.x, p.pos.z)) {
      let found = null;
      for (let k = 0; k < 6 && found === null; k++) {
        for (const sgn of [p.side, -p.side]) {
          const h = p.heading + sgn * (0.35 + k * 0.3);
          if (inWater(p.pos.x + Math.sin(h) * 2.6, p.pos.z + Math.cos(h) * 2.6)) continue;
          found = h; break;
        }
      }
      // Surrounded by water on every forward heading: turn back along the way
      // that came, which is dry by construction.
      const target = found === null ? p.heading + Math.PI : found;
      let turn = target - p.heading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      p.heading += clamp(turn, -2.6 * dt, 2.6 * dt);
    }
    const yBefore = p.pos.y; // ground the figure stood on before this step
    const sx0 = p.pos.x, sz0 = p.pos.z;
    p.pos.x += Math.sin(p.heading) * p.speed * dt;
    p.pos.z += Math.cos(p.heading) * p.speed * dt;
    resolveCircle(p.pos, 0.4); // sidewalks, not living rooms: stay out of buildings
    // How far of the intended step actually survived collision: a walker
    // pinned against a wall records it, so the kerb alignment can step aside
    // (see above) and the wander below can turn it loose.
    const wanted = p.speed * dt;
    const moved = Math.hypot(p.pos.x - sx0, p.pos.z - sz0);
    p.blocked = wanted > 1e-6 ? clamp(1 - moved / wanted, 0, 1) : 0;
    if (p.blocked > 0.5) {
      // Hard stop: pick a new heading instead of grinding into the same face.
      // Rate-limited (about four tries a second) so a walker leaning on a wall
      // does not spin wildly frame to frame.
      if (p.state === 'walk' && pd.rng() < dt * 4) p.heading += range(pd.rng, 1.2, 2.4) * (pd.rng() < 0.5 ? -1 : 1);
    } else if (p.blocked > 0) {
      p.heading += (pd.rng() < 0.5 ? -1 : 1) * p.blocked * 2.0 * dt;
    }
    // R10/bug3 — a walker who ended up on the asphalt is turned back to the
    // pavement on the side it is already on: target the perpendicular 7.5 m
    // point off the nearest centre line and steer toward it, clamped to the
    // same turn rate as the water avoidance (2.6 rad/s). Walking state only,
    // and skipped when the target pavement is under water — the water pass
    // above stays in charge there, so this can never walk a ped into the river.
    if (roads && p.state === 'walk' && near && onAsphalt
      && !inWater(p.pos.x, p.pos.z)) {
      const along = edgeWalkHeading(near.edge);
      const px = Math.cos(along), pz = -Math.sin(along); // perpendicular
      const side = (p.pos.x - near.x) * px + (p.pos.z - near.z) * pz >= 0 ? 1 : -1;
      const tx = near.x + px * SIDEWALK * side;
      const tz = near.z + pz * SIDEWALK * side;
      if (!inWater(tx, tz)) {
        let turn = Math.atan2(tx - p.pos.x, tz - p.pos.z) - p.heading;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        p.heading += clamp(turn, -2.6 * dt, 2.6 * dt);
      }
    }
    // Bridge parapets: a walker who reaches the rail is held inside the deck
    // instead of stepping through it and dropping 7.3 m into the river.
    clampToBridgeDeck(p.pos, yBefore, 0.4);
    // R8/M4b — cars are solid to a walking ped, and a panicking crowd runs
    // straight into them. Before this pass a panicking figure could end up
    // INSIDE a parked cruiser or sedan (measured in the cover and street
    // frames: ped 2.31 m from a cruiser centre against a 2.75 m combined
    // radius), which reads as a person growing out of a car roof. No vehicle
    // model here knows about pedestrians, so the push-out is done once, here,
    // against the same circle the car's own collision uses (`spec.len / 2`):
    // the ped is snapped to the outside of that circle instead of being
    // allowed to overlap it, and keeps walking.
    if (cars) {
      for (const v of cars) {
        const rad = v.spec.len / 2 + 0.4;
        const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < rad * rad) {
          const d = Math.sqrt(d2) || 0.001;
          p.pos.x = v.pos.x + (dx / d) * rad;
          p.pos.z = v.pos.z + (dz / d) * rad;
        }
      }
    }
    // R10/bug3 — the player is solid too. Before this a figure teleported onto
    // the player's face simply stood inside them (measured 0.33 m after 1.5 s
    // from a 0 m start): walkers only ever pushed out of cars. Snap the ped to
    // the outside of a 0.8 m circle around the player. Skipped while the
    // player is driving — the player's car is in `cars` above and already
    // covers that case with the wider vehicle radius.
    if (player && player.mode !== 'driving') {
      const rad = 0.8;
      const dx = p.pos.x - player.pos.x, dz = p.pos.z - player.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < rad * rad) {
        // Dead centre: no direction to push toward, so use the walker's own
        // facing (behind it) instead of dividing by zero.
        const d = Math.sqrt(d2);
        const nx = d > 0.001 ? dx / d : -Math.sin(p.heading);
        const nz = d > 0.001 ? dz / d : -Math.cos(p.heading);
        p.pos.x = player.pos.x + nx * rad;
        p.pos.z = player.pos.z + nz * rad;
      }
    }
    p.pos.x = clamp(p.pos.x, -355, 355); p.pos.z = clamp(p.pos.z, -445, 265);
    // The push-outs above run after the parapet clamp and can shove a walker
    // back through the rail (measured 12.99 m off the deck centre against a
    // 12.85 m rail); put it back inside before the ground height is read.
    if (p.pos.z > -390 && p.pos.z < -240) clampToBridgeDeck(p.pos, yBefore, 0.4);
    // Last line of defence: a walker pushed into the river by a car, a crowd,
    // or a camera-less sprint is put back on the nearest dry metre of bank
    // instead of standing in the sea. (Panic and wake routing are unchanged;
    // this only fires when the figure really is below the tide.)
    if (inWater(p.pos.x, p.pos.z)) {
      const dry = drySpot(p.pos.x, p.pos.z);
      if (dry) {
        // Face away from the bank the figure was pushed off, so the next step
        // does not walk straight back into the water.
        const away = Math.atan2(dry.x - p.pos.x, dry.z - p.pos.z);
        p.pos.x = dry.x; p.pos.z = dry.z;
        p.heading = away;
      } else { pd.scene.remove(p.mesh.group); pd.list.splice(i, 1); continue; }
    }
    p.pos.y = groundHeight(p.pos.x, p.pos.z, 0.5);
    const swing = Math.sin(performance.now() * 0.01 + i) * clamp(p.speed / 5.5, 0.2, 1) * 0.45;
    p.mesh.legs[0].rotation.x = swing; p.mesh.legs[1].rotation.x = -swing;
    p.mesh.group.position.copy(p.pos);
    p.mesh.group.rotation.y = p.heading;
  }
}
