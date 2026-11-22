// Street props: billboards, bus stops, and street signs — the layered
// signage that makes a boulevard read as a real place in one frame.
//
// Everything here is painted on canvas at build time (no external images) and
// every name is an original, generic Indonesian phrase. These props stand on
// the verge; their existing collision boxes are unchanged.
import * as THREE from 'three';
import { pick } from '../random.js';
import { addBox } from '../physics/collision.js';

// Billboard creatives: two lines of argument, in the city's own voice.
const BILLBOARDS = [
  ['KOTA KITA', 'KOTA KERJA', '#0e1a22', '#f7f0dc', '#f5a623'],
  ['JAGA MUARA', 'TETAP BERSIH', '#1b3a5c', '#f7f0dc', '#2fd3c4'],
  ['PASAR RAKYAT', 'TIAP SABTU', '#8a2f2f', '#f7f0dc', '#f5a623'],
  ['NAIK BUS KOTA', 'MURAH MERIAH', '#123c2e', '#f7f0dc', '#2fd3c4'],
  ['HEMAT LISTRIK', 'RUMAH TANGGUH', '#2b2440', '#f7f0dc', '#f5a623'],
  ['BELI LOKAL', 'BANGGA LOKAL', '#0e1a22', '#f7f0dc', '#e0453a'],
];

// Two-line billboard face: bold caps stacked over a colour field. Painted at
// 1024 px so the letterforms survive mip filtering on a board 30 m away, and
// with a rounded sans (not a condensed face) so no stroke thins to nothing.
function boardFace(top, bottom, bg, fg, accent) {
  const W = 1024, H = 410;   // exactly 2.5:1, the 10x4 m board's aspect
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = accent; g.fillRect(0, H - 48, W, 48);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const font = (s) => '900 ' + s + 'px Arial, Helvetica, sans-serif';
  const fit = (txt, start) => {
    let s = start; g.font = font(s);
    while (s > 44 && g.measureText(txt).width > W - 108) { s -= 8; g.font = font(s); }
    return s;
  };
  fit(top, 168); g.fillText(top, W / 2, 156);
  fit(bottom, 124); g.fillText(bottom, W / 2, 312);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}
// Bus-stop flag: line number + destination, painted caps.
function stopFace(num, dest) {
  const W = 768, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#2f6db8'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f7f0dc'; g.fillRect(0, 0, 192, H);
  g.fillStyle = '#0e1a22'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 124px Arial, sans-serif';
  g.fillText(num, 96, H / 2 + 4);
  g.fillStyle = '#f7f0dc'; g.textAlign = 'left';
  const font = (s) => '900 ' + s + 'px Arial, sans-serif';
  let s = 84; g.font = font(s);
  while (s > 40 && g.measureText(dest).width > W - 248) { s -= 6; g.font = font(s); }
  g.fillText(dest, 224, H / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

export function buildProps(scene, rng) {
  // Billboards along the boulevard. Each face is a painted creative; the
  // posts stand on the verge and the face is clamped to the top of them.
  const spots = [[-58, -180, 0], [-32, -90, Math.PI], [-58, 60, 0], [-32, 150, Math.PI], [58, -90, -Math.PI / 2]];
  for (const [x, z, ry] of spots) {
    const board = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.8 }));
    post.position.y = 4; post.castShadow = true; board.add(post);
    const [top, bottom, bg, fg, accent] = pick(rng, BILLBOARDS);
    const face = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 0.3),
      new THREE.MeshStandardMaterial({ map: boardFace(top, bottom, bg, fg, accent), roughness: 0.75 }));
    face.position.y = 9; face.castShadow = true; board.add(face);
    // Two thin stays from the post up to the board's underside, so the face
    // is visibly carried rather than pasted in the air.
    for (const s of [-1, 1]) {
      const stay = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.15, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.8 }));
      stay.position.set(s * 3.2, 6.45, 0);
      stay.rotation.z = s * 0.28;
      board.add(stay);
    }
    board.position.set(x, 0, z); board.rotation.y = ry;
    scene.add(board);
    addBox(x - 1, z - 1, x + 1, z + 1, 8); // post; face at y 7..11 is above the camera
  }
  // Bus stops: canopy + bench + a flag board, every few blocks on the
  // boulevard. Stop names are street directions, not brands.
  const STOPS = [['04', 'KEMUNING LURUS'], ['07', 'PASAR IKAN'], ['12', 'LOJI CEMPAKA'], ['15', 'TUNJUNG MAS']];
  for (let i = 0; i < 4; i++) {
    const z = [-180, -45, 90, 180][i];
    const stop = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 2),
      new THREE.MeshStandardMaterial({ color: 0x2f6db8, roughness: 0.7 }));
    roof.position.y = 2.6; roof.castShadow = true; stop.add(roof);
    for (const s of [-1.8, 1.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 0.15),
        new THREE.MeshStandardMaterial({ color: 0x3a3f46 }));
      leg.position.set(s, 1.3, 0); stop.add(leg);
    }
    const bench = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 1 }));
    bench.position.y = 0.7; stop.add(bench);
    // Flag board on its own post beside the shelter, road side, facing the
    // pavement so a waiting passenger reads it head-on.
    const postX = 2.7;
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.1, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.3, roughness: 0.7 }));
    mast.position.set(postX, 1.55, 0); stop.add(mast);
    const [num, dest] = STOPS[i];
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.63),
      new THREE.MeshStandardMaterial({
        map: stopFace(num, dest), roughness: 0.8,
        emissive: 0x1a1c22, emissiveIntensity: 0.5, side: THREE.DoubleSide,
      }));
    flag.position.set(postX, 2.82, 0);
    stop.add(flag);
    stop.position.set(-45 - 9, 0, z);
    scene.add(stop);
    addBox(-45 - 11, z - 1, -45 - 7, z + 1, 2.6); // bench + shelter block the sidewalk
  }
}
