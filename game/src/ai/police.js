// Police: pursuit cars that chase the player, PIT at ★4+, roadblocks at ★3+,
// and a helicopter at ★4+. Units scale with the wanted level.
import * as THREE from 'three';
import { createVehicle, stepVehicle } from '../physics/vehicle.js';
import { clamp, lerp, range } from '../random.js';
import { groundHeight } from '../world/roads.js';

export function createPolice(scene) {
  const heliGeo = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 7),
    new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.4, metalness: 0.5 }));
  body.castShadow = true; heliGeo.add(body);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.1, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x111111 }));
  rotor.position.y = 1.1; heliGeo.add(rotor);
  const spot = new THREE.SpotLight(0xfff2c0, 0, 60, 0.35, 0.4);
  spot.position.set(0, -1, 0); heliGeo.add(spot);
  heliGeo.add(spot.target);
  heliGeo.visible = false;
  scene.add(heliGeo);
  return { scene, cars: [], heli: heliGeo, rotor, spot, blocks: [], shootT: 0, forceHeli: false };
}
// Lightbar: red + blue boxes on the roof (exported so a staged cruiser can get one too).
export function addLightbar(v) {
  const barR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000 }));
  barR.position.set(-0.4, 1.45, 0);
  const barB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2222ff, emissive: 0x0000ff }));
  barB.position.set(0.4, 1.45, 0);
  v.mesh.group.add(barR, barB);
  v.barR = barR; v.barB = barB;
}
function spawnUnit(pol, player, stars) {
  const a = Math.random() * Math.PI * 2;
  const d = 120;
  const x = player.pos.x + Math.sin(a) * d, z = player.pos.z + Math.cos(a) * d;
  const v = createVehicle('police', x, z, 0, 0x1a1a1a);
  addLightbar(v);
  pol.scene.add(v.mesh.group);
  pol.cars.push({ v, stuck: 0 });
}
export function updatePolice(pol, dt, player, stars, time) {
  const want = stars === 0 ? 0 : stars === 1 ? 0 : stars + 1; // ★2: 2 cars ... ★5: 6 cars
  while (pol.cars.length < want) spawnUnit(pol, player, stars);
  while (pol.cars.length > want) {
    const u = pol.cars.pop();
    pol.scene.remove(u.v.mesh.group);
  }
  // Roadblocks at ★3+: two parked units across the player's road, ahead.
  if (stars >= 3 && pol.blocks.length === 0 && player.mode === 'driving') {
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    for (const s of [-1, 1]) {
      const v = createVehicle('police', player.pos.x + fx * 60 + -fz * s * 3,
        player.pos.z + fz * 60 + fx * s * 3, player.heading + Math.PI / 2, 0x1a1a1a);
      pol.scene.add(v.mesh.group);
      pol.blocks.push(v);
    }
  }
  if (stars < 3) {
    for (const b of pol.blocks) pol.scene.remove(b.mesh.group);
    pol.blocks.length = 0;
  }
  for (const u of pol.cars) {
    const v = u.v;
    // Pursuit: aim at the player, lead by half their velocity.
    const tx = player.pos.x + Math.sin(player.heading) * (player.speed || 0) * 0.5;
    const tz = player.pos.z + Math.cos(player.heading) * (player.speed || 0) * 0.5;
    const want = Math.atan2(tx - v.pos.x, tz - v.pos.z);
    let dh = want - v.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const d = Math.hypot(tx - v.pos.x, tz - v.pos.z);
    const inp = {
      throttle: d > 8 ? 1 : 0.3, steer: clamp(dh * 1.6, -1, 1),
      brake: d < 5, hand: false, surface: 'road',
    };
    // PIT at ★4+: ram the player's rear quarter when alongside.
    if (stars >= 4 && d < 7) inp.steer = clamp(dh * 2.2, -1, 1);
    stepVehicle(v, inp, dt, 0.5);
    // Flash the lightbar (spawned units carry barR/barB; a staged cruiser may not).
    if (v.barR && v.barB) {
      const on = Math.floor(time * 6) % 2 === 0;
      v.barR.material.emissiveIntensity = on ? 2 : 0.2;
      v.barB.material.emissiveIntensity = on ? 0.2 : 2;
    }
  }
  // Helicopter at ★4+ (or forced for the cover shot): hovers 90 m above the player.
  const heliOn = stars >= 4 || pol.forceHeli;
  pol.heli.visible = heliOn;
  if (heliOn) {
    // A staged (forced) helicopter keeps its staged position; a live one hovers over the player.
    if (!pol.forceHeli) pol.heli.position.set(player.pos.x + 12, 90, player.pos.z + 8);
    pol.rotor.rotation.y += dt * 22;
    pol.spot.target.position.set(player.pos.x, 0, player.pos.z);
    pol.spot.intensity = 900;
  } else pol.spot.intensity = 0;
  // Police fire at ★3+ within 40 m: 18 damage per hit, one shot per 1.5 s.
  pol.shootT -= dt;
  if (stars >= 3 && pol.shootT <= 0 && pol.cars.length) {
    const near = pol.cars.some((u) => Math.hypot(u.v.pos.x - player.pos.x, u.v.pos.z - player.pos.z) < 40);
    if (near) { player.health -= 18; pol.shootT = 1.5; return true; }
  }
  return false;
}
export function policeHeat(pol) { return pol.cars.length; }
