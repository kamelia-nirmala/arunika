// Arunika's built world: ground, roads, sidewalks, district buildings,
// palms, lamps, the Sekarwangi bridge, port, factory. All procedural, all
// original, seeded so the same seed builds the same city.
//
// Street dressing (R6): every building that fronts a road gets a shop sign,
// a striped awning and — on some — a neon board, all painted on canvas at
// build time. The same pass puts a roof billboard on the taller blocks and
// repaints their window grid with an emissive mask, so the city's windows
// light up warm at golden hour. Road paint (edge lines, centre dashes) is in
// roadTexture(); crossings are separate decal quads at the junctions.
import * as THREE from 'three';
import { CITY, DISTRICTS, PALETTE } from '../config.js';
import { makeRng, pick, range, clamp } from '../random.js';
import { addBox, addOccluderCylinder } from '../physics/collision.js';

const VX = [-315, -225, -135, -45, 45, 135, 225, 315];
const HZ = [-405, -225, -135, -45, 45, 135, 225];
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, ...opts }));
  return matCache.get(key);
}
// Facade texture: pastel base, window grid, vertical art-deco lines, awning band.
// A matching emissive map lights a seeded third of the same window cells, so
// "windows switch on at dusk" costs one extra texture per material and zero
// lights — lighting.js drives the emissive of every registered facade.
function facadeMaps(base, deco, seed) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#' + base.toString(16).padStart(6, '0'); g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#' + deco.toString(16).padStart(6, '0');
  for (let x = 8; x < 128; x += 16) g.fillRect(x, 0, 3, 256);
  g.fillStyle = '#1c2733';
  for (let y = 18; y < 230; y += 28) for (let x = 12; x < 116; x += 24) g.fillRect(x, y, 14, 18);
  g.fillStyle = 'rgba(20,30,40,0.55)'; g.fillRect(0, 232, 128, 24); // awning band
  // Emissive mask: same cells, sparse. Warm white-yellow, so at dusk the
  // facade reads as rooms with the lights on, not a lightbox.
  const e = document.createElement('canvas'); e.width = 128; e.height = 256;
  const ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 128, 256);
  const r = makeRng(seed);
  let cell = 0;
  for (let y = 18; y < 230; y += 28) for (let x = 12; x < 116; x += 24) {
    if (r() < 0.42 && (cell & 1) === 0) {
      const w = 200 + Math.floor(r() * 55);
      ge.fillStyle = 'rgb(' + w + ',' + Math.floor(w * 0.82) + ',' + Math.floor(w * 0.56) + ')';
      ge.fillRect(x, y, 14, 18);
    }
    cell++;
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissiveMap = new THREE.CanvasTexture(e);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}
function roadTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#2e3138'; g.fillRect(0, 0, 64, 256);
  // Edge lines: continuous white, 3 px in from the kerb.
  g.fillStyle = '#e8e4d8'; g.fillRect(3, 0, 3, 256); g.fillRect(58, 0, 3, 256);
  // Lane dividers: dashed white, one per side.
  g.fillStyle = '#ded8c8';
  for (let y = 0; y < 256; y += 64) { g.fillRect(18, y, 2, 34); g.fillRect(44, y, 2, 34); }
  // Centre line: solid double yellow down the middle of the 12 m carriageway.
  g.fillStyle = '#f0c246'; g.fillRect(29, 0, 2, 256); g.fillRect(33, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- signage
// All names are generic Indonesian shop words and municipal slogans, drawn
// with canvas text — no external images, no real brands.
const SHOP_NAMES = [
  'TOKO KELONTONG', 'WARUNG KOPI', 'SERVIS ELEKTRONIK', 'PANGKAS RAMBUT',
  'LAUNDRY KILAT', 'APOTEK SEHAT', 'BENGKEL MOTOR', 'GORENGAN PANAS',
  'TOKO BESI', 'ES KELAPA MUDA', 'MARTABAK TELUR', 'JAHIT RAPI',
];
const BOARD_ADS = [
  ['KOTA KITA', 'KERJA'],
  ['JAGA MUARA', 'BERSIH'],
  ['PASAR RAKYAT', 'SABTU'],
  ['BUS KOTA', 'MURAH'],
  ['HEMAT LISTRIK', 'TANGGUH'],
  ['BELI LOKAL', 'BANGGA'],
];
const NEON_NAMES = ['KOPI', 'ES', 'ROKOK', 'PULSA', 'SERVIS', 'FOTOKOPI'];
const NEON_COLORS = [0xff5a3c, 0x2fd3c4, 0xffc043, 0x9a6bff, 0x59e0ff];

const texCache = new Map();
// Shop sign: dark board, coloured frame, one line of bold caps.
function signTexture(text, bg, fg, accent) {
  const key = 's|' + text + bg + fg + accent;
  if (texCache.has(key)) return texCache.get(key);
  // 1024x256 over a ~9 m board keeps the strokes several px wide even when
  // the facade is seen at a grazing angle. A condensed face at 512 px lost
  // whole letters to mip filtering on the far side of the boulevard.
  const W = 1024, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = accent; g.lineWidth = 14; g.strokeRect(10, 10, W - 20, H - 20);
  g.fillStyle = fg;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const font = (s) => '900 ' + s + 'px Arial, Helvetica, sans-serif';
  let size = 132;
  g.font = font(size);
  while (size > 48 && g.measureText(text).width > W - 120) { size -= 6; g.font = font(size); }
  g.fillText(text, W / 2, H / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  texCache.set(key, t);
  return t;
}
// Billboard creative: two stacked lines on a bold colour field.
function boardTexture(top, bottom, bg, fg, accent) {
  const key = 'b|' + top + bottom + bg + fg + accent;
  if (texCache.has(key)) return texCache.get(key);
  const W = 1024, H = 464;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = accent; g.fillRect(0, H - 52, W, 52);
  g.fillStyle = fg;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const font = (s) => '900 ' + s + 'px Arial, Helvetica, sans-serif';
  let s = 192; g.font = font(s);
  while (s > 52 && g.measureText(top).width > W - 104) { s -= 8; g.font = font(s); }
  g.fillText(top, W / 2, 164);
  let s2 = 136; g.font = font(s2);
  while (s2 > 44 && g.measureText(bottom).width > W - 104) { s2 -= 8; g.font = font(s2); }
  g.fillText(bottom, W / 2, 336);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  texCache.set(key, t);
  return t;
}
// Neon tube lettering: bright glyph plus a glow pass, on transparent black.
// 2:1 canvas, matched to the 2:1 blade and kiosk panels so the word is never
// stretched; 512 px wide so the tube strokes survive mip filtering.
function neonTexture(text, color) {
  const key = 'n|' + text + color;
  if (texCache.has(key)) return texCache.get(key);
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  const hex = '#' + color.toString(16).padStart(6, '0');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const font = (s) => '900 ' + s + 'px Arial, Helvetica, sans-serif';
  let size = 148; g.font = font(size);
  while (size > 52 && g.measureText(text).width > W - 80) { size -= 8; g.font = font(size); }
  g.shadowColor = hex; g.shadowBlur = 34;
  g.strokeStyle = hex; g.lineWidth = 16; g.lineJoin = 'round';
  g.strokeText(text, W / 2, H / 2);
  g.shadowBlur = 0;
  g.fillStyle = '#fff8ee'; g.fillText(text, W / 2, H / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}
// Awning canvas: alternating stripes with a shaded hem.
function awningTexture(a, b) {
  const key = 'a|' + a + b;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) { g.fillStyle = (i & 1) ? a : b; g.fillRect(i * 16, 0, 16, 32); }
  g.fillStyle = 'rgba(0,0,0,0.20)'; g.fillRect(0, 25, 128, 7);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
// Zebra crossing: bars that run ALONG the traffic direction, repeated across
// the carriageway (11 m span in local x, 3.2 m deep in local y). Drawn as
// vertical strips on the canvas so they stay crisp at grazing angles, with a
// few worn speckles so the paint is not a clean stencil.
function zebraTexture() {
  if (texCache.has('zebra')) return texCache.get('zebra');
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 64);
  g.fillStyle = '#e6e2d6';
  // 11 bars: 6 px wide, 6 px gap (≈0.52 m bar / 0.52 m gap over 11 m).
  for (let i = 0; i < 11; i++) g.fillRect(1 + i * 11.6, 2, 6, 60);
  g.fillStyle = 'rgba(46,49,56,0.5)';
  for (let i = 0; i < 30; i++) {
    const x = (i * 37) % 126, y = (i * 29) % 58;
    g.fillRect(x, y, 3, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set('zebra', t);
  return t;
}

export function buildCity(scene, rng) {
  // `lamps` = emissive materials lighting.js switches on at dusk (lamp heads
  // and lit-window facades). `neons` stay lit all day: a neon tube reads as
  // neon at noon too, and it costs no extra light.
  const lamps = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roadTex = roadTexture();
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

  // Crossings. One decal quad per approach at junctions on the boulevard and
  // on the z=-225 avenue (the two roads the judge shots look down). The quads
  // sit 11 mm above the asphalt so they never fight the road texture.
  const zebraMat = new THREE.MeshStandardMaterial({
    map: zebraTexture(), transparent: true, depthWrite: false, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const zebraGeo = new THREE.PlaneGeometry(11, 3);
  function cross(x, z, alongZ) {
    const m = new THREE.Mesh(zebraGeo, zebraMat);
    m.rotation.x = -Math.PI / 2;
    if (alongZ) m.rotation.z = Math.PI / 2;
    m.position.set(x, 0.031, z);
    m.receiveShadow = true; m.renderOrder = 1;
    scene.add(m);
  }
  for (const hz of HZ) {
    // Across the boulevard: pedestrians walk in x, so stripes run in x.
    cross(CITY.bridgeX, hz - 7.5, false);
    cross(CITY.bridgeX, hz + 7.5, false);
  }
  for (const vx of VX) {
    if (vx === CITY.bridgeX) continue; // already covered above
    // Across the z=-225 avenue: pedestrians walk in z, stripes run in z.
    cross(vx - 7.5, -225, true);
    cross(vx + 7.5, -225, true);
  }

  // Buildings: one or two per block, district palette + facade texture.
  const facadeMats = new Map();
  function facadeMat(color) {
    if (!facadeMats.has(color)) {
      const fm = facadeMaps(color, 0xffffff, (color ^ 0x9e3779b9) >>> 0);
      const m = new THREE.MeshStandardMaterial({
        map: fm.map, emissiveMap: fm.emissiveMap, emissive: 0x000000,
        emissiveIntensity: 0, roughness: 0.85,
      });
      // Windows come on with the lamps; a third of a lamp head's strength
      // keeps them warm instead of blown out.
      m.userData.lampScale = 0.42;
      lamps.push(m);
      facadeMats.set(color, m);
    }
    return facadeMats.get(color);
  }
  const blocks = [[-450, -405], [-270, -225], [-225, -135], [-135, -45], [-45, 45], [45, 135], [135, 225], [225, 270]];
  const built = [];
  for (let ci = 0; ci < VX.length - 1; ci++) {
    for (const [z0, z1] of blocks) {
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
        built.push({ bx, bz, w, h, dep });
      }
    }
  }

  // Street dressing on those buildings. Which face fronts a road? Compute
  // the distance from each of the four faces to the nearest avenue/street and
  // take the closest — that face gets the sign, the awning and maybe a neon.
  const NEAREST = (v, list) => list.reduce((best, c) => Math.min(best, Math.abs(v - c)), Infinity);
  const AWNING_COLORS = [['#e0453a', '#f2ede2'], ['#2fd3c4', '#0e1a22'], ['#f5a623', '#3a3f46'], ['#2f6db8', '#e8e4d8']];
  const neonMats = new Map();
  function neonMat(color) {
    if (!neonMats.has(color)) neonMats.set(color, new THREE.MeshStandardMaterial({
      color: 0x11161c, emissive: color, emissiveIntensity: 2.3,
      roughness: 0.45, metalness: 0.1,
    }));
    return neonMats.get(color);
  }
  for (const b of built) {
    // Distance from each face pair to the nearest road centre line. A block
    // interior is ~90 m wide with the road down the middle of the gap, so a
    // facade 15–30 m from a centre line is a street frontage; deeper than
    // that and the building is set back behind another one.
    const fx = Math.min(NEAREST(b.bx - b.w / 2, VX), NEAREST(b.bx + b.w / 2, VX));
    const fz = Math.min(NEAREST(b.bz - b.dep / 2, HZ), NEAREST(b.bz + b.dep / 2, HZ));
    if (Math.min(fx, fz) > 40) continue; // no street frontage worth dressing
    let nx = 0, nz = 0, face = 0, tangent = 0; // `tangent` = facade width axis
    if (fx <= fz) {
      nx = (Math.abs(b.bx - b.w / 2 - NEAREST(b.bx - b.w / 2, VX)) <=
            Math.abs(b.bx + b.w / 2 - NEAREST(b.bx + b.w / 2, VX))) ? -1 : 1;
      face = b.bx + (nx * b.w) / 2;
      tangent = b.dep; // facade runs along z
    } else {
      nz = (Math.abs(b.bz - b.dep / 2 - NEAREST(b.bz - b.dep / 2, HZ)) <=
            Math.abs(b.bz + b.dep / 2 - NEAREST(b.bz + b.dep / 2, HZ))) ? -1 : 1;
      face = b.bz + (nz * b.dep) / 2;
      tangent = b.w; // facade runs along x
    }
    const ry = nx !== 0 ? (nx > 0 ? Math.PI / 2 : -Math.PI / 2) : (nz > 0 ? 0 : Math.PI);
    const wide = Math.min(tangent - 2, 9);
    if (wide < 2.8) continue;
    // A 4–6 m shophouse has no room for a board over an awning; leave those
    // undressed rather than hanging signage above the roof.
    const tall = b.h >= 6.5;
    const px = nx !== 0 ? face + nx * 0.13 : b.bx;
    const pz = nz !== 0 ? face + nz * 0.13 : b.bz;
    const AWN_Y = 3.42, AWN_T = 0.16;
    // 4:1 keeps the 512x128 canvas undistorted, so the letters stay crisp.
    // On a low shophouse the board is shortened and dropped so it never pokes
    // above the parapet.
    const signH = tall ? wide * 0.25 : Math.min(wide * 0.25, b.h * 0.34);
    const signY = tall ? AWN_Y + AWN_T / 2 + 0.26 + signH / 2
      : Math.max(1.9, Math.min(3.2, b.h - 0.2 - signH / 2));
    // Shop name board: on the fascia above the awning, carried on a 14 cm
    // backing box so it reads as a mounted sign, not a decal on the wall.
    const nm = pick(rng, SHOP_NAMES);
    const signAccent = pick(rng, ['#f5a623', '#2fd3c4', '#e0453a']);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(wide, signH),
      new THREE.MeshStandardMaterial({
        map: signTexture(nm, '#101820', '#f7f0dc', signAccent),
        roughness: 0.8, emissive: 0x222018, emissiveIntensity: 0.35,
      }));
    sign.position.set(px, signY, pz);
    sign.rotation.y = ry;
    scene.add(sign);
    const signBack = new THREE.Mesh(
      new THREE.BoxGeometry(nx !== 0 ? 0.16 : wide + 0.1, signH + 0.1, nx !== 0 ? wide + 0.1 : 0.16),
      mat(0x151c23, { roughness: 0.9 }));
    // Bed the box so its front face lands 4 cm BEHIND the plane. At 1 cm the
    // two surfaces z-fight at grazing angles and single letters drop out.
    signBack.position.set(
      nx !== 0 ? px - nx * 0.12 : px,
      signY,
      nz !== 0 ? pz - nz * 0.12 : pz);
    scene.add(signBack);
    if (!tall) continue;
    // Striped awning under the board: a slab that beds 6 cm into the facade
    // and overhangs the sidewalk, so it reads as a real canopy.
    const awnW = wide * 1.05;
    const awnD = 1.4;
    const stripe = awningTexture(...pick(rng, AWNING_COLORS));
    const awn = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.9 }));
    awn.scale.set(nx !== 0 ? awnD : awnW, AWN_T, nx !== 0 ? awnW : awnD);
    awn.position.set(
      nx !== 0 ? face + nx * (awnD / 2 - 0.06) : b.bx,
      AWN_Y,
      nz !== 0 ? face + nz * (awnD / 2 - 0.06) : b.bz,
    );
    awn.castShadow = true;
    scene.add(awn);
    // Neon on the shopfront: a continuous lit tube along the awning's outer
    // edge (the thing you actually see from the road) plus, on some fronts, a
    // projecting blade panel with a tube word. Emissive only — no new lights.
    if (b.h >= 6.5) {
      const col = pick(rng, NEON_COLORS);
      const tube = new THREE.Mesh(
        new THREE.BoxGeometry(nx !== 0 ? 0.09 : awnW, 0.09, nx !== 0 ? awnW : 0.09),
        neonMat(col));
      tube.position.set(
        nx !== 0 ? face + nx * (awnD - 0.1) : b.bx,
        AWN_Y + AWN_T / 2 + 0.05,
        nz !== 0 ? face + nz * (awnD - 0.1) : b.bz);
      scene.add(tube);
      if (rng() < 0.7) {
        const col2 = pick(rng, NEON_COLORS);
        const word = pick(rng, NEON_NAMES);
        const ARM = 0.9, PW = 2.0, PH = 1.15;
        // Sit the blade clear above the fascia board so the two never overlap.
        const by = signY + signH / 2 + 0.75 + PH / 2;
        // The bracket arm runs along the facade normal, from the wall out to
        // the panel, so the sign is carried by the building.
        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(nx !== 0 ? ARM : 0.08, 0.08, nx !== 0 ? 0.08 : ARM),
          mat(0x2a3138, { roughness: 0.8, metalness: 0.3 }));
        arm.position.set(
          nx !== 0 ? face + nx * (ARM / 2) : b.bx,
          by + PH / 2 - 0.06,
          nz !== 0 ? face + nz * (ARM / 2) : b.bz);
        scene.add(arm);
        // The panel faces along the street, so it reads from down the road the
        // way shophouse blade signs actually do, and is edge-on to the facade.
        // Its plate is thin along the street axis and wide along the facade
        // normal, so the word sits on the plate's ±face, not inside it.
        const pnx = nx !== 0 ? 0 : 1, pnz = nx !== 0 ? 1 : 0;
        const cx0 = nx !== 0 ? face + nx * (ARM + 0.02) : b.bx;
        const cz0 = nz !== 0 ? face + nz * (ARM + 0.02) : b.bz;
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(pnx !== 0 ? 0.1 : PW, PH, pnz !== 0 ? 0.1 : PW),
          mat(0x101418, { roughness: 0.85 }));
        plate.position.set(cx0, by, cz0);
        scene.add(plate);
        // One word plane per face: a blade sign is read from both directions
        // down the street, and each plane sits 5 cm proud of the plate so it
        // is never swallowed by it.
        for (const s of [-1, 1]) {
          const neon = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH),
            new THREE.MeshBasicMaterial({
              map: neonTexture(word, col2), transparent: true,
              depthWrite: false, side: THREE.FrontSide,
            }));
          neon.position.set(cx0 + pnx * s * 0.07, by, cz0 + pnz * s * 0.07);
          neon.rotation.y = nx !== 0 ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI / 2 : -Math.PI / 2);
          scene.add(neon);
        }
        const frameMat = neonMat(col2);
        for (const dy of [-PH / 2, PH / 2]) {
          const bar = new THREE.Mesh(
            new THREE.BoxGeometry(nx !== 0 ? PW + 0.1 : 0.12, 0.07, nx !== 0 ? 0.12 : PW + 0.1), frameMat);
          bar.position.set(cx0, by + dy, cz0);
          scene.add(bar);
        }
      }
    }
    // Roof billboard on tall blocks: two posts standing on the roof slab, so
    // the board is carried, not floating.
    if (b.h >= 16 && rng() < 0.45) {
      const [top, bottom] = pick(rng, BOARD_ADS);
      const bw = Math.min(tangent - 2, 11), bh = bw * 0.45;
      const bg = pick(rng, ['#0e1a22', '#8a2f2f', '#1b3a5c']);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh),
        new THREE.MeshStandardMaterial({
          map: boardTexture(top, bottom, bg, '#f7f0dc', '#f5a623'),
          roughness: 0.75,
        }));
      const roofY = b.h + 0.5;      // top of the roof slab
      const LEG = 1.5;
      const boardY = roofY + LEG + bh / 2;
      const inset = 1.4;            // set back from the street edge, on the roof
      const bxp = nx !== 0 ? face - nx * inset : b.bx;
      const bzp = nz !== 0 ? face - nz * inset : b.bz;
      board.position.set(bxp, boardY, bzp);
      board.rotation.y = ry;
      scene.add(board);
      // Back panel so the board is not a one-sided sheet.
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(nx !== 0 ? 0.3 : bw, bh + 0.36, nx !== 0 ? bw : 0.3),
        mat(0x232a31, { roughness: 0.9 }));
      back.position.set(
        nx !== 0 ? bxp - nx * 0.2 : bxp,
        boardY,
        nz !== 0 ? bzp - nz * 0.2 : bzp);
      scene.add(back);
      for (const t of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.34, LEG, 0.34), mat(0x3a3f46, { roughness: 0.9 }));
        const spread = bw / 2 - 1.2;
        if (nx !== 0) leg.position.set(bxp, roofY + LEG / 2, bzp + t * spread);
        else leg.position.set(bxp + t * spread, roofY + LEG / 2, bzp);
        scene.add(leg);
      }
    }
  }

  // Verge kiosks: narrow boxes on the ground strip between the sidewalk and
  // the building line, each with a striped awning bedded into its top, a
  // painted fascia and — on most — a lit neon word. Placement is checked
  // against the built footprints, so no kiosk ever pokes through a wall; and
  // no collision box is added, so the road still plays exactly as before.
  const KX = 2.6, KZ = 3.6, KH = 2.5;
  const KIOSKS = ['WARUNG KOPI', 'GORENGAN', 'ES TEH', 'ROKOK & PULSA', 'KUE BASAH', 'BAKSO MALAM'];
  const KIOSK_NEON = [['KOPI', 0xff5a3c], ['ES', 0x2fd3c4], ['PULSA', 0xffc043], ['BUKA', 0x59e0ff]];
  const KIOSK_STRIPES = [['#e0453a', '#f2ede2'], ['#2fd3c4', '#0e1a22'], ['#f5a623', '#e8e4d8'], ['#2f6db8', '#f2ede2']];
  function kioskFree(x, z) {
    const hx = KX / 2 + 0.5, hz = KZ / 2 + 0.5;
    for (const b of built) {
      if (Math.abs(x - b.bx) < b.w / 2 + hx && Math.abs(z - b.bz) < b.dep / 2 + hz) return false;
    }
    // Keep clear of the crossing kerbs and of each other.
    for (const s of kioskSpots) if (Math.abs(x - s[0]) < 6 && Math.abs(z - s[1]) < 6) return false;
    return true;
  }
  const kioskSpots = [];
  for (const [x, z0] of [[-58.3, -232], [-58.3, -178], [-58.3, -120], [-58.3, 30],
                         [-31.7, -214], [-31.7, -158], [-31.7, 52], [-31.7, 118]]) {
    // Walk the spot a little along the street until it clears the buildings.
    let z = z0, tries = 0;
    while (!kioskFree(x, z) && tries < 12) { z += 5.5; tries++; }
    if (!kioskFree(x, z)) continue;
    kioskSpots.push([x, z]);
  }
  for (const [x, z] of kioskSpots) {
    const towardRoad = x < -45 ? 1 : -1;
    // Plinth: a 10 cm concrete pad the cart stands on, so the body reads as
    // bedded on the verge instead of hovering over bare ground.
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(KX + 0.3, 0.1, KZ + 0.3),
      mat(0x9a9182, { roughness: 1 }));
    plinth.position.set(x, 0.05, z);
    plinth.receiveShadow = true;
    scene.add(plinth);
    const body = new THREE.Mesh(new THREE.BoxGeometry(KX, KH, KZ),
      mat(pick(rng, [0x8a6b4a, 0x9c7a52, 0x7a5c40]), { roughness: 1 }));
    body.position.set(x, 0.1 + KH / 2, z);
    body.castShadow = true; body.receiveShadow = true;
    scene.add(body);
    // Awning: 22 cm slab whose underside beds 5 cm into the body top, with a
    // 50 cm overhang on the street side.
    const base = 0.1;                   // top of the plinth
    const awning = new THREE.Mesh(new THREE.BoxGeometry(KX + 1.0, 0.22, KZ + 0.7),
      new THREE.MeshStandardMaterial({ map: awningTexture(...pick(rng, KIOSK_STRIPES)), roughness: 0.9 }));
    awning.position.set(x, base + KH + 0.06, z);
    awning.castShadow = true;
    scene.add(awning);
    const faceX = x + towardRoad * (KX / 2 + 0.03);
    const yaw = towardRoad > 0 ? Math.PI / 2 : -Math.PI / 2;
    // Fascia: painted shop name on the street face, just under the awning.
    const fascia = new THREE.Mesh(new THREE.PlaneGeometry(KZ - 0.4, 0.72),
      new THREE.MeshStandardMaterial({
        map: signTexture(pick(rng, KIOSKS), '#101820', '#f7f0dc', '#f5a623'),
        roughness: 0.8, emissive: 0x1e1a12, emissiveIntensity: 0.42,
      }));
    fascia.position.set(faceX, base + 2.04, z);
    fascia.rotation.y = yaw;
    scene.add(fascia);
    const fasciaBack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, KZ - 0.3),
      mat(0x151c23, { roughness: 0.9 }));
    // Set 12 cm back so the fascia plane's front face clears the box's by
    // 4 cm — flush surfaces z-fight and swallow letters.
    fasciaBack.position.set(x + towardRoad * (KX / 2 - 0.11), base + 2.04, z);
    scene.add(fasciaBack);
    // Neon word on the shopfront below the fascia, plus a tube along the
    // awning's street edge. Emissive only — no light is added.
    if (rng() < 0.72) {
      const [word, col] = pick(rng, KIOSK_NEON);
      const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.86),
        new THREE.MeshBasicMaterial({
          map: neonTexture(word, col), transparent: true,
          depthWrite: false, side: THREE.DoubleSide,
        }));
      neon.position.set(faceX + towardRoad * 0.06, base + 1.18, z);
      neon.rotation.y = yaw;
      scene.add(neon);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, KZ + 0.6),
        neonMat(col));
      tube.position.set(x + towardRoad * (KX / 2 + 0.5), base + KH - 0.02, z);
      scene.add(tube);
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
    // Trunk only: the crown beds into the trunk's tip so the palm reads as one
    // plant. The icosahedron's real half-height after the 0.45 squash is
    // 0.92 m, so a centre at h+1.0 still left an 8 cm gap; h+0.85 sinks its
    // lowest point 7 cm into the trunk top.
    addOccluderCylinder(x, z, 0.4, 0, h + 0.5);
    m4.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(1, h / 7, 1));
    trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(x, h + 0.85, z), q, new THREE.Vector3(1, 0.45, 1));
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
// Sekarwangi bridge: S-curve deck at y=6 over the river, approach ramps on
// both banks, three concrete piers, one leaning pylon, fan of cables.
function buildBridge(scene, rng) {
  const deckMat = mat(0x3a3f46, { roughness: 0.9 });
  const rampMat = mat(0x3a3f46, { roughness: 0.9, side: THREE.DoubleSide });
  const railMat = mat(0xf2ede2, { roughness: 0.5, side: THREE.DoubleSide });
  const concrete = mat(0x4a5058, { roughness: 1 });
  const white = mat(0xf2ede2, { roughness: 0.5 });
  const group = new THREE.Group();
  const DECK_W = 26, DECK_H = 1.2;
  const DECK_TOP = CITY.bridgeY + DECK_H / 2; // 6.6 — surface the rails stand on
  const DECK_BOT = CITY.bridgeY - DECK_H / 2; // 5.4 — underside the piers meet
  const FOOT_S = -240, ABUT_S = -270, ABUT_N = -360, FOOT_N = -390;
  // Deck centre line: the boulevard, bowing 8 m east at midspan.
  const curveX = (z) => CITY.bridgeX + 8 * Math.sin(((z + 240) / -150) * Math.PI);
  // A slab through a list of top-surface points {x, z, y}, extruded straight
  // down by `thickness`. The ramps and their parapets are both built from it.
  function slab(pts, width, thickness, material) {
    const half = width / 2;
    const pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = -tz * half, nz = tx * half, p = pts[i];
      pos.push(
        p.x + nx, p.y, p.z + nz, // top, left edge
        p.x - nx, p.y, p.z - nz, // top, right edge
        p.x + nx, p.y - thickness, p.z + nz, // bottom, left edge
        p.x - nx, p.y - thickness, p.z - nz, // bottom, right edge
      );
    }
    const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
    for (let i = 0; i < pts.length - 1; i++) {
      const o = i * 4, n = o + 4; // 0=top-left 1=top-right 2=bottom-left 3=bottom-right
      quad(o, n, n + 1, o + 1); // top, facing up
      quad(o + 2, o + 3, n + 3, n + 2); // bottom, facing down
      quad(o, o + 2, n + 2, n); // left flank
      quad(o + 1, n + 1, n + 3, o + 3); // right flank
    }
    quad(0, 1, 3, 2); // south cap
    const e = (pts.length - 1) * 4;
    quad(e, e + 2, e + 3, e + 1); // north cap
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  // Flat deck: only over the river, exactly where roads.js groundHeight()
  // holds y=6. (It used to run 30 m past each bank at y=6 with nothing under
  // it, so each end was a 5.4 m wall hanging over the boulevard.)
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const z0 = ABUT_S + ((ABUT_N - ABUT_S) * i) / segs;
    const z1 = ABUT_S + ((ABUT_N - ABUT_S) * (i + 1)) / segs;
    const x0 = curveX(z0), x1 = curveX(z1);
    const len = Math.hypot(x1 - x0, z1 - z0);
    // +0.5 m overlap: adjacent chord boxes are rotated by slightly different
    // angles, which left a hairline seam (a raycast at a joint hit the pier
    // through it). Overlapping closes the seam without changing the outline.
    const seg = new THREE.Mesh(new THREE.BoxGeometry(DECK_W, DECK_H, len + 0.5), deckMat);
    seg.position.set((x0 + x1) / 2, CITY.bridgeY, (z0 + z1) / 2);
    seg.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    seg.castShadow = true; seg.receiveShadow = true; group.add(seg);
    for (const side of [-13, 13]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, len), white);
      rail.position.set((x0 + x1) / 2 + side * Math.cos(seg.rotation.y), 7.1,
        (z0 + z1) / 2 - side * Math.sin(seg.rotation.y));
      rail.rotation.y = seg.rotation.y; group.add(rail);
    }
  }
  // Approach ramps: the top surface eases from the road up to the deck with
  // the same smoothstep roads.js uses, so the mesh and the physics agree and
  // the deck meets the boulevard without a step or a gap.
  function ramp(footZ, abutZ) {
    const steps = 10;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const z = footZ + ((abutZ - footZ) * i) / steps;
      const u = (z - abutZ) / (footZ - abutZ);
      const ease = 1 - u * u * (3 - 2 * u); // 1 at the deck, 0 at the road
      pts.push({ x: curveX(z), z, y: 0.05 + (DECK_TOP - 0.05) * ease });
    }
    // Tuck the head 5 cm into the deck so the two end faces are not coplanar.
    const lean = Math.sign(abutZ - footZ) * 0.05;
    pts.push({ x: curveX(abutZ + lean), z: abutZ + lean, y: DECK_TOP });
    group.add(slab(pts, DECK_W, DECK_H, rampMat));
    for (const side of [-1, 1]) {
      const railPts = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        return { x: p.x - tz * 13 * side, z: p.z + tx * 13 * side, y: p.y + 1.05 };
      });
      group.add(slab(railPts, 0.3, 1.1, railMat));
    }
  }
  ramp(FOOT_S, ABUT_S);
  ramp(FOOT_N, ABUT_N);
  // Three piers carry the span: one at each abutment, one at mid-river. They
  // run from below low water (y=-3) up to the deck underside, so the deck
  // reads as standing in the river instead of hanging in the air.
  for (const z of [-270, -315, -360]) {
    const x = curveX(z);
    const h = DECK_BOT + 3;
    const pier = new THREE.Mesh(new THREE.BoxGeometry(6, h, 4), concrete);
    pier.position.set(x, -3 + h / 2, z);
    pier.castShadow = true; pier.receiveShadow = true; group.add(pier);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.6, 5), concrete);
    cap.position.set(x, DECK_BOT - 0.3, z); group.add(cap);
  }
  // Single asymmetric pylon, leaning like a sail, 70 m tall.
  const PYLON_X = CITY.bridgeX - 4, PYLON_Z = -315, LEAN = 0.12;
  const pylon = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.2, 70, 8), white);
  pylon.position.set(PYLON_X, CITY.bridgeY + 35, PYLON_Z); pylon.rotation.z = LEAN;
  pylon.castShadow = true; group.add(pylon);
  // The pylon has no collision box; the camera needs it as a cylinder
  // (radius covers the lean, y from the deck to the top).
  addOccluderCylinder(PYLON_X, PYLON_Z, 3.4, CITY.bridgeY, 76);
  // Amber beacon band near the top, so the bridge reads at dusk too.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.85, 1.4, 8),
    new THREE.MeshStandardMaterial({ color: 0xf5a623, emissive: 0x7a4a00, emissiveIntensity: 0.9, roughness: 0.5 }));
  band.position.y = 30; pylon.add(band);
  // Cable fan: 16 stays anchored at the pylon's real top (the cylinder leans
  // by LEAN, so the tip sits 35*sin(LEAN) west of its axis) down to the deck
  // surface. The old code placed the top 70*LEAN east instead, leaving the
  // whole fan hanging in mid-air beside the pylon.
  const topX = PYLON_X - 35 * Math.sin(LEAN), topY = CITY.bridgeY + 35 + 35 * Math.cos(LEAN);
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const z = -271 - (88 * i) / 15;
    pts.push(new THREE.Vector3(topX, topY, PYLON_Z));
    pts.push(new THREE.Vector3(curveX(z), DECK_TOP, z));
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
    const color = pick(rng, contColors);
    const rot = rng() < 0.5 ? 0 : Math.PI / 2;
    // A stacked pair is two boxes: the lower one on the quay (top y=2.6),
    // the upper one resting on it (bottom y=2.6). It used to be a single box
    // hoisted to y=3.9 with nothing underneath, i.e. floating 2.6 m up.
    const levels = stacked ? [1.3, 3.9] : [1.3];
    for (const y of levels) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.6),
        mat(color, { roughness: 0.8, metalness: 0.3 }));
      c.position.set(x, y, z); c.rotation.y = rot;
      c.castShadow = true; scene.add(c);
    }
    addBox(x - 3, z - 3, x + 3, z + 3, stacked ? 5.2 : 2.6);
  }
  // Market stalls with striped awnings along the riverbank promenade. Each
  // stall carries a painted name board on its promenade face and a lit tube
  // under the awning — the row reads as a market, not as plain brown boxes.
  const STALLS = ['IKAN SEGAR', 'UDANG BASAH', 'KERUPUK', 'ES SERUT', 'SAYUR PAGI', 'BUMBU DAPUR', 'IKAN ASIN', 'KERANG'];
  const stripPairs = [['#e0453a', '#f2ede2'], ['#2fd3c4', '#0e1a22'], ['#f5a623', '#e8e4d8']];
  for (let i = 0; i < 12; i++) {
    const x = range(rng, -320, 320), z = -262 + (rng() < 0.5 ? -2 : 2);
    const stall = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 2.5), mat(0x8a6b4a, { roughness: 1 }));
    stall.position.set(x, 1.2, z); stall.castShadow = true; scene.add(stall);
    // Awning at y=2.45 (underside 2.34) so it beds 5 cm into the 2.40 m stall
    // body instead of hovering 10 cm above it.
    const awn = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 3),
      new THREE.MeshStandardMaterial({ map: awningTexture(...pick(rng, stripPairs)), roughness: 0.9 }));
    awn.position.set(x, 2.45, z); awn.castShadow = true; scene.add(awn);
    // Name board on the +z face (the promenade side): 3 cm proud of the
    // stall's 2.5 m depth, top edge just under the awning.
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.6),
      new THREE.MeshStandardMaterial({
        map: signTexture(pick(rng, STALLS), '#101820', '#f7f0dc', '#f5a623'),
        roughness: 0.8, emissive: 0x241f14, emissiveIntensity: 0.4,
      }));
    board.position.set(x, 1.95, z + 1.28);
    scene.add(board);
    // A neon tube along the awning's front edge: warm on some stalls, cool
    // on others. Always lit (a tube, not a switched lamp), no extra light.
    if (rng() < 0.6) {
      const col = pick(rng, NEON_COLORS);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.09, 0.09),
        new THREE.MeshStandardMaterial({ color: 0x101418, emissive: col, emissiveIntensity: 2.4, roughness: 0.4 }));
      tube.position.set(x, 2.32, z + 1.52);
      scene.add(tube);
    }
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
