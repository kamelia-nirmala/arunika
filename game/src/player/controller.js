// Player: on-foot movement, entering/exiting cars, carjacking, and the
// chase camera. The controller owns the player state; main.js owns the loop.
import * as THREE from 'three';
import { clamp, lerp, angleLerp } from '../random.js';
import { groundHeight } from '../world/roads.js';
import { resolveCircle } from '../physics/collision.js';
import { createVehicle, stepVehicle, surfaceAt } from '../physics/vehicle.js';
import { input } from '../input.js';

export function buildPlayerMesh() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2fd3c4, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), shirt);
  torso.position.y = 1.15; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.72; head.castShadow = true; g.add(head);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.22), pants);
    leg.position.set(s * 0.14, 0.45, 0); leg.castShadow = true; g.add(leg); legs.push(leg);
  }
  return { group: g, legs };
}

export function createPlayer(scene, x, z) {
  const mesh = buildPlayerMesh();
  mesh.group.position.set(x, 0, z);
  scene.add(mesh.group);
  return {
    mesh, mode: 'foot', // 'foot' | 'driving' | 'jacking'
    pos: new THREE.Vector3(x, 0, z), heading: 0, vy: 0,
    speed: 0, stamina: 100, health: 100, armor: 0,
    car: null, jackT: 0, jackTarget: null, camYaw: 0, camPitch: 0.32,
    money: 0, weapon: 'pistol', ammo: { pistol: 13, shotgun: 6, smg: 30 },
    reserve: { pistol: 60, shotgun: 24, smg: 90 },
  };
}
export function nearestCar(cars, x, z, maxD) {
  let best = null, bd = maxD * maxD;
  for (const c of cars) {
    const d = (c.pos.x - x) ** 2 + (c.pos.z - z) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
// One update. cars: all drivable vehicles (player car included once driving).
// world: {tide, traffic} — traffic cars are also in `cars` for collisions.
export function stepPlayer(p, dt, cars, tide) {
  const fwdX = Math.sin(p.camYaw), fwdZ = Math.cos(p.camYaw);
  const rgtX = Math.cos(p.camYaw), rgtZ = -Math.sin(p.camYaw);
  if (p.mode === 'driving' && p.car) {
    p.mesh.group.visible = false; // the driver is inside the car
    const inp = {
      throttle: (input.held('up') ? 1 : 0) + (input.held('down') ? -1 : 0),
      steer: (input.held('left') ? -1 : 0) + (input.held('right') ? 1 : 0),
      brake: input.held('brake'), hand: input.held('hand'),
      surface: surfaceAt(p.car.pos.x, p.car.pos.z),
    };
    stepVehicle(p.car, inp, dt, tide);
    p.pos.copy(p.car.pos); p.heading = p.car.heading; p.speed = Math.abs(p.car.speed);
    if (input.edge('enter')) {
      p.mode = 'foot';
      const sx = Math.sin(p.heading + Math.PI / 2), sz = Math.cos(p.heading + Math.PI / 2);
      p.pos.set(p.car.pos.x + sx * 2.2, 0, p.car.pos.z + sz * 2.2);
      p.car = null;
    }
    return;
  }
  if (p.mode === 'jacking' && p.jackTarget) {
    p.mesh.group.visible = false; // climbing into the car
    p.jackT -= dt;
    if (p.jackT <= 0) {
      const c = p.jackTarget;
      p.mode = 'driving'; p.car = c; p.jackTarget = null;
      if (c.driver) { c.driver.panic = 6; c.driver = null; }
    }
    return;
  }
  // On foot.
  const sprint = input.held('sprint') && p.stamina > 0;
  const maxSpd = sprint ? 7.5 : 4.2;
  let mx = 0, mz = 0;
  if (input.held('up')) { mx += fwdX; mz += fwdZ; }
  if (input.held('down')) { mx -= fwdX; mz -= fwdZ; }
  if (input.held('left')) { mx -= rgtX; mz -= rgtZ; }
  if (input.held('right')) { mx += rgtX; mz += rgtZ; }
  const ml = Math.hypot(mx, mz);
  if (ml > 0) {
    mx /= ml; mz /= ml;
    p.speed = lerp(p.speed, maxSpd, clamp(dt * 9, 0, 1));
    p.heading = angleLerp(p.heading, Math.atan2(mx, mz), clamp(dt * 10, 0, 1));
  } else p.speed = lerp(p.speed, 0, clamp(dt * 14, 0, 1));
  p.pos.x += Math.sin(p.heading) * p.speed * dt;
  p.pos.z += Math.cos(p.heading) * p.speed * dt;
  p.pos.y = groundHeight(p.pos.x, p.pos.z, tide);
  resolveCircle(p.pos, 0.45);
  p.mesh.group.visible = true; // on foot the figure is visible (synced below)
  if (sprint && ml > 0) p.stamina = Math.max(0, p.stamina - 12 * dt);
  else p.stamina = Math.min(100, p.stamina + 18 * dt);
  // Walk cycle.
  const swing = Math.sin(performance.now() * 0.012) * clamp(p.speed / 7.5, 0, 1) * 0.5;
  p.mesh.legs[0].rotation.x = swing; p.mesh.legs[1].rotation.x = -swing;
  p.mesh.group.position.copy(p.pos);
  p.mesh.group.rotation.y = p.heading;
  // Enter / carjack: only consume the E press when a car is actually near,
  // so the same press can pay off wanted at a hideout instead.
  const near = nearestCar(cars, p.pos.x, p.pos.z, 2.4);
  if (near && !near.dead && input.edge('enter')) {
    p.mode = 'jacking'; p.jackTarget = near;
    p.jackT = near.driver ? 1.4 : 0.9;
  }
  // Mouse orbit for the third-person camera.
  p.camYaw -= input.mouseDX * 0.0032;
  p.camPitch = clamp(p.camPitch + input.mouseDY * 0.0022, 0.08, 1.1);
}
// Desired camera for the current mode. Returns {pos, look, fov}.
export function cameraFor(p, dt, out) {
  const target = p.mode === 'driving' && p.car ? p.car : p;
  const spd = p.mode === 'driving' && p.car ? Math.abs(p.car.speed) : p.speed;
  const top = p.mode === 'driving' && p.car ? p.car.spec.top : 7.5;
  const back = p.mode === 'driving' ? lerp(6.5, 11, clamp(spd / top, 0, 1)) : 5;
  const height = p.mode === 'driving' ? 2.4 : 2.2;
  const yaw = p.mode === 'driving' ? target.heading + Math.PI : p.camYaw + Math.PI;
  const px = target.pos.x + Math.sin(yaw) * back;
  const pz = target.pos.z + Math.cos(yaw) * back;
  const py = target.pos.y + height + (p.mode === 'driving' ? clamp(spd / top, 0, 1) * 1.2 : p.camPitch * 2);
  out.pos.x = lerp(out.pos.x, px, clamp(dt * 8, 0, 1));
  out.pos.y = lerp(out.pos.y, py, clamp(dt * 8, 0, 1));
  out.pos.z = lerp(out.pos.z, pz, clamp(dt * 8, 0, 1));
  const lx = target.pos.x + Math.sin(target.heading) * 1.8;
  const lz = target.pos.z + Math.cos(target.heading) * 1.8;
  out.look.set(lx, target.pos.y + 1.3, lz);
  out.fov = lerp(out.fov, 60 + clamp(spd / top, 0, 1) * 18 + (p.car && p.car.drift ? 6 : 0), clamp(dt * 3, 0, 1));
  return out;
}
