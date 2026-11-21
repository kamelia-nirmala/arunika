// Player: on-foot movement, entering/exiting cars, carjacking, and the
// chase camera. The controller owns the player state; main.js owns the loop.
import * as THREE from 'three';
import { clamp, lerp, angleLerp } from '../random.js';
import { groundHeight } from '../world/roads.js';
import { resolveCircle, cameraBlockT } from '../physics/collision.js';
import { createVehicle, stepVehicle, surfaceAt } from '../physics/vehicle.js';
import { input } from '../input.js';

function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.35, 'rgba(255,214,106,0.9)');
  grad.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

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
  // Arms (pivot at the shoulder) + a cap, so the figure reads as a person.
  const armGeo = new THREE.BoxGeometry(0.16, 0.62, 0.18);
  armGeo.translate(0, -0.28, 0);
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, shirt);
    arm.position.set(s * 0.38, 1.45, 0); arm.castShadow = true; g.add(arm); arms.push(arm);
  }
  // Original low-poly pistol, built from plain boxes — no brand, no copied
  // asset. It hangs from the RIGHT arm (arms[0], local -x): the slide's long
  // axis runs down the arm, so when the arm rises to aim the barrel points
  // along the aim line, and the grip sits in the palm.
  const gun = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.45, metalness: 0.6 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.9 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.08), metal);
  slide.position.set(0, -0.14, 0); slide.castShadow = true; gun.add(slide);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.4, metalness: 0.7 }));
  tip.position.set(0, -0.32, 0); gun.add(tip);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.17, 0.1), gripMat);
  grip.position.set(0, 0, -0.045); grip.rotation.x = 0.25; gun.add(grip);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.06), metal);
  guard.position.set(0, -0.03, 0.045); gun.add(guard);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.03), metal);
  sight.position.set(0, -0.28, 0.045); gun.add(sight);
  gun.position.set(0, -0.58, 0.02);
  gun.scale.setScalar(1.35); // chunky on purpose: the figure is blocky, and
  // the pistol must still read as a pistol at chase-cam distance
  arms[0].add(gun);
  // Muzzle anchor at the barrel tip + the visible flash sprite. The sprite
  // lives on the gun (not in effects.muzzle): gang fire shares the effects
  // muzzle light, and a sprite there would flash on the victim's body.
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.335, 0); gun.add(muzzle);
  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTexture(), color: 0xffd76a, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flashSprite.scale.set(0.85, 0.85, 1);
  flashSprite.position.copy(muzzle.position); gun.add(flashSprite);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36),
    new THREE.MeshStandardMaterial({ color: 0xf5a623, roughness: 0.8 }));
  cap.position.y = 1.93; cap.castShadow = true; g.add(cap);
  return { group: g, legs, arms, gun, gunArm: arms[0], muzzle, flashSprite };
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
    nearCar: false, // a live car is within ENTER_RANGE of the player (HUD prompt)
    aimT: 0, recoil: 0, flashT: 0, // aim pose hold / gun kick / flash life
    money: 0, weapon: 'pistol', ammo: { pistol: 13, shotgun: 6, smg: 30 },
    reserve: { pistol: 60, shotgun: 24, smg: 90 },
  };
}
// Distance from a point to a car's footprint rectangle (edge, not centre).
// The car is an oriented box: length along its heading, width across it.
// A player standing at the bumper is ~0 m from the edge even though the
// centre is half a car-length away — the old centre-to-centre check (2.4 m)
// made the sedan (4.7 m long) enterable only by hugging its bumper.
export function carEdgeDist(c, x, z) {
  const dx = x - c.pos.x, dz = z - c.pos.z;
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading); // car forward
  const rx = Math.cos(c.heading), rz = -Math.sin(c.heading); // car right
  const along = Math.abs(dx * fx + dz * fz) - c.spec.len / 2;
  const across = Math.abs(dx * rx + dz * rz) - c.spec.wid / 2;
  return Math.hypot(Math.max(along, 0), Math.max(across, 0));
}
// How far from a car's edge E still works: touching the bumper / door (0 m)
// and standing ~1 m off the edge are in; >= 3 m off the edge is out.
export const ENTER_RANGE = 1.5;
export function nearestCar(cars, x, z, maxD) {
  let best = null, bd = maxD;
  for (const c of cars) {
    if (c.dead) continue; // a wreck cannot be entered
    const d = carEdgeDist(c, x, z);
    if (d <= bd) { bd = d; best = c; }
  }
  return best;
}
// One update. cars: all drivable vehicles (player car included once driving).
// world: {tide, traffic} — traffic cars are also in `cars` for collisions.
export function stepPlayer(p, dt, cars, tide) {
  const fwdX = Math.sin(p.camYaw), fwdZ = Math.cos(p.camYaw);
  // Screen right = camera forward x up: (-cos(camYaw), +sin(camYaw)).
  // (The old (cos, -sin) was screen LEFT, which is why A/D were swapped.)
  const rgtX = -Math.cos(p.camYaw), rgtZ = Math.sin(p.camYaw);
  if (p.mode === 'driving' && p.car) {
    p.nearCar = false;
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
    p.nearCar = false;
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
  // Displacement follows the INPUT direction, not the facing: strafing
  // (A/D) moves purely sideways from the first step instead of drifting
  // forward while the facing catches up. Heading only turns the figure.
  p.pos.x += mx * p.speed * dt;
  p.pos.z += mz * p.speed * dt;
  p.pos.y = groundHeight(p.pos.x, p.pos.z, tide);
  resolveCircle(p.pos, 0.45);
  p.mesh.group.visible = true; // on foot the figure is visible (synced below)
  if (sprint && ml > 0) p.stamina = Math.max(0, p.stamina - 12 * dt);
  else p.stamina = Math.min(100, p.stamina + 18 * dt);
  // Walk cycle + aim pose. While the trigger is held the gun arm rises to
  // the camera aim line (arm forward, pitched down with the camera), the
  // body turns to face the aim direction, and the support arm comes up to
  // the gun; both ease back down when the trigger is released. The heading
  // turn only applies while aiming — movement direction is untouched, so
  // the R2 A/D fix is not affected.
  const aiming = input.held('fire');
  if (aiming) {
    p.aimT = 0.3;
    p.heading = angleLerp(p.heading, p.camYaw, clamp(dt * 12, 0, 1));
  } else p.aimT = Math.max(0, p.aimT - dt);
  const aimBlend = clamp(p.aimT / 0.18, 0, 1);
  const aimPitch = -Math.PI / 2 + p.camPitch;
  const swing = Math.sin(performance.now() * 0.012) * clamp(p.speed / 7.5, 0, 1) * 0.5;
  p.mesh.legs[0].rotation.x = swing; p.mesh.legs[1].rotation.x = -swing;
  const armR = p.mesh.arms[0], armL = p.mesh.arms[1];
  armR.rotation.x = lerp(-swing, aimPitch + p.recoil * 0.12, aimBlend);
  armL.rotation.x = lerp(swing, aimPitch + 0.22, aimBlend);
  armL.rotation.z = lerp(0, -0.35, aimBlend); // support hand angles in to the gun
  // Recoil kick on the gun itself (back along the barrel) + flash decay.
  p.recoil = Math.max(0, p.recoil - dt * 5);
  if (p.mesh.gun) p.mesh.gun.position.y = -0.58 + p.recoil * 0.06;
  if (p.mesh.flashSprite) {
    if (p.flashT > 0) {
      p.flashT -= dt;
      p.mesh.flashSprite.material.opacity = clamp(p.flashT / 0.06, 0, 1);
    } else p.mesh.flashSprite.material.opacity = 0;
  }
  p.mesh.group.position.copy(p.pos);
  p.mesh.group.rotation.y = p.heading;
  // Enter / carjack: only consume the E press when a car is actually near,
  // so the same press can pay off wanted at a hideout instead. nearCar
  // drives the "TEKAN E" HUD prompt (hud.js reads it every HUD tick).
  const near = nearestCar(cars, p.pos.x, p.pos.z, ENTER_RANGE);
  p.nearCar = !!near;
  if (near && input.edge('enter')) {
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
  // Camera collision: keep the camera out of walls, trunks and poles. Cast
  // from the target's head to the desired camera spot; if a static occluder
  // is hit, pull the camera to just in front of it (0.4 m margin), never
  // closer than minD so the player stays in frame. The pull is along the
  // same head->camera ray, so the view direction is unchanged — the R2 A/D
  // fix (movement vs camera direction) is untouched. When nothing blocks,
  // the desired spot is used exactly as before.
  const hx = target.pos.x, hy = target.pos.y + 1.3, hz = target.pos.z;
  const full = Math.hypot(px - hx, py - hy, pz - hz);
  const minD = p.mode === 'driving' ? 2.4 : 0.9;
  let cx = px, cy = py, cz = pz;
  if (full > minD) {
    const t = cameraBlockT(hx, hy, hz, px, py, pz);
    if (t < 1) {
      const d = Math.max(t * full - 0.4, minD);
      const s = d / full;
      cx = hx + (px - hx) * s; cy = hy + (py - hy) * s; cz = hz + (pz - hz) * s;
    }
  }
  out.pos.x = lerp(out.pos.x, cx, clamp(dt * 8, 0, 1));
  out.pos.y = lerp(out.pos.y, cy, clamp(dt * 8, 0, 1));
  out.pos.z = lerp(out.pos.z, cz, clamp(dt * 8, 0, 1));
  const lx = target.pos.x + Math.sin(p.mode === 'driving' ? target.heading : p.camYaw) * 1.8;
  const lz = target.pos.z + Math.cos(p.mode === 'driving' ? target.heading : p.camYaw) * 1.8;
  out.look.set(lx, target.pos.y + 1.3, lz);
  out.fov = lerp(out.fov, 60 + clamp(spd / top, 0, 1) * 18 + (p.car && p.car.drift ? 6 : 0), clamp(dt * 3, 0, 1));
  return out;
}
