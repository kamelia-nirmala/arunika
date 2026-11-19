// Police: pursuit cars that chase the player, PIT at ★4+, roadblocks at ★3+,
// and a helicopter at ★4+. Units scale with the wanted level.
//
// ARREST FLOW (R3): a crime only raises the wanted level — it never arrests
// on its own. When a cruiser gets close to an ON-FOOT player it stops and
// its officer(s) get OUT and chase on foot. An arrest happens only when an
// officer stays within ARREST_DIST of the player for ARREST_TIME straight
// (the player can break it by sprinting away). Police only shoot from
// deployed on-foot officers at ★3+, never from inside a moving car.
import * as THREE from 'three';
import { createVehicle, stepVehicle } from '../physics/vehicle.js';
import { clamp, lerp, range } from '../random.js';
import { groundHeight } from '../world/roads.js';
import { resolveCircle } from '../physics/collision.js';

// Arrest tuning: officer run speed sits between the player's walk (4.2) and
// sprint (7.5), so walking away gets you caught but sprinting escapes.
export const ARREST_DIST = 2.6;
export const ARREST_TIME = 3.0;
export const OFFICER_SPEED = 5.2;
export const WARN_DIST = 12;
const DEPLOY_DIST = 22;
const RECALL_DIST = 45;

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
  return { scene, cars: [], heli: heliGeo, rotor, spot, blocks: [], shootT: 0, forceHeli: false,
    // Arrest state, refreshed every update: true only on the frame the
    // arrest completes (the caller consumes it and clears it).
    arrested: false, arrestT: 0, nearestOfficer: Infinity };
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
// On-foot officer: navy uniform, cap, visible at a distance so the player
// can see the arrest coming — same box-figure style as pedestrians.
function buildOfficerMesh() {
  const g = new THREE.Group();
  const navy = new THREE.MeshStandardMaterial({ color: 0x1c2f4a, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), navy);
  torso.position.y = 1.15; torso.castShadow = true; g.add(torso);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.1, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x0e1a22, roughness: 0.7 }));
  belt.position.y = 0.82; g.add(belt);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.3), skin);
  head.position.y = 1.7; g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x0e1a22, roughness: 0.6 }));
  cap.position.y = 1.9; g.add(cap);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.2), navy);
    leg.position.set(s * 0.13, 0.38, 0); g.add(leg); legs.push(leg);
  }
  return { group: g, legs };
}
function spawnOfficer(pol, unit) {
  const v = unit.v;
  const m = buildOfficerMesh();
  // Step out of the driver's side, clear of the car body.
  const sx = Math.cos(v.heading), sz = -Math.sin(v.heading);
  const pos = new THREE.Vector3(v.pos.x + sx * 2.2, 0, v.pos.z + sz * 2.2);
  resolveCircle(pos, 0.4);
  m.group.position.set(pos.x, groundHeight(pos.x, pos.z, 0.5), pos.z);
  pol.scene.add(m.group);
  const o = { mesh: m, pos, heading: v.heading, closeT: 0, unit };
  unit.officers.push(o);
  return o;
}
function removeOfficer(pol, unit, o) {
  pol.scene.remove(o.mesh.group);
  const i = unit.officers.indexOf(o);
  if (i >= 0) unit.officers.splice(i, 1);
}
// Remove every police car and on-foot officer (game reset). Also clears the
// arrest state so a fresh game never starts already-arrested.
export function clearPolice(pol) {
  for (const u of pol.cars) {
    for (const o of [...(u.officers || [])]) removeOfficer(pol, u, o);
    pol.scene.remove(u.v.mesh.group);
  }
  for (const b of pol.blocks) pol.scene.remove(b.mesh.group);
  pol.cars.length = 0; pol.blocks.length = 0;
  pol.arrested = false; pol.arrestT = 0; pol.nearestOfficer = Infinity; pol.shootT = 0;
}
function spawnUnit(pol, player, stars) {
  const a = Math.random() * Math.PI * 2;
  const d = 120;
  const x = player.pos.x + Math.sin(a) * d, z = player.pos.z + Math.cos(a) * d;
  const v = createVehicle('police', x, z, 0, 0x1a1a1a);
  addLightbar(v);
  pol.scene.add(v.mesh.group);
  pol.cars.push({ v, stuck: 0, officers: [] });
}
export function updatePolice(pol, dt, player, stars, time) {
  const want = stars === 0 ? 0 : stars === 1 ? 0 : stars + 1; // ★2: 2 cars ... ★5: 6 cars
  while (pol.cars.length < want) spawnUnit(pol, player, stars);
  while (pol.cars.length > want) {
    const u = pol.cars.pop();
    for (const o of [...(u.officers || [])]) removeOfficer(pol, u, o);
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
  pol.arrestT = 0;
  pol.nearestOfficer = Infinity;
  const onFoot = player.mode === 'foot';
  for (const u of pol.cars) {
    if (!u.officers) u.officers = []; // units staged by shots/tests may lack it
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
      throttle: d > 8 ? 1 : 0.3, steer: clamp(-dh * 1.6, -1, 1),
      brake: d < 5, hand: false, surface: 'road',
    };
    // PIT at ★4+: ram the player's rear quarter when alongside.
    if (stars >= 4 && d < 7) inp.steer = clamp(-dh * 2.2, -1, 1);
    // Near an on-foot player the cruiser stops so its officer can get out
    // and chase on foot — police do not arrest (or shoot) from the car.
    // The car stays parked while its officer is out; it resumes the chase
    // only if the player drives away or the officer is recalled.
    const stoppedForArrest = onFoot && d < 25;
    if (stoppedForArrest) { inp.throttle = 0; inp.brake = true; }
    stepVehicle(v, inp, dt, 0.5);
    // Flash the lightbar (spawned units carry barR/barB; a staged cruiser may not).
    if (v.barR && v.barB) {
      const on = Math.floor(time * 6) % 2 === 0;
      v.barR.material.emissiveIntensity = on ? 2 : 0.2;
      v.barB.material.emissiveIntensity = on ? 0.2 : 2;
    }
    // Deploy: car close to an on-foot player and slow (or already right on
    // top of them while braking hard) — officer steps out and chases.
    const maxOff = stars >= 4 ? 2 : 1;
    const dAfter = Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z);
    if (onFoot && dAfter < DEPLOY_DIST && u.officers.length < maxOff &&
        (Math.abs(v.speed) < 5 || dAfter < 8)) {
      spawnOfficer(pol, u);
    }
    // Officers: chase on foot, track the arrest timer, recall if the player
    // drives away or gets far.
    for (const o of [...u.officers]) {
      const od = Math.hypot(o.pos.x - player.pos.x, o.pos.z - player.pos.z);
      if (!onFoot || od > RECALL_DIST) { removeOfficer(pol, u, o); continue; }
      const dx = player.pos.x - o.pos.x, dz = player.pos.z - o.pos.z;
      const len = od || 1;
      o.pos.x += (dx / len) * OFFICER_SPEED * dt;
      o.pos.z += (dz / len) * OFFICER_SPEED * dt;
      o.heading = Math.atan2(dx, dz);
      resolveCircle(o.pos, 0.4);
      o.mesh.group.position.set(o.pos.x, groundHeight(o.pos.x, o.pos.z, 0.5), o.pos.z);
      o.mesh.group.rotation.y = o.heading;
      const swing = Math.sin(time * 11 + o.pos.x) * 0.45;
      o.mesh.legs[0].rotation.x = swing; o.mesh.legs[1].rotation.x = -swing;
      const odAfter = Math.hypot(o.pos.x - player.pos.x, o.pos.z - player.pos.z);
      // Arrest: the officer must STAY close for ARREST_TIME straight.
      // Breaking away drains the timer twice as fast as it builds.
      if (odAfter < ARREST_DIST) o.closeT += dt;
      else o.closeT = Math.max(0, o.closeT - dt * 2);
      pol.arrestT = Math.max(pol.arrestT, o.closeT);
      pol.nearestOfficer = Math.min(pol.nearestOfficer, odAfter);
      if (o.closeT >= ARREST_TIME) pol.arrested = true;
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
  // Police fire at ★3+ within 40 m — ONLY from a deployed on-foot officer,
  // never from inside a car: 18 damage per hit, one shot per 1.5 s.
  pol.shootT -= dt;
  if (stars >= 3 && pol.shootT <= 0 && pol.nearestOfficer < 40) {
    // Report the hit; the caller applies the damage once via damagePlayer.
    // (Subtracting health here too dealt 36 per shot instead of 18.)
    pol.shootT = 1.5;
    return true;
  }
  return false;
}
export function policeHeat(pol) { return pol.cars.length; }
