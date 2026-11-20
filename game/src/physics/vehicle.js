// Arcade vehicle physics: grip, drift, suspension, collisions. The model is
// a velocity vector split into forward/lateral parts; lateral grip decays
// the sideways part, and the handbrake cuts that grip so the tail steps out.
import * as THREE from 'three';
import { VEHICLES } from '../config.js';
import { clamp, lerp, smooth } from '../random.js';
import { resolveCircle, circleHit } from './collision.js';
import { groundHeight, onRoad } from '../world/roads.js';

const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2836, roughness: 0.2, metalness: 0.6 });
// Shared materials: up to 45 cars are alive at once, so trim, lamps, plates and
// rims each get exactly one material for the whole traffic fleet.
const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.3 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xd5d9dd, roughness: 0.34, metalness: 0.4, emissive: 0x0c0d0e });
const plateMat = new THREE.MeshStandardMaterial({ color: 0xdfe3d6, roughness: 0.5, metalness: 0.1, emissive: 0x121210 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0x554400 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0xaa1111, emissive: 0x330000 });
const cargoMat = new THREE.MeshStandardMaterial({ color: 0x8a6f4a, roughness: 0.95 });

// --- tiny geometry merger ---------------------------------------------------
// Every detail box of one material is baked into a single BufferGeometry, so a
// fully detailed car still costs only a handful of draw calls instead of ~20.
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const _eul = new THREE.Euler();
const _qt = new THREE.Quaternion();
const _vp = new THREE.Vector3();
const _vs = new THREE.Vector3();
const _mx = new THREE.Matrix4();

function part(geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const out = geo.index ? geo.toNonIndexed() : geo.clone();
  _eul.set(rx, ry, rz);
  _qt.setFromEuler(_eul);
  _vp.set(x, y, z); _vs.set(sx, sy, sz);
  _mx.compose(_vp, _qt, _vs);
  out.applyMatrix4(_mx);
  return out;
}
function box(w, h, d, x, y, z, rx, ry, rz) {
  return part(unitBox, x, y, z, rx, ry, rz, w, h, d);
}
function merge(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.array.length;
  const p = new Float32Array(n), nn = new Float32Array(n);
  let o = 0;
  for (const g of geos) {
    p.set(g.attributes.position.array, o);
    nn.set(g.attributes.normal.array, o);
    o += g.attributes.position.array.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  return out;
}

// One alloy rim geometry shared by all four wheels of every car: hub disc +
// five spokes + outer lip. The wheel spins, so the spokes turn with it.
const rimGeo = (() => {
  const parts = [];
  const hub = new THREE.CylinderGeometry(0.095, 0.095, 0.075, 8);
  parts.push(part(hub, 0, 0, 0, 0, 0, Math.PI / 2));
  hub.dispose();
  const lip = new THREE.TorusGeometry(0.20, 0.026, 4, 10);
  parts.push(part(lip, 0, 0, 0, 0, Math.PI / 2, 0));
  lip.dispose();
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.BoxGeometry(0.05, 0.20, 0.045);
    parts.push(part(spoke, 0, 0.105, 0, (i / 5) * Math.PI * 2));
    spoke.dispose();
  }
  return merge(parts);
})();

// Per-kind shared geometry: traffic reuses the same buffers for every car of
// the same model (only the paint material is per-car).
const carGeoCache = new Map();
function carGeos(kind, spec) {
  const hit = carGeoCache.get(kind);
  if (hit) return hit;
  const W = spec.wid, L = spec.len, hw = W / 2, hl = L / 2;
  const truck = kind === 'truck';
  // Cab sits forward on a truck (open bed behind); centred on a car.
  const cabLen = truck ? L * 0.30 : L * 0.46;
  const cabZ = truck ? L * 0.18 : -L * 0.05;
  const cabW = W - 0.32;
  const cabFront = cabZ + cabLen / 2, cabBack = cabZ - cabLen / 2;

  // Painted shell: main box + hood bulge + roof panel (and the bed rails on a
  // truck). One material => one merged mesh.
  const paint = [box(W, 0.62, L, 0, 0.55, 0)];
  // Hood bulge runs from the windscreen base to the nose, so the front of the
  // car reads as bonnet + grille rather than a flat slab.
  const hoodFront = hl - 0.07, hoodBack = cabFront, hoodLen = hoodFront - hoodBack;
  paint.push(box(W * 0.86, 0.12, hoodLen, 0, 0.87, (hoodFront + hoodBack) / 2));
  paint.push(box(cabW + 0.04, 0.09, cabLen * 0.95, 0, 1.335, cabZ));
  let cargo = null;
  if (truck) {
    const bedFront = cabBack - 0.02, bedBack = -hl + 0.05;
    const bedLen = bedFront - bedBack, bedZ = (bedFront + bedBack) / 2;
    for (const s of [-1, 1]) paint.push(box(0.12, 0.36, bedLen, s * (hw - 0.06), 1.04, bedZ));
    paint.push(box(W - 0.12, 0.36, 0.10, 0, 1.04, bedFront));
    paint.push(box(W - 0.10, 0.32, 0.10, 0, 1.02, bedBack));
    // Crates riding in the bed: the silhouette that says "truck", not "sedan".
    cargo = merge([
      box(W * 0.36, 0.50, bedLen * 0.42, -W * 0.16, 1.10, bedZ - bedLen * 0.08, 0, 0.05),
      box(W * 0.30, 0.42, bedLen * 0.30, W * 0.20, 1.06, bedZ + bedLen * 0.18, 0, -0.07),
    ]);
  }

  // Dark trim: bumpers, lip, grille, mirrors, skirts, door line + handle, pillars.
  const trim = [
    box(W * 0.54, 0.20, 0.05, 0, 0.605, hl + 0.005), // grille
  ];
  for (const s of [-1, 1]) {
    trim.push(box(W + 0.06, 0.18, 0.28, 0, 0.42, s * (hl - 0.02)));          // bumper
    trim.push(box(W * 0.90, 0.16, 0.14, 0, 0.26, s * (hl - 0.04)));          // valance
    trim.push(box(0.16, 0.12, 0.22, s * (hw + 0.06), 1.02, truck ? cabFront - 0.12 : L * 0.18)); // mirror
    trim.push(box(0.12, 0.16, L * 0.60, s * (hw - 0.02), 0.28, 0));          // side skirt
    trim.push(box(0.02, 0.05, L * 0.26, s * (hw + 0.008), 0.70, cabZ));      // door line
    trim.push(box(0.05, 0.05, 0.18, s * (hw + 0.015), 0.76, cabZ + cabLen * 0.16)); // handle
    trim.push(box(0.06, 0.46, 0.08, s * (cabW / 2 - 0.02), 1.09, cabFront - 0.05, -0.18)); // A-pillar
    trim.push(box(0.06, 0.42, 0.08, s * (cabW / 2 - 0.02), 1.08, cabBack + 0.05, 0.18));   // C-pillar
  }

  // Glasshouse: windscreen + rear screen + one side window per side, framed
  // by the roof panel and the A/C pillars in the trim batch.
  const glass = [
    box(0.05, 0.46, cabLen * 0.88, -cabW / 2, 1.09, cabZ),
    box(0.05, 0.46, cabLen * 0.88, cabW / 2, 1.09, cabZ),
    box(cabW * 0.98, 0.46, 0.06, 0, 1.075, cabFront - 0.02, -0.18),
    box(cabW * 0.94, 0.40, 0.06, 0, 1.065, cabBack + 0.02, 0.18),
  ];

  // Lamps + number plates (both sides of the car, one mesh each).
  const head = [], tail = [], plate = [];
  for (const s of [-1, 1]) {
    head.push(box(0.30, 0.14, 0.06, s * (hw - 0.35), 0.62, hl));
    tail.push(box(0.30, 0.14, 0.06, s * (hw - 0.35), 0.62, -hl));
  }
  plate.push(box(0.42, 0.12, 0.03, 0, 0.44, hl + 0.12));
  plate.push(box(0.42, 0.12, 0.03, 0, 0.44, -(hl + 0.12)));

  const out = {
    paint: merge(paint), trim: merge(trim), glass: merge(glass),
    head: merge(head), tail: merge(tail), plate: merge(plate), cargo,
  };
  carGeoCache.set(kind, out);
  return out;
}

export function buildCarMesh(kind, color) {
  const spec = VEHICLES[kind];
  const g = new THREE.Group();
  const body = new THREE.Group();
  // Clearcoat paint: the sun glints on the body instead of a flat matte.
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.55,
    clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const geo = carGeos(kind, spec);
  const shell = new THREE.Mesh(geo.paint, paint);
  shell.castShadow = true; body.add(shell);
  const trim = new THREE.Mesh(geo.trim, trimMat);
  trim.castShadow = true; body.add(trim);
  const glass = new THREE.Mesh(geo.glass, glassMat);
  glass.castShadow = true; body.add(glass);
  body.add(new THREE.Mesh(geo.head, headMat), new THREE.Mesh(geo.tail, tailMat));
  body.add(new THREE.Mesh(geo.plate, plateMat));
  if (geo.cargo) {
    const cargo = new THREE.Mesh(geo.cargo, cargoMat);
    cargo.castShadow = true; body.add(cargo);
  }
  // Wheels: dark tire + bright alloy rim on the outboard face. Front pair
  // still steers through wheels[0]/[1].rotation.y and all four spin on .x.
  const wheels = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Group();
    // 'YXZ' so spin (x) happens inside steer (y) and the axle stays on the
    // car's x axis while the front wheels are turned.
    w.rotation.order = 'YXZ';
    const tire = new THREE.Mesh(wheelGeo, tireMat);
    tire.rotation.z = Math.PI / 2; tire.castShadow = true; w.add(tire);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.x = sx * 0.115; w.add(rim);
    w.position.set(sx * (spec.wid / 2 - 0.1), 0.34, sz * (spec.len / 2 - 0.7));
    g.add(w); wheels.push(w);
  }
  g.add(body);
  // Soft contact shadow: grounds the car on the road without a shadow-map
  // sample per pixel. Sits just above the road/sidewalk planes (0.02/0.04).
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.wid + 0.7, spec.len + 0.7),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.06; g.add(blob);
  return { group: g, body, wheels };
}

export function createVehicle(kind, x, z, heading, color) {
  const spec = VEHICLES[kind];
  const mesh = buildCarMesh(kind, color ?? spec.color);
  return {
    kind, spec, mesh, heading, speed: 0,
    vel: new THREE.Vector3(0, 0, 0),
    pos: new THREE.Vector3(x, 0, z),
    steer: 0, drift: false, slip: 0, damage: 0, dead: false,
    roll: 0, pitch: 0, bob: 0, smoke: false, rpm: 0,
  };
}
// input: {throttle -1..1, steer -1..1, brake, hand, surface ('road'|'offroad'|'mud')}
// world: {tide} for ground height. Returns collision info.
export function stepVehicle(v, input, dt, tide) {
  const s = v.spec;
  const surf = input.surface === 'offroad' ? 0.55 : input.surface === 'mud' ? 0.4 : 1;
  const top = s.top * (surf < 1 ? 0.6 : 1);
  const fwdX = Math.sin(v.heading), fwdZ = Math.cos(v.heading);
  // Longitudinal: throttle / brake / reverse / drag.
  if (input.throttle > 0) v.speed += s.accel * input.throttle * dt * (1 - Math.max(0, v.speed) / top);
  if (input.brake) v.speed -= s.brake * dt * Math.sign(v.speed || 1);
  if (input.throttle < 0) v.speed += s.accel * 0.5 * input.throttle * dt; // reverse
  if (!input.throttle && !input.brake) v.speed -= v.speed * 0.6 * dt; // drag
  v.speed = clamp(v.speed, -12, top);
  if (Math.abs(v.speed) < 0.05 && !input.throttle) v.speed = 0;
  // Steering: angle shrinks with speed; handbrake adds yaw and cuts rear grip.
  const spd = Math.abs(v.speed);
  const maxSteer = lerp(0.56, 0.14, clamp(spd / top, 0, 1));
  const targetSteer = clamp(input.steer, -1, 1) * maxSteer;
  v.steer = lerp(v.steer, targetSteer, clamp(dt * 8, 0, 1));
  const drifting = input.hand && spd > 9.7;
  v.drift = drifting;
  const yawBoost = drifting ? 1.8 : 1;
  const yaw = (spd / Math.max(2.6, s.len)) * Math.tan(v.steer) * Math.sign(v.speed || 1) * yawBoost;
  // steer +1 = turn RIGHT on screen. Heading increases rotate the forward
  // vector toward screen left, so a right turn must DECREASE heading.
  v.heading -= yaw * dt;
  // Velocity: forward component follows speed; lateral decays by grip.
  const nfX = Math.sin(v.heading), nfZ = Math.cos(v.heading);
  const fComp = v.vel.x * nfX + v.vel.z * nfZ;
  let lComp = v.vel.x * -nfZ + v.vel.z * nfX;
  const gripRate = (drifting ? 1.6 : 9) * s.grip * surf;
  lComp *= Math.max(0, 1 - gripRate * dt);
  v.slip = Math.abs(lComp);
  v.vel.set(nfX * fComp + -nfZ * lComp, 0, nfZ * fComp + nfX * lComp);
  // Blend velocity toward pure forward*speed (arcade stability).
  const blend = clamp(dt * (drifting ? 2 : 6), 0, 1);
  v.vel.x = lerp(v.vel.x, nfX * v.speed, blend);
  v.vel.z = lerp(v.vel.z, nfZ * v.speed, blend);
  v.pos.x += v.vel.x * dt; v.pos.z += v.vel.z * dt;
  v.pos.y = groundHeight(v.pos.x, v.pos.z, tide);
  // Buildings push the car out; the hit kills speed and adds damage.
  const r = s.len / 2;
  const res = resolveCircle(v.pos, r);
  if (res.hit) {
    const imp = Math.abs(v.speed);
    if (imp > 4) {
      v.damage += (imp * s.mass / 1000) * 0.8;
      v.speed *= 0.35;
      v.vel.multiplyScalar(0.35);
    } else { v.speed *= 0.6; v.vel.multiplyScalar(0.6); }
  }
  if (v.damage >= 100) { v.dead = true; v.speed = 0; }
  // Visuals: body roll/pitch, suspension bob, wheel spin + steer.
  const targetRoll = -v.steer * 2.2 * clamp(spd / top, 0, 1) * 0.06;
  const targetPitch = (input.brake ? 0.05 : 0) - (input.throttle > 0 ? 0.03 : 0);
  v.roll = lerp(v.roll, targetRoll, clamp(dt * 6, 0, 1));
  v.pitch = lerp(v.pitch, targetPitch, clamp(dt * 6, 0, 1));
  v.bob = Math.sin(performance.now() * 0.02) * 0.01 * clamp(spd / top, 0, 1);
  v.mesh.body.rotation.z = v.roll;
  v.mesh.body.rotation.x = v.pitch;
  v.mesh.body.position.y = v.bob;
  v.rpm = clamp(spd / top, 0, 1);
  v.smoke = v.slip > 2.2;
  for (const w of v.mesh.wheels) w.rotation.x += (v.speed / 0.34) * dt;
  if (v.mesh.wheels[0]) v.mesh.wheels[0].rotation.y = -v.steer * 0.8;
  if (v.mesh.wheels[1]) v.mesh.wheels[1].rotation.y = -v.steer * 0.8;
  v.mesh.group.position.copy(v.pos);
  v.mesh.group.rotation.y = v.heading;
  return res;
}
export function carCollide(a, b) {
  const d = circleHit(a.pos.x, a.pos.z, a.spec.len / 2, b.pos.x, b.pos.z, b.spec.len / 2);
  if (d <= 0) return false;
  const dx = (b.pos.x - a.pos.x) || 0.01, dz = (b.pos.z - a.pos.z) || 0.01;
  const len = Math.hypot(dx, dz), nx = dx / len, nz = dz / len;
  a.pos.x -= nx * d / 2; a.pos.z -= nz * d / 2;
  b.pos.x += nx * d / 2; b.pos.z += nz * d / 2;
  const imp = Math.abs(a.speed - b.speed);
  if (imp > 3) { a.damage += imp * 0.4; b.damage += imp * 0.4; }
  a.speed *= 0.7; b.speed *= 0.7;
  return true;
}
export function surfaceAt(x, z) {
  return onRoad(x, z) ? 'road' : 'offroad';
}
