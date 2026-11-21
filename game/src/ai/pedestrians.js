// Pedestrians: they walk the sidewalks, cross at zebras, and panic — run
// from gunfire and carjackings. Cheap box figures, pooled.
import * as THREE from 'three';
import { clamp, pick, range } from '../random.js';
import { groundHeight } from '../world/roads.js';
import { resolveCircle } from '../physics/collision.js';

const SHIRTS = [0xd84a3a, 0x3a7ad8, 0x3a9a5a, 0xd8b13c, 0x8a5ad8, 0xe8e0d0, 0x2a2e33];
const TARGET = 60, CAP = 75;

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
