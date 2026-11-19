// Street props: billboards, bus stops, and street signs — the layered
// signage that makes a boulevard read as a real place in one frame.
import * as THREE from 'three';
import { pick, range } from '../random.js';
import { addBox } from '../physics/collision.js';

const ADS = ['SELULER NUSA', 'KOPI KAPAL', 'PASAR APUNG', 'OMBAK FM 88.4', 'BANK KEMUNING', 'SATE LONTONG'];
export function buildProps(scene, rng) {
  // Billboards along the boulevard.
  for (const [x, z, ry] of [[-58, -180, 0], [-32, -90, 0], [-58, 60, 0], [-32, 150, 0], [58, -90, 0]]) {
    const board = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.8 }));
    post.position.y = 4; board.add(post);
    const face = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 0.3),
      new THREE.MeshStandardMaterial({ color: pick(rng, [0xe0453a, 0x2fd3c4, 0xf5a623, 0x2f6db8]), roughness: 0.7 }));
    face.position.y = 9; face.castShadow = true; board.add(face);
    board.position.set(x, 0, z); board.rotation.y = ry;
    scene.add(board);
    addBox(x - 1, z - 1, x + 1, z + 1, 8); // post; face at y 7..11 is above the camera
  }
  // Bus stops: canopy + bench, every few blocks on the boulevard.
  for (const z of [-180, -45, 90, 180]) {
    const stop = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 2),
      new THREE.MeshStandardMaterial({ color: 0x2f6db8, roughness: 0.7 }));
    roof.position.y = 2.6; stop.add(roof);
    for (const s of [-1.8, 1.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 0.15),
        new THREE.MeshStandardMaterial({ color: 0x3a3f46 }));
      leg.position.set(s, 1.3, 0); stop.add(leg);
    }
    const bench = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 1 }));
    bench.position.y = 0.7; stop.add(bench);
    stop.position.set(-45 - 9, 0, z);
    scene.add(stop);
    addBox(-45 - 11, z - 1, -45 - 7, z + 1, 2.6); // bench + shelter block the sidewalk
  }
}
