// Pedestrians: they walk the sidewalks, cross at zebras, and panic — run
// from gunfire and carjackings. Cheap box figures, pooled.
import * as THREE from 'three';
import { clamp, pick, range } from '../random.js';
import { groundHeight } from '../world/roads.js';
import { resolveCircle } from '../physics/collision.js';

const SHIRTS = [0xd84a3a, 0x3a7ad8, 0x3a9a5a, 0xd8b13c, 0x8a5ad8, 0xe8e0d0, 0x2a2e33];
const SKINS = [0xc98d5f, 0xe0ac69, 0xa86b45, 0x8d5524, 0x5a3825];
const HAIRS = [0x2b1d14, 0x4a3123, 0x121212, 0x6b4a2f, 0xb0a08a];
const TARGET = 60, CAP = 75;

// Shared geometry + material caches: up to 75 peds walk at once, so every ped
// reuses the same buffers and only the colours differ. Built once, on first
// spawn — never per-ped.
const PED_GEO = {
  torso: new THREE.CylinderGeometry(0.25, 0.16, 0.55, 9, 1),
  hips: new THREE.CylinderGeometry(0.165, 0.145, 0.19, 8),
  head: new THREE.SphereGeometry(0.125, 10, 8),
  hair: new THREE.SphereGeometry(0.132, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hatCrown: new THREE.CylinderGeometry(0.128, 0.132, 0.10, 8),
  hatBrim: new THREE.CylinderGeometry(0.185, 0.185, 0.022, 10),
  neck: new THREE.CylinderGeometry(0.062, 0.072, 0.09, 7),
  thigh: new THREE.CylinderGeometry(0.078, 0.066, 0.42, 7),
  shin: new THREE.CylinderGeometry(0.06, 0.046, 0.38, 7),
  boot: new THREE.BoxGeometry(0.125, 0.08, 0.24),
  arm: new THREE.CylinderGeometry(0.055, 0.043, 0.55, 7),
};
const PED_MATS = new Map();
function pedMat(color) {
  let m = PED_MATS.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.9 }); PED_MATS.set(color, m); }
  return m;
}

// Low-poly human-proportioned pedestrian: tapered torso, round head, neck,
// two-segment legs with boots, simple arms. Height varies ±8%, shirt colour
// comes from SHIRTS, skin from SKINS, and most wear hair or a cap — so a
// crowd reads as people, not clones. Leg pivots stay at y=0.4 (the walk
// cycle in updatePeds rotates them there).
function buildPedMesh(color) {
  const g = new THREE.Group();
  const shirtM = pedMat(color);
  const skin = pedMat(SKINS[(Math.random() * SKINS.length) | 0]);
  const pants = pedMat(Math.random() < 0.25 ? 0x3d4550 : 0x2a2e33);
  const boots = pedMat(0x191b1e);
  const torso = new THREE.Mesh(PED_GEO.torso, shirtM);
  torso.scale.z = 0.66; torso.position.y = 1.13; torso.castShadow = true; g.add(torso);
  const hips = new THREE.Mesh(PED_GEO.hips, pants);
  hips.scale.z = 0.72; hips.position.y = 0.80; g.add(hips);
  const neck = new THREE.Mesh(PED_GEO.neck, skin);
  neck.position.y = 1.46; g.add(neck);
  const head = new THREE.Mesh(PED_GEO.head, skin);
  head.position.y = 1.635; head.scale.z = 0.92; head.castShadow = true; g.add(head);
  // Most heads get hair; some get a cap. Both are one or two extra meshes.
  const look = Math.random();
  if (look < 0.45) {
    const hair = new THREE.Mesh(PED_GEO.hair, pedMat(HAIRS[(Math.random() * HAIRS.length) | 0]));
    hair.position.y = 1.637; hair.scale.z = 0.94; g.add(hair);
  } else if (look < 0.78) {
    const capMat = pedMat(Math.random() < 0.5 ? color : 0x2a2e33);
    const crown = new THREE.Mesh(PED_GEO.hatCrown, capMat);
    crown.position.y = 1.72; g.add(crown);
    const brim = new THREE.Mesh(PED_GEO.hatBrim, capMat);
    brim.position.set(0, 1.675, 0.09); g.add(brim);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.115, 0.4, 0);
    const thigh = new THREE.Mesh(PED_GEO.thigh, pants);
    thigh.position.y = 0.19; leg.add(thigh);
    const shin = new THREE.Mesh(PED_GEO.shin, pants);
    shin.position.y = -0.20; leg.add(shin);
    const boot = new THREE.Mesh(PED_GEO.boot, boots);
    boot.position.set(0, -0.358, 0.045); leg.add(boot);
    g.add(leg); legs.push(leg);
  }
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(PED_GEO.arm, shirtM);
    arm.position.set(s * 0.245, 1.10, 0); g.add(arm);
  }
  // ±8% height variation, scaled about the feet so nobody floats or sinks.
  const hs = 0.92 + Math.random() * 0.16;
  g.scale.set(hs, hs, hs);
  return { group: g, legs };
}
export function createPeds(scene, rng) {
  return { scene, rng, list: [], spawnT: 0 };
}
export function spawnPed(pd, x, z) {
  const m = buildPedMesh(pick(pd.rng, SHIRTS));
  m.group.position.set(x, groundHeight(x, z, 0.5), z);
  pd.scene.add(m.group);
  const p = { mesh: m, pos: new THREE.Vector3(x, 0, z), heading: pd.rng() * Math.PI * 2,
    speed: 1.3, state: 'walk', panic: 0, waitT: 0, side: pd.rng() < 0.5 ? -1 : 1 };
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
export function updatePeds(pd, dt, player) {
  pd.spawnT -= dt;
  if (pd.list.length < TARGET && pd.spawnT <= 0) {
    pd.spawnT = 0.25;
    const a = pd.rng() * Math.PI * 2, r = range(pd.rng, 20, 90);
    const x = player.pos.x + Math.sin(a) * r, z = player.pos.z + Math.cos(a) * r;
    if (x > -350 && x < 350 && z > -440 && z < 260) spawnPed(pd, x, z);
  }
  for (let i = pd.list.length - 1; i >= 0; i--) {
    const p = pd.list[i];
    const d = Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z);
    if (d > 130) { pd.scene.remove(p.mesh.group); pd.list.splice(i, 1); continue; }
    if (p.state === 'panic') {
      p.panic -= dt;
      p.speed = 5.5;
      if (p.panic <= 0) p.state = 'walk';
    } else {
      p.speed = 1.3;
      // Wander: mostly straight along sidewalks, turn at random.
      if (pd.rng() < dt * 0.05) p.heading += range(pd.rng, -1.2, 1.2);
    }
    p.pos.x += Math.sin(p.heading) * p.speed * dt;
    p.pos.z += Math.cos(p.heading) * p.speed * dt;
    resolveCircle(p.pos, 0.4); // sidewalks, not living rooms: stay out of buildings
    p.pos.x = clamp(p.pos.x, -355, 355); p.pos.z = clamp(p.pos.z, -445, 265);
    p.pos.y = groundHeight(p.pos.x, p.pos.z, 0.5);
    const swing = Math.sin(performance.now() * 0.01 + i) * clamp(p.speed / 5.5, 0.2, 1) * 0.45;
    p.mesh.legs[0].rotation.x = swing; p.mesh.legs[1].rotation.x = -swing;
    p.mesh.group.position.copy(p.pos);
    p.mesh.group.rotation.y = p.heading;
  }
}
