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

// Striped awning canvas, painted the same way city.js paints the shopfront
// awnings (8 vertical stripes, shaded hem) so a prop awning reads as part of
// the same street. Kept local: city.js does not export its painter, and this
// prop must work in a scene that has no shopfront behind it.
function awningStripe(a, b) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) { g.fillStyle = (i & 1) ? a : b; g.fillRect(i * 16, 0, 16, 32); }
  g.fillStyle = 'rgba(0,0,0,0.20)'; g.fillRect(0, 25, 128, 7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

// A free-standing striped awning: the canopy over a kiosk or a shop doorway.
// Exported so a shot can dress a corner of its own staging with the same
// canopy language the built city uses — a sloping canvas, a hanging valance
// and two poles, bedded on the ground so nothing floats.
//   buildAwning(scene, x, z, opts)
//     opts.w      canopy width   (default 3.4 m, across x before ry)
//     opts.d      canopy depth   (default 1.7 m, its overhang)
//     opts.y      canopy height at the wall edge (default 2.55 m)
//     opts.ry     yaw, typically the shopfront's facing
//     opts.colors [stripeA, stripeB] hex strings
//     opts.poles  false to hang it off a wall with no legs
// No collision box: a canopy at 2.4+ m is above every actor's head, and adding
// one would change how the street plays.
export function buildAwning(scene, x, z, opts = {}) {
  const w = opts.w ?? 3.4, d = opts.d ?? 1.7, y = opts.y ?? 2.55, ry = opts.ry ?? 0;
  const colors = opts.colors ?? ['#e0453a', '#f2ede2'];
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: awningStripe(colors[0], colors[1]), roughness: 0.9 });
  // Canopy: tilted 12° down toward the street so it sheds and catches the sky
  // at the front edge instead of reading as a flat slab pasted on a wall.
  const slope = 0.21;
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, d), mat);
  canopy.position.set(0, y, 0);
  canopy.rotation.x = slope;
  canopy.castShadow = true;
  g.add(canopy);
  // Valance: the short hanging skirt on the street edge, in the same stripes.
  const hem = new THREE.Mesh(new THREE.BoxGeometry(w, 0.30, 0.05), mat);
  hem.position.set(0, y - 0.20 - d * 0.5 * Math.sin(slope), d / 2 * Math.cos(slope));
  hem.rotation.x = slope;
  g.add(hem);
  // Poles on the street edge, bedded on the ground and meeting the canopy's
  // underside — the canopy is carried, not floating.
  if (opts.poles !== false) {
    const poleH = y - 0.005 - (d / 2) * Math.sin(slope);
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.075, poleH, 0.075),
        new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.7, metalness: 0.3 }));
      pole.position.set(s * (w / 2 - 0.10), poleH / 2, d / 2 * Math.cos(slope) - 0.06);
      pole.castShadow = true;
      g.add(pole);
    }
  }
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
  return g;
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
