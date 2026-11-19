// Patrol boats: they only exist at high tide, sweeping the river and the
// harbour. A player caught in the channel at high tide gains heat fast.
import * as THREE from 'three';
import { clamp } from '../random.js';

export function createBoats(scene) {
  const boats = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 9),
      new THREE.MeshStandardMaterial({ color: 0x2a4d6e, roughness: 0.5, metalness: 0.3 }));
    hull.position.y = 0.5; hull.castShadow = true; g.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 3),
      new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.6 }));
    cabin.position.set(0, 1.6, -1); g.add(cabin);
    g.visible = false;
    scene.add(g);
    boats.push({ g, t: i * 0.33, speed: 0.02 + i * 0.006 });
  }
  return { boats };
}
export function updateBoats(b, dt, tide, player, addHeat) {
  const on = tide >= 0.75;
  for (const boat of b.boats) {
    boat.g.visible = on;
    if (!on) continue;
    boat.t += boat.speed * dt;
    const x = -320 + ((boat.t % 1) * 640);
    boat.g.position.set(x, -2 + tide * 2.2 + 0.2, -315 + Math.sin(boat.t * 9) * 18);
    boat.g.rotation.y = Math.PI / 2;
    const d = Math.hypot(player.pos.x - x, player.pos.z - boat.g.position.z);
    if (d < 25 && player.pos.z < -260 && player.pos.z > -370) addHeat(6 * dt);
  }
}
