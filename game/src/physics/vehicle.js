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
import { groundHeight, onRoad } from '../world/roads.js';

const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 });
// Rim disc: small, bright, one per wheel, parented to the wheel so it inherits
// the existing spin and steering untouched.
const rimGeo = new THREE.CylinderGeometry(0.21, 0.21, 0.035, 8);
const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.65 });
// Dark glass: low roughness + high metalness so the cabin reads as a coated
// pane catching the sky, not as a second slab of paint.
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1822, roughness: 0.12, metalness: 0.88 });

export function buildCarMesh(kind, color) {
  const spec = VEHICLES[kind];
  const g = new THREE.Group();
  const body = new THREE.Group();
  // Clearcoat paint: the sun glints on the body instead of a flat matte.
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.55,
    clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(spec.wid, 0.62, spec.len), paint);
  lower.position.y = 0.55; lower.castShadow = true; body.add(lower);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(spec.wid - 0.3, 0.55, spec.len * 0.45), glassMat);
  cabin.position.set(0, 1.1, -spec.len * 0.05); cabin.castShadow = true; body.add(cabin);
  // Bumpers + side mirrors, so the car reads as a car, not a box.
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6, metalness: 0.3 });
  for (const s of [-1, 1]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(spec.wid + 0.06, 0.18, 0.28), trimMat);
    bumper.position.set(0, 0.42, s * (spec.len / 2 - 0.02)); body.add(bumper);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.22), trimMat);
    mirror.position.set(s * (spec.wid / 2 + 0.06), 1.02, spec.len * 0.18); body.add(mirror);
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
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), hl);
    h.position.set(s * (spec.wid / 2 - 0.35), 0.62, spec.len / 2); body.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), tl);
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
