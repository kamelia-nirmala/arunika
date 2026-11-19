// Gangs: hostile shooters spawned by missions (the market shootout, the
// finale). They walk at the player and fire when close; killing one is heat.
import * as THREE from 'three';
import { clamp } from '../random.js';

export function createGangs(scene) {
  return { scene, list: [] };
}
function buildGangMesh() {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), shirt);
  torso.position.y = 1.15; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.72; g.add(head);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x111111 }));
  gun.position.set(0.2, 1.3, 0.4); g.add(gun);
  return g;
}
export function spawnGang(gangs, x, z, n) {
  for (let i = 0; i < n; i++) {
    const mesh = buildGangMesh();
    const px = x + (Math.random() - 0.5) * 16, pz = z + (Math.random() - 0.5) * 16;
    mesh.position.set(px, 0, pz);
    gangs.scene.add(mesh);
    gangs.list.push({ mesh, pos: mesh.position, hp: 60, shootT: 1 + Math.random() });
  }
}
export function updateGangs(gangs, dt, player, fx) {
  for (let i = gangs.list.length - 1; i >= 0; i--) {
    const g = gangs.list[i];
    const d = Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z);
    // No despawn: gangs only exist because a mission spawned them, and the
    // kill objective needs all of them — despawning past 120 m made mission
    // 6 impossible to finish when the player started it from far away.
    // They walk to the player instead (3.2 m/s), so the fight still comes.
    // Walk at the player; fire inside 30 m.
    const dx = player.pos.x - g.pos.x, dz = player.pos.z - g.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    if (d > 8) { g.pos.x += (dx / len) * 3.2 * dt; g.pos.z += (dz / len) * 3.2 * dt; }
    g.mesh.rotation.y = Math.atan2(dx, dz);
    g.shootT -= dt;
    if (d < 30 && g.shootT <= 0) {
      g.shootT = 1.4;
      if (Math.random() < 0.5) {
        player.health -= 12;
        if (fx) fx(player.pos.x, player.pos.y + 1.4, player.pos.z);
      }
    }
  }
}
export function damageGang(gangs, x, z, dmg) {
  for (let i = gangs.list.length - 1; i >= 0; i--) {
    const g = gangs.list[i];
    if (Math.hypot(g.pos.x - x, g.pos.z - z) < 1.2) {
      g.hp -= dmg;
      if (g.hp <= 0) {
        gangs.scene.remove(g.mesh);
        gangs.list.splice(i, 1);
        return true;
      }
      return false;
    }
  }
  return false;
}
export function gangCount(gangs) { return gangs.list.length; }
