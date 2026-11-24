// Arcade vehicle physics: grip, drift, suspension, collisions. The model is
// a velocity vector split into forward/lateral parts; lateral grip decays
// the sideways part, and the handbrake cuts that grip so the tail steps out.
//
// Light dressing (R6, visual only): real emissive lamps so a car reads as a
// car at golden hour, dark glass instead of a body-coloured block, and a
// bright rim disc on the outer face of every wheel. No new lights, no change
// to any dimension, wheel position, ground clearance or collision radius.
import * as THREE from 'three';
import { VEHICLES } from '../config.js';
import { clamp, lerp, smooth } from '../random.js';
import { resolveCircle, circleHit } from './collision.js';
import { groundHeight, onRoad, clampToBridgeDeck } from '../world/roads.js';

const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 });
// Detail boxes are shared between every car of a kind (a sedan's bonnet deck is
// the same size on all of them), so the geometry cache keeps ~40 traffic cars
// from each allocating a dozen one-off buffers.
const boxCache = new Map();
function boxOf(w, h, d) {
  const k = w.toFixed(3) + '|' + h.toFixed(3) + '|' + d.toFixed(3);
  let geo = boxCache.get(k);
  if (!geo) { geo = new THREE.BoxGeometry(w, h, d); boxCache.set(k, geo); }
  return geo;
}
// Rim disc: small, bright, one per wheel, parented to the wheel so it inherits
// the existing spin and steering untouched.
const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.035, 8);
const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.65 });
// Dark glass: low roughness + high metalness so the cabin reads as a coated
// pane catching the sky, not as a second slab of paint.
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1822, roughness: 0.12, metalness: 0.88 });
// Deeper glass for the inset side panes: they sit in shadow under the roof, so
// they need their own, darker material to still read as glazing rather than as
// a hole in the door.
const glassDeepMat = new THREE.MeshStandardMaterial({ color: 0x080f16, roughness: 0.18, metalness: 0.7 });
// Trim (bumpers, mirrors, grille surround) and the truck bed's rubber mat.
const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.3 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.25, metalness: 0.85 });
const bedMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.95 });

export function buildCarMesh(kind, color) {
  const spec = VEHICLES[kind];
  const g = new THREE.Group();
  const body = new THREE.Group();
  // A truck is not a long sedan: its cab is short and sits forward, leaving a
  // real open bed behind it. That is the one place the silhouette differs by
  // kind — wid/len still come straight from VEHICLES, so collision, wheel
  // placement and ground clearance are untouched.
  const isTruck = kind === 'truck';
  const cabDepth = isTruck ? spec.len * 0.30 : spec.len * 0.45;
  const cabZ = isTruck ? spec.len * 0.14 : -spec.len * 0.05;
  // Clearcoat paint: the sun glints on the body instead of a flat matte.
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.55,
    clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const lower = new THREE.Mesh(boxOf(spec.wid, 0.62, spec.len), paint);
  lower.position.y = 0.55; lower.castShadow = true; body.add(lower);
  // R8/M4b — the cabin is 0.53 tall, not 0.55, so its TOP (1.365) sits 1 cm
  // under the roof cap's top (1.375). At 0.55 the two up-facing planes were
  // exactly coplanar and the depth buffer fought over every pixel of the roof:
  // from the chase cam that artifact read as a grid of dark squares over the
  // rear glass and the roof (the "kotak-kotak" fault). One centimetre is below
  // any visible step and leaves the roof as the only surface at 1.375, which
  // is the height police.js still hangs its lightbar on.
  const cabin = new THREE.Mesh(boxOf(spec.wid - 0.3, 0.53, cabDepth), glassMat);
  cabin.position.set(0, 1.1, cabZ); cabin.castShadow = true; body.add(cabin);
  // --- Cabin, read as glazing in a body-coloured frame ---------------------
  // The single glass block above stays as the window mass, so the car's outer
  // silhouette is exactly what it was. What it lacked was a frame: a roof and
  // four corner pillars of the same paint, so the dark block reads as windows
  // between painted members instead of one dark cube. The roof cap's TOP is
  // the old cabin top (1.375), so a lightbar still sits on the roof at the
  // height police.js has always used.
  const roof = new THREE.Mesh(boxOf(spec.wid - 0.24, 0.055, cabDepth + 0.02), paint);
  roof.position.set(0, 1.3475, cabZ); roof.castShadow = true; body.add(roof);
  // A and C pillars: full-width hoops at the cabin's front and rear edges.
  // Thin (10 cm) so they read as posts, not as extra body volume.
  // R8/M4b — they used to be centred at cabDepth/2 - 0.05, which put their
  // outer face EXACTLY on the cabin's front/rear face. The C-pillar's 0.10 m
  // paint face and the rear glass therefore shared a plane and the depth
  // buffer diced them into the grid of squares the reviewer saw through the
  // rear window. Pulling them 5 mm out makes the pillar stand proud of the
  // glass — the way a real pillar does — and the plane fight is gone.
  for (const s of [1, -1]) {
    const hoop = new THREE.Mesh(boxOf(spec.wid - 0.26, 0.51, 0.10), paint);
    hoop.position.set(0, 1.095, cabZ + s * (cabDepth / 2 - 0.045));
    hoop.castShadow = true; body.add(hoop);
  }
  // Beltline: the painted rail where glass meets door, closing the window box
  // at the bottom so the sill is a bright line and not a shadow gap.
  const belt = new THREE.Mesh(boxOf(spec.wid - 0.26, 0.095, cabDepth + 0.02), paint);
  belt.position.set(0, 0.9075, cabZ); body.add(belt);
  // Side glass: a pane set 1 cm behind the pillar faces on each flank, so the
  // frame stands proud and the glass reads inset (the "windows are recessed"
  // cue the flat block never gave). B-pillars split it into front/rear panes.
  for (const s of [-1, 1]) {
    const pane = new THREE.Mesh(boxOf(0.035, 0.365, cabDepth - 0.34), glassDeepMat);
    pane.position.set(s * (spec.wid / 2 - 0.158), 1.1375, cabZ);
    body.add(pane);
    const bPillar = new THREE.Mesh(boxOf(0.045, 0.42, 0.10), paint);
    bPillar.position.set(s * (spec.wid / 2 - 0.135), 1.11, cabZ - cabDepth * 0.04);
    body.add(bPillar);
  }
  // --- Three volumes: low nose deck, tall cabin, low tail deck -------------
  // Both decks sit 10 cm proud of the 0.86 m waist and stop well below the
  // 1.375 m roof, so the profile steps nose → cabin → tail instead of running
  // as one slab with a block on it.
  const deckY = 0.91;
  const noseZ0 = cabZ + cabDepth / 2, noseZ1 = spec.len / 2;
  const nose = new THREE.Mesh(boxOf(spec.wid - (isTruck ? 0.34 : 0.20), 0.10, noseZ1 - noseZ0), paint);
  nose.position.set(0, deckY, (noseZ0 + noseZ1) / 2); nose.castShadow = true; body.add(nose);
  if (isTruck) {
    // Open bed: a dark floor between two painted side walls, with a tailgate
    // closing the back. The cabin's rear panel is the headboard, so nothing
    // floats and the bed is empty the way a working truck's is.
    const bedZ0 = -spec.len / 2, bedZ1 = cabZ - cabDepth / 2;
    const bedLen = bedZ1 - bedZ0, bedMid = (bedZ0 + bedZ1) / 2;
    const floor = new THREE.Mesh(boxOf(spec.wid - 0.10, 0.06, bedLen), bedMat);
    floor.position.set(0, 0.89, bedMid); body.add(floor);
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(boxOf(0.10, 0.42, bedLen), paint);
      wall.position.set(s * (spec.wid / 2 - 0.05), 1.10, bedMid);
      wall.castShadow = true; body.add(wall);
    }
    const gate = new THREE.Mesh(boxOf(spec.wid - 0.10, 0.42, 0.10), paint);
    gate.position.set(0, 1.10, bedZ0 + 0.05); gate.castShadow = true; body.add(gate);
  } else {
    const tailZ0 = -spec.len / 2, tailZ1 = cabZ - cabDepth / 2;
    const tail = new THREE.Mesh(boxOf(spec.wid - 0.20, 0.10, tailZ1 - tailZ0), paint);
    tail.position.set(0, deckY, (tailZ0 + tailZ1) / 2); tail.castShadow = true; body.add(tail);
  }
  // --- Face: grille bar + logo --------------------------------------------
  // A dark intake panel with two bright slats and a small badge, so the front
  // reads as a face. Emissive-free: it is trim, not a lamp.
  const grille = new THREE.Mesh(boxOf(spec.wid * (isTruck ? 0.62 : 0.52), isTruck ? 0.17 : 0.13, 0.06), trimMat);
  grille.position.set(0, 0.72, spec.len / 2 - 0.01); body.add(grille);
  for (const y of [0.695, 0.745]) {
    const slat = new THREE.Mesh(boxOf(spec.wid * (isTruck ? 0.60 : 0.50), 0.022, 0.02), chromeMat);
    slat.position.set(0, y, spec.len / 2 + 0.025); body.add(slat);
  }
  const badge = new THREE.Mesh(boxOf(0.10, 0.10, 0.03), chromeMat);
  badge.position.set(0, 0.72, spec.len / 2 + 0.04); body.add(badge);
  // Bumpers + side mirrors, so the car reads as a car, not a box.
  for (const s of [-1, 1]) {
    const bumper = new THREE.Mesh(boxOf(spec.wid + 0.06, 0.18, 0.28), trimMat);
    bumper.position.set(0, 0.42, s * (spec.len / 2 - 0.02)); body.add(bumper);
    // Mirror on the door shoulder. The lower body's top is 0.86, so the old
    // y=1.02 left the mirror hanging 10 cm above the paint with only a 2 cm
    // corner overlap — an unsupported box. Now it beds 4 cm into the shoulder
    // (y 0.82..0.94) and 5 cm into the door (x overlap), proud by 11 cm.
    const mirror = new THREE.Mesh(boxOf(0.16, 0.12, 0.22), trimMat);
    mirror.position.set(s * (spec.wid / 2 + 0.03), 0.88, spec.len * 0.18); body.add(mirror);
  }
  // Headlights + taillights. Emissive (no photometric lights): a warm cream
  // lens with a hot rim, and a red rear lens that also lifts on the brakes.
  const hl = new THREE.MeshStandardMaterial({
    color: 0xfff4cf, emissive: 0xffd489, emissiveIntensity: 2.4, roughness: 0.3,
  });
  const tl = new THREE.MeshStandardMaterial({
    color: 0x9e1414, emissive: 0xd11a12, emissiveIntensity: 1.5, roughness: 0.4,
  });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(boxOf(0.3, 0.14, 0.06), hl);
    h.position.set(s * (spec.wid / 2 - 0.35), 0.62, spec.len / 2); body.add(h);
    const t = new THREE.Mesh(boxOf(0.3, 0.14, 0.06), tl);
    t.position.set(s * (spec.wid / 2 - 0.35), 0.62, -spec.len / 2); body.add(t);
  }
  const wheels = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Mesh(wheelGeo, tireMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * (spec.wid / 2 - 0.1), 0.34, sz * (spec.len / 2 - 0.7));
    w.castShadow = true;
    // Rim on the OUTER face. The wheel's cylinder axis is its local +Y (the
    // z=90° lay-flat maps local +Y to world -X), so the outer side is local
    // y = -sx*0.13: it lands proud of the 0.24 m tire and is seen face-on from
    // outside the car. Parented, so spin and steer come for free.
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = -sx * 0.13;
    w.add(rim);
    g.add(w); wheels.push(w);
  }
  g.add(body);
  // Soft contact shadow: grounds the car on the road without a shadow-map
  // sample per pixel. Sits just above the road/sidewalk planes (0.02/0.04).
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.wid + 0.7, spec.len + 0.7),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.06; g.add(blob);
  return { group: g, body, wheels, headMat: hl, tailMat: tl };
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
  // Parapets: a car (the player's included) that reaches the bridge rail is
  // held inside the deck instead of driving through the mesh and dropping
  // 7.3 m into the river. Only engages when the car was already up on the
  // span, so street driving and the mud ford are untouched.
  const yOn = v.pos.y;
  clampToBridgeDeck(v.pos, yOn, s.len / 2);
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
  // Rear lens brightens under braking — one emissive value, no extra light.
  if (v.mesh.tailMat) v.mesh.tailMat.emissiveIntensity = input.brake ? 3.4 : 1.5;
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
