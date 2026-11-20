// Arunika's built world: ground, roads, sidewalks, district buildings,
// palms, lamps, the Sekarwangi bridge, port, factory. All procedural, all
// original, seeded so the same seed builds the same city.
import * as THREE from 'three';
import { CITY, DISTRICTS, PALETTE } from '../config.js';
import { pick, range, clamp } from '../random.js';
import { addBox, addOccluderCylinder } from '../physics/collision.js';

const VX = [-315, -225, -135, -45, 45, 135, 225, 315];
const HZ = [-405, -225, -135, -45, 45, 135, 225];
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, ...opts }));
  return matCache.get(key);
}
// Facade texture: art-deco pastel render — cornice, deco pilasters, floor tint
// shifts, windows in four states (lit, dark, curtained, barred) and a glazed
// shopfront with a sign band and striped awning at street level. 256x256, one
// canvas per district colour, cached by facadeMat().
function facadeTexture(base, deco) {
  const W = 256, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const hex = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');
  const mix = (a, b, t) => {
    let out = 0;
    for (const sh of [16, 8, 0]) {
      const av = (a >> sh) & 255, bv = (b >> sh) & 255;
      out |= (Math.round(av + (bv - av) * t) & 255) << sh;
    }
    return hex(out);
  };
  // Deterministic jitter seeded by the district colour, so a colour always
  // paints the same wall and the seeded city stays reproducible.
  let seed = (Math.imul(base >>> 0, 2654435761) ^ Math.imul(deco >>> 0, 40503)) >>> 0;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const ri = (n) => Math.floor(rnd() * n);
  const glass = (x, y, w, h) => {
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, '#6d8294'); grd.addColorStop(0.42, '#36454f'); grd.addColorStop(1, '#1f2731');
    g.fillStyle = grd; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(214,235,241,0.20)'; g.fillRect(x, y, w, Math.max(2, Math.round(h * 0.2)));
  };

  g.fillStyle = hex(base); g.fillRect(0, 0, W, H);
  // Plaster grain and a few faint weather streaks.
  for (let i = 0; i < 300; i++) {
    g.fillStyle = rnd() < 0.5
      ? 'rgba(255,255,255,' + (0.02 + rnd() * 0.04).toFixed(3) + ')'
      : 'rgba(38,40,44,' + (0.02 + rnd() * 0.04).toFixed(3) + ')';
    g.fillRect(ri(W), ri(H), 1 + ri(3), 1 + ri(2));
  }
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(74,74,66,' + (0.03 + rnd() * 0.025).toFixed(3) + ')';
    g.fillRect(8 + ri(W - 40), 20 + ri(120), 8 + ri(16), 40 + ri(70));
  }

  // Floors: five bands between cornice and shopfront. Each band shifts a
  // little from its neighbours but stays inside the pastel range.
  const TOP = 16, SHOP = 186, FLOORS = 5;
  const fh = (SHOP - TOP) / FLOORS; // 34 px per floor
  for (let f = 0; f < FLOORS; f++) {
    const fy = Math.round(TOP + f * fh);
    const t = (rnd() - 0.5) * 0.14;
    g.fillStyle = mix(base, t > 0 ? 0xffffff : 0x2c3038, Math.abs(t) + 0.02);
    g.fillRect(0, fy, W, Math.round(fh));
    g.fillStyle = 'rgba(52,50,46,0.14)'; g.fillRect(0, fy, W, 1); // slab shadow
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(0, fy + 1, W, 1); // slab catch-light
  }

  // Art-deco pilasters between the window bays, plus corner piers.
  const COLS = 6, WINW = 22, STEP = 32, GAP = STEP - WINW;
  const X0 = Math.round((W - (COLS * WINW + (COLS - 1) * GAP)) / 2); // 37
  g.fillStyle = mix(base, deco, 0.55);
  for (let i = 0; i < COLS - 1; i++) g.fillRect(X0 + WINW + GAP / 2 - 1 + i * STEP, TOP, 3, SHOP - TOP);
  g.fillRect(0, TOP, 6, SHOP - TOP); g.fillRect(W - 6, TOP, 6, SHOP - TOP);
  g.fillStyle = 'rgba(48,46,42,0.10)';
  for (let i = 0; i < COLS - 1; i++) g.fillRect(X0 + WINW + GAP / 2 + 2 + i * STEP, TOP, 1, SHOP - TOP);

  for (let f = 0; f < FLOORS; f++) {
    const wy = Math.round(TOP + f * fh) + 9, wh = 17;
    for (let i = 0; i < COLS; i++) {
      const wx = X0 + i * STEP;
      const r = rnd();
      // Frame: light surround, darker sill shadow (thin, but reads at distance).
      g.fillStyle = mix(base, deco, 0.45); g.fillRect(wx - 2, wy - 3, WINW + 4, wh + 5);
      if (r < 0.22) { // lit interior: warm lamp behind the glass
        const grd = g.createLinearGradient(0, wy, 0, wy + wh);
        grd.addColorStop(0, '#fff2cf'); grd.addColorStop(1, '#e9c78e');
        g.fillStyle = grd; g.fillRect(wx, wy, WINW, wh);
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(wx, wy, WINW, 2);
      } else if (r < 0.48) { // dark glass with a pale sky reflection
        glass(wx, wy, WINW, wh);
      } else if (r < 0.68) { // curtained: muted pastel drapes with folds
        g.fillStyle = mix(base, deco, 0.32); g.fillRect(wx, wy, WINW, wh);
        g.fillStyle = 'rgba(58,56,50,0.16)';
        for (let x = wx + 3; x < wx + WINW - 2; x += 6) g.fillRect(x, wy, 2, wh);
        g.fillStyle = 'rgba(255,255,255,0.20)'; g.fillRect(wx, wy, WINW, 2);
      } else if (r < 0.86) { // barred: dark glass behind a light grille
        glass(wx, wy, WINW, wh);
        g.fillStyle = 'rgba(208,204,192,0.80)';
        for (let x = wx + 3; x < wx + WINW - 2; x += 5) g.fillRect(x, wy, 1, wh);
        g.fillRect(wx, wy + Math.round(wh / 2), WINW, 1);
      } else { // half-drawn blinds: lit top, dark bottom
        g.fillStyle = '#3a4652'; g.fillRect(wx, wy, WINW, wh);
        g.fillStyle = '#f4e2bb'; g.fillRect(wx, wy, WINW, Math.round(wh * 0.45));
        g.fillStyle = 'rgba(30,32,36,0.25)'; g.fillRect(wx, wy + Math.round(wh * 0.45), WINW, 1);
      }
      // Mullion, sill and its shadow.
      g.fillStyle = 'rgba(240,238,232,0.22)'; g.fillRect(wx + Math.round(WINW / 2), wy, 1, wh);
      g.fillStyle = mix(base, deco, 0.6); g.fillRect(wx - 2, wy + wh + 2, WINW + 4, 2);
      g.fillStyle = 'rgba(40,40,44,0.12)'; g.fillRect(wx - 2, wy + wh + 4, WINW + 4, 1);
    }
  }

  // Cornice: light cap, shadow reveal, then a row of dentils.
  g.fillStyle = mix(base, deco, 0.6); g.fillRect(0, 0, W, 9);
  g.fillStyle = mix(base, 0x2c3038, 0.22); g.fillRect(0, 9, W, 2);
  g.fillStyle = mix(base, deco, 0.32); g.fillRect(0, 11, W, 4);
  g.fillStyle = 'rgba(38,38,42,0.12)'; g.fillRect(0, 15, W, 1);
  g.fillStyle = 'rgba(255,255,255,0.20)';
  for (let x = 3; x < W; x += 12) g.fillRect(x, 12, 5, 3);

  // Shopfront: sign band, display glazing with an interior silhouette, door
  // bay, then the striped awning that shelters the pavement.
  g.fillStyle = mix(base, 0x3a352e, 0.12); g.fillRect(0, SHOP, W, H - SHOP);
  g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(0, SHOP, W, 2);
  const signCols = [0xc9785a, 0x5c9c92, 0xc9a25f, 0x8c82b4, 0x5c8db4];
  const sign = signCols[ri(signCols.length)];
  g.fillStyle = hex(sign); g.fillRect(6, SHOP + 4, W - 12, 18);
  g.fillStyle = 'rgba(255,255,255,0.20)'; g.fillRect(6, SHOP + 4, W - 12, 2);
  g.fillStyle = 'rgba(24,24,28,0.22)'; g.fillRect(6, SHOP + 20, W - 12, 2);
  // Abstract shop lettering: pale blocks, no real text.
  g.fillStyle = 'rgba(250,246,235,0.85)';
  for (let lx = 14 + ri(10); lx < W - 26;) {
    const lw = 4 + ri(8);
    g.fillRect(lx, SHOP + 10, lw, 6);
    lx += lw + 5 + ri(4);
  }
  const GY = SHOP + 26, GH = 26;
  const gg = g.createLinearGradient(0, GY, 0, GY + GH);
  gg.addColorStop(0, '#dfeef3'); gg.addColorStop(0.45, '#93a8b2'); gg.addColorStop(1, '#3c464f');
  g.fillStyle = gg; g.fillRect(8, GY, W - 16, GH);
  g.fillStyle = 'rgba(52,58,62,0.35)'; // shelves / bodies behind the glass
  for (let x = 12; x < W - 16; x += 26) g.fillRect(x, GY + Math.round(GH * 0.45), 12 + ri(8), Math.round(GH * 0.5));
  g.fillStyle = mix(base, deco, 0.5);
  for (let x = 8; x <= W - 8; x += 30) g.fillRect(x, GY, 3, GH);
  g.fillRect(8, GY + 12, W - 16, 2); // transom
  const dxx = 8 + (2 + ri(3)) * 30; // door bay
  g.fillStyle = '#2c333a'; g.fillRect(dxx + 2, GY, 26, GH);
  g.fillStyle = 'rgba(240,236,226,0.70)'; g.fillRect(dxx + 2, GY, 26, 2);
  g.fillStyle = 'rgba(240,236,226,0.55)'; g.fillRect(dxx + 13, GY + 10, 2, 6);
  const aw = mix(sign, 0xffffff, 0.45);
  for (let x = 4, i = 0; x < W - 4; x += 10, i++) {
    g.fillStyle = i % 2 ? aw : '#f4efe4';
    g.fillRect(x, H - 17, 10, 11);
  }
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(4, H - 17, W - 8, 1);
  g.fillStyle = 'rgba(24,24,28,0.22)'; g.fillRect(4, H - 6, W - 8, 2);
  g.fillStyle = mix(base, 0x2c3038, 0.35); g.fillRect(0, H - 4, W, 4);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Road texture: asphalt with grain, resurfacing patches and hairline cracks,
// worn edge lines and the dashed yellow centre line. 128x256 over 12x24 m, so
// the pixels stay square and the tile is reused by every road plane.
function roadTexture() {
  const W = 128, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 0x5a17c0de;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const ri = (n) => Math.floor(rnd() * n);

  g.fillStyle = '#2e3138'; g.fillRect(0, 0, W, H);
  // Tyre-polished bands where the wheels actually run.
  g.fillStyle = 'rgba(214,214,208,0.035)';
  g.fillRect(16, 0, 18, H); g.fillRect(W - 34, 0, 18, H);
  // Aggregate grain.
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = rnd() < 0.55
      ? 'rgba(226,226,216,' + (0.03 + rnd() * 0.05).toFixed(3) + ')'
      : 'rgba(8,10,14,' + (0.05 + rnd() * 0.07).toFixed(3) + ')';
    g.fillRect(ri(W), ri(H), 1 + ri(2), 1 + ri(2));
  }
  // Resurfacing patches: darker slabs with a tar seam and their own grain.
  for (let i = 0; i < 3; i++) {
    const px = 10 + ri(W - 60), py = ri(H - 50), pw = 26 + ri(38), ph = 20 + ri(34);
    g.fillStyle = 'rgba(30,33,39,0.9)'; g.fillRect(px, py, pw, ph);
    g.strokeStyle = 'rgba(18,20,24,0.55)'; g.lineWidth = 1;
    g.strokeRect(px + 0.5, py + 0.5, pw, ph);
    for (let k = 0; k < 60; k++) {
      g.fillStyle = 'rgba(200,200,192,' + (0.03 + rnd() * 0.04).toFixed(3) + ')';
      g.fillRect(px + ri(pw), py + ri(ph), 1, 1);
    }
  }
  // Hairline cracks wandering down the tile.
  g.strokeStyle = 'rgba(12,14,18,0.5)'; g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = ri(W), y = ri(H);
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 9; k++) { x += (rnd() - 0.5) * 10; y += 5 + rnd() * 11; g.lineTo(x, y); }
    g.stroke();
  }
  // Paint last, so lines stay readable over patches and cracks.
  g.fillStyle = '#e8e4d8';
  g.fillRect(7, 0, 3, H); g.fillRect(W - 10, 0, 3, H);
  for (let i = 0; i < 10; i++) { // worn nicks in the edge lines
    g.fillStyle = 'rgba(46,49,56,0.5)';
    g.fillRect(rnd() < 0.5 ? 7 : W - 10, ri(H), 3, 2 + ri(4));
  }
  g.fillStyle = '#f5c542';
  for (let y = 0; y < H; y += 64) g.fillRect(W / 2 - 3, y, 6, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Crossing decal: transparent paint overlay (zebra bars + lane arrow) applied
// on the junction approaches, so the road's own asphalt and centre line show
// through. 128x128, one texture reused by both crossing orientations.
function roadTextureCrossing() {
  const W = 128, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 0x1c0ffee >>> 0;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const ri = (n) => Math.floor(rnd() * n);
  g.clearRect(0, 0, W, H);
  // Zebra bars across the carriageway, kept clear of the edge lines.
  g.fillStyle = 'rgba(232,228,216,0.92)';
  for (let y = 4; y < 54; y += 10) g.fillRect(8, y, W - 16, 6);
  // Lane arrow, apex toward the crossing.
  const ax = 32, ay = 64;
  g.fillRect(ax - 4, ay + 22, 8, 42);
  g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + 11, ay + 23); g.lineTo(ax - 11, ay + 23); g.closePath(); g.fill();
  // Scuff the paint so the decal does not read as a sticker.
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    g.fillStyle = 'rgba(0,0,0,' + (0.25 + rnd() * 0.5).toFixed(2) + ')';
    g.fillRect(ri(W), ri(H), 1 + ri(5), 1 + ri(3));
  }
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCity(scene, rng) {
  const lamps = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roadTex = roadTexture();
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9 });
  const walkMat = mat(PALETTE.sidewalk, { roughness: 1 });
  const groundMat = mat(0x8f8578, { roughness: 1 });

  function plane(w, d, x, z, y, material, ry = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    m.rotation.x = -Math.PI / 2; m.rotation.z = ry;
    m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m;
  }
  // Ground: south slab, north-west slab, north-east strip (basin stays open water).
  plane(720, 540, 0, 0, 0, groundMat);
  plane(540, 90, -90, -405, 0, groundMat);
  plane(180, 30, 270, -375, 0, groundMat);
  // Roads: long planes with the dashed-line texture; the boulevard skips the river span.
  function roadPlane(x, z, len, vertical, skipRiver) {
    const tex = roadTex.clone(); tex.needsUpdate = true;
    tex.repeat.set(1, Math.max(1, Math.round(len / 24)));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(12, len),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    m.rotation.x = -Math.PI / 2;
    if (!vertical) m.rotation.z = Math.PI / 2;
    m.position.set(x, 0.02, z); m.receiveShadow = true; scene.add(m);
    // Sidewalk strips.
    const sw = vertical ? [x - 8, x + 8] : [z - 8, z + 8];
    for (const s of sw) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(4, len), walkMat);
      p.rotation.x = -Math.PI / 2; if (!vertical) p.rotation.z = Math.PI / 2;
      p.position.set(vertical ? s : x, 0.04, vertical ? z : s); p.receiveShadow = true; scene.add(p);
    }
    if (skipRiver) return;
  }
  for (const x of VX) {
    if (x === CITY.bridgeX) {
      roadPlane(x, 0, 540, true, true); // south side, z -270..270
      roadPlane(x, -405, 90, true, true); // north stub, z -450..-360
    } else {
      roadPlane(x, 0, 540, true, false);
      roadPlane(x, -405, 90, true, false);
    }
  }
  for (const z of HZ) roadPlane(0, z, 720, false, false);

  // Buildings: one or two per block, district palette + facade texture.
  const facadeMats = new Map();
  function facadeMat(color) {
    if (!facadeMats.has(color)) {
      const t = facadeTexture(color, 0xffffff);
      facadeMats.set(color, new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
    }
    return facadeMats.get(color);
  }
  const blockRows = [[-450, -405], [-270, -225], [-225, -135], [-135, -45], [-45, 45], [45, 135], [135, 225], [225, 270]];
  for (let ci = 0; ci < VX.length - 1; ci++) {
    for (const [z0, z1] of blockRows) {
      const cx = (VX[ci] + VX[ci + 1]) / 2, cz = (z0 + z1) / 2;
      // The harbour basin (x 180..360, z -450..-390) stays open water: no buildings there.
      if (cx > 135 && cz < -400) continue;
      const d = DISTRICTS.find((dd) => cx >= dd.x0 && cx < dd.x1 && cz >= dd.z0 && cz < dd.z1);
      if (!d) continue;
      const n = d.hMax > 15 ? (rng() < 0.6 ? 2 : 1) : (rng() < 0.5 ? 2 : 1);
      for (let k = 0; k < n; k++) {
        const w = range(rng, 14, Math.min(30, (VX[ci + 1] - VX[ci]) - 16));
        const dep = range(rng, 12, Math.min(26, (z1 - z0) - 14));
        const bx = cx + (k === 0 ? -1 : 1) * range(rng, 0, (VX[ci + 1] - VX[ci] - w) / 4);
        const bz = cz + range(rng, -8, 8);
        const h = range(rng, d.hMin, d.hMax);
        const color = pick(rng, d.colors);
        const b = new THREE.Mesh(boxGeo, facadeMat(color));
        b.scale.set(w, h, dep); b.position.set(bx, h / 2, bz);
        b.castShadow = true; b.receiveShadow = true; scene.add(b);
        const roof = new THREE.Mesh(boxGeo, mat(0x3a3f46, { roughness: 1 }));
        roof.scale.set(w + 0.6, 0.5, dep + 0.6); roof.position.set(bx, h + 0.25, bz); scene.add(roof);
        addBox(bx - w / 2, bz - dep / 2, bx + w / 2, bz + dep / 2, h);
      }
    }
  }
  // Palms along the boulevard and scattered in blocks (instanced).
  const palmSpots = [];
  for (let z = -240; z <= 240; z += 30) { palmSpots.push([-45 - 10, z]); palmSpots.push([-45 + 10, z + 15]); }
  for (let i = 0; i < 40; i++) palmSpots.push([range(rng, -340, 340), range(rng, -260, 250)]);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 7, 6);
  const crownGeo = new THREE.IcosahedronGeometry(2.4, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x6b4a2a, { roughness: 1 }), palmSpots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, mat(0x2e7d46, { roughness: 1 }), palmSpots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  palmSpots.forEach(([x, z], i) => {
    const h = range(rng, 6, 9);
    // Trunk only: the crown sits at y h+1.2, above the chase camera.
    addOccluderCylinder(x, z, 0.4, 0, h + 0.5);
    m4.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(1, h / 7, 1));
    trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, h + 1.2, z), q, new THREE.Vector3(1, 0.45, 1));
    crowns.setMatrixAt(i, m4);
  });
  trunks.castShadow = true; crowns.castShadow = true;
  scene.add(trunks, crowns);
  // Lamps along roads (instanced poles + heads; heads glow at night).
  const lampSpots = [];
  for (const x of VX) for (let z = -440; z <= 260; z += 45) lampSpots.push([x + 7, z]);
  for (const z of HZ) for (let x = -340; x <= 340; x += 45) lampSpots.push([x, z + 7]);
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 5);
  const poles = new THREE.InstancedMesh(poleGeo, mat(0x2a2e33, { roughness: 0.6, metalness: 0.4 }), lampSpots.length);
  const headGeo = new THREE.BoxGeometry(0.7, 0.25, 0.4);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, emissive: 0x000000 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
  lampSpots.forEach(([x, z], i) => {
    addOccluderCylinder(x, z, 0.15, 0, 6.1); // pole only; head is above the camera
    m4.compose(new THREE.Vector3(x, 3, z), q, s.set(1, 1, 1)); poles.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, 6.1, z), q, s.set(1, 1, 1)); heads.setMatrixAt(i, m4);
  });
  scene.add(poles, heads);
  lamps.push(headMat);
  buildBridge(scene, rng);
  buildPort(scene, rng);
  buildFactory(scene, rng);
  return { lamps };
}
// Sekarwangi bridge: S-curve deck at y=6, one curved pylon, fan of cables.
function buildBridge(scene, rng) {
  const deckMat = mat(0x3a3f46, { roughness: 0.9 });
  const white = mat(0xf2ede2, { roughness: 0.5 });
  const group = new THREE.Group();
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const z0 = -240 - t0 * 150, z1 = -240 - t1 * 150;
    const x0 = CITY.bridgeX + 8 * Math.sin(t0 * Math.PI), x1 = CITY.bridgeX + 8 * Math.sin(t1 * Math.PI);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(26, 1.2, len), deckMat);
    seg.position.set((x0 + x1) / 2, 6, (z0 + z1) / 2);
    seg.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    seg.castShadow = true; seg.receiveShadow = true; group.add(seg);
    // Railing.
    for (const side of [-13, 13]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, len), white);
      rail.position.set((x0 + x1) / 2 + side * Math.cos(seg.rotation.y), 7.1, (z0 + z1) / 2 - side * Math.sin(seg.rotation.y));
      rail.rotation.y = seg.rotation.y; group.add(rail);
    }
  }
  // Single asymmetric pylon, leaning like a sail, 70 m tall.
  const pylon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.2, 70, 8), white);
  pylon.position.set(CITY.bridgeX - 4, 6 + 35, -315); pylon.rotation.z = 0.12;
  pylon.castShadow = true; group.add(pylon);
  // The pylon has no collision box; the camera needs it as a cylinder
  // (radius covers the 0.12 lean, y from the deck to the top).
  addOccluderCylinder(CITY.bridgeX - 4, -315, 3.4, 6, 76);
  // Amber beacon band near the top, so the bridge reads at dusk too.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.85, 1.4, 8),
    new THREE.MeshStandardMaterial({ color: 0xf5a623, emissive: 0x7a4a00, emissiveIntensity: 0.9, roughness: 0.5 }));
  band.position.y = 30; pylon.add(band);
  // Cable fan: 16 lines from the pylon top to the deck.
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const z = -255 - i * 8;
    pts.push(new THREE.Vector3(CITY.bridgeX - 4 + 70 * 0.12, 6 + 68, -315));
    pts.push(new THREE.Vector3(CITY.bridgeX + 8 * Math.sin(((z + 240) / -150) * Math.PI), 6.8, z));
  }
  const cableGeo = new THREE.BufferGeometry().setFromPoints(pts);
  group.add(new THREE.LineSegments(cableGeo, new THREE.LineBasicMaterial({ color: 0xffffff })));
  scene.add(group);
}
// Port: containers, market stalls, fishing boats (hulls).
function buildPort(scene, rng) {
  const contColors = [0xb8452e, 0x2e6db8, 0x3f8a4a, 0xc9a13b, 0x7a4a8a];
  for (let i = 0; i < 26; i++) {
    // On the quay strip (z -385..-365), which has ground under it — the
    // harbour basin (z < -390) is open water and containers floated on it.
    const x = range(rng, 120, 320), z = range(rng, -385, -365);
    const stacked = rng() < 0.3;
    const c = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.6),
      mat(pick(rng, contColors), { roughness: 0.8, metalness: 0.3 }));
    c.position.set(x, 1.3 + (stacked ? 2.6 : 0), z);
    c.rotation.y = rng() < 0.5 ? 0 : Math.PI / 2;
    c.castShadow = true; scene.add(c);
    addBox(x - 3, z - 3, x + 3, z + 3, stacked ? 5.2 : 2.6);
  }
  // Market stalls with striped awnings along the riverbank promenade.
  for (let i = 0; i < 12; i++) {
    const x = range(rng, -320, 320), z = -262 + (rng() < 0.5 ? -2 : 2);
    const stall = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 2.5), mat(0x8a6b4a, { roughness: 1 }));
    stall.position.set(x, 1.2, z); stall.castShadow = true; scene.add(stall);
    const awn = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 3),
      mat(pick(rng, [0xe0453a, 0x2fd3c4, 0xf5a623]), { roughness: 0.9 }));
    awn.position.set(x, 2.6, z); scene.add(awn);
    addBox(x - 1.8, z - 1.5, x + 1.8, z + 1.5, 2.6);
  }
}
// The factory hall sits flush inside its block (x 175..219, clear of the
// x=225 road); chimney and silos on the yard, clear of roads too.
function buildFactory(scene, rng) {
  const brick = mat(0x9e5b45, { roughness: 1 });
  const hall = new THREE.Mesh(new THREE.BoxGeometry(44, 16, 26), brick);
  hall.position.set(197, 8, -40); hall.castShadow = true; hall.receiveShadow = true; scene.add(hall);
  addBox(197 - 22, -40 - 13, 197 + 22, -40 + 13, 16);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3, 40, 10), mat(0x7d3a2e, { roughness: 1 }));
  chimney.position.set(236, 20, -58); chimney.castShadow = true; scene.add(chimney);
  addBox(233, -61, 239, -55, 40);
  for (const [x, z] of [[180, -70], [192, -70]]) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 16, 10), mat(0x9aa0a4, { roughness: 0.7, metalness: 0.4 }));
    silo.position.set(x, 8, z); silo.castShadow = true; scene.add(silo);
    addBox(x - 4, z - 4, x + 4, z + 4, 16);
  }
}
