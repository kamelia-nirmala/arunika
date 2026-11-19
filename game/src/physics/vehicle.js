// Arcade vehicle physics: grip, drift, suspension, collisions. The model is
// a velocity vector split into forward/lateral parts; lateral grip decays
// the sideways part, and the handbrake cuts that grip so the tail steps out.
import * as THREE from 'three';
import { VEHICLES } from '../config.js';
import { clamp, lerp, smooth } from '../random.js';
import { resolveCircle, circleHit } from './collision.js';
import { groundHeight, onRoad } from '../world/roads.js';

const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2836, roughness: 0.2, metalness: 0.6 });

export function buildCarMesh(kind, color) {
  const spec = VEHICLES[kind];
  const g = new THREE.Group();
  const body = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(spec.wid, 0.62, spec.len), paint);
  lower.position.y = 0.55; lower.castShadow = true; body.add(lower);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(spec.wid - 0.3, 0.55, spec.len * 0.45), glassMat);
  cabin.position.set(0, 1.1, -spec.len * 0.05); cabin.castShadow = true; body.add(cabin);
  // Headlights + taillights.
  const hl = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0x554400 });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), hl);
    h.position.set(s * (spec.wid / 2 - 0.35), 0.62, spec.len / 2); body.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xaa1111, emissive: 0x330000 }));
    t.position.set(s * (spec.wid / 2 - 0.35), 0.62, -spec.len / 2); body.add(t);
  }
  const wheels = [];
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Mesh(wheelGeo, tireMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * (spec.wid / 2 - 0.1), 0.34, sz * (spec.len / 2 - 0.7));
    w.castShadow = true; g.add(w); wheels.push(w);
  }
  g.add(body);
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
  v.heading += yaw * dt;
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
  if (v.mesh.wheels[0]) v.mesh.wheels[0].rotation.y = v.steer * 0.8;
  if (v.mesh.wheels[1]) v.mesh.wheels[1].rotation.y = v.steer * 0.8;
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
