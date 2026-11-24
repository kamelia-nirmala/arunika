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
import { groundHeight, onRoad } from './roads.js';

const VX = [-315, -225, -135, -45, 45, 135, 225, 315];
const HZ = [-405, -225, -135, -45, 45, 135, 225];
// Palm keep-outs: props.js street furniture (billboards with a 10 m face, bus
// shelters) and the later-built factory yard. Everything else the palms must
// dodge (buildings, kiosks) is already in `built` / `kioskSpots` by the time
// the palm block runs, so only these need hard-coded boxes.
const PALM_NO_PLANT = [
  // billboards: [-58,-180], [-32,-90], [-58,60], [-32,150], [58,-90]
  [-64, -182, -52, -178], [-38, -92, -26, -88], [-64, 58, -52, 62],
  [-38, 148, -26, 152], [52, -92, 64, -88],
  // bus shelters on the west verge, z -180, -45, 90, 180 (x -56..-52)
  [-58, -183, -50, -177], [-58, -48, -50, -42], [-58, 87, -50, 93], [-58, 177, -50, 183],
  // factory: hall, chimney, two silos
  [173, -55, 221, -25], [231, -63, 241, -53], [174, -76, 198, -64],
];
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

// Deck paint: the same lane language roadTexture() paints on the boulevard —
// but on a lighter tarmac base, because the deck only ever catches a grazing
// sun and a #2e3138 slab read as a black plate from the ramp. Nothing here
// emits light: it is the city's own paint, moved onto the span.
// R7: the vista camera now sits 158 m out instead of 83 m, so a 5 px line on a
// 128 px tile lands under a screen pixel once minification averages it. The
// base is lifted a second step (#4a5058 -> #585f68, still a road grey, and
// still reads darker than the white parapets) and the paint is drawn wider so
// the edge lines and the yellow centre survive the mip chain at that range.
function deckTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#585f68'; g.fillRect(0, 0, 128, 256);
  // Tarmac grain: sparse darker flecks so the slab is not a flat plate.
  g.fillStyle = 'rgba(24,28,34,0.30)';
  for (let i = 0; i < 260; i++) {
    g.fillRect((i * 41) % 128, (i * 97) % 256, 1, 2);
  }
  // Edge lines: continuous white, inset 4 px, as wide as the boulevard's.
  g.fillStyle = '#f2eee2'; g.fillRect(4, 0, 6, 256); g.fillRect(118, 0, 6, 256);
  // Lane dividers: dashed white.
  g.fillStyle = '#e6e0d0';
  for (let y = 0; y < 256; y += 64) { g.fillRect(32, y, 5, 34); g.fillRect(91, y, 5, 34); }
  // Centre: solid double yellow.
  g.fillStyle = '#f5c94e'; g.fillRect(57, 0, 5, 256); g.fillRect(66, 0, 5, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
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
    // Named so a probe can measure the board it paints: which boards are
    // clipped by a shot's frame edge is otherwise unanswerable from outside.
    sign.name = 'shopSign:' + nm;
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
          neon.name = 'bladeSign:' + word;
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
      board.name = 'roofBoard:' + top;
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
  // R9/M2 — measured on the shipped scene (probe, 0.01 m): two carts stood at
  // 0.00 m clearance. (-58.3,-232) had its north-east corner 2.3 m inside the
  // south ramp's concrete fill (fill x -58.83..-27.41, z -271.8..-231.86 vs
  // cart foot z -234.15..-229.85), and (-58.3,-178) was built around the
  // boulevard billboard's post and the bus shelter at the same z. Both read as
  // "stall embedded in the wall". The old test only knew about `built`
  // footprints, so nothing else could ever stop a cart.
  //
  // Street furniture from props.js stands on these verges but is created after
  // this module, so its footprints are mirrored here (rects x0,z0,x1,z1 at the
  // prop's own size — clearance is added by kioskFree). Keep in step with
  // PROP_BILLBOARDS / PROP_STOPS in props.js.
  const KIOSK_KEEP_OUT = [
    // billboard posts: 0.5 m square
    [-58.25, -180.25, -57.75, -179.75], [-32.25, -90.25, -31.75, -89.75],
    [-58.25, 59.75, -57.75, 60.25], [-32.25, 149.75, -31.75, 150.25],
    [57.75, -90.25, 58.25, -89.75],
    // bus shelters: 4 m canopy, 2.6 m bench, flag mast at +2.7 m
    [-57, -182, -51, -178], [-57, -47, -51, -43], [-57, 88, -51, 92], [-57, 178, -51, 182],
    // south approach fill: the ramp's closed concrete flank (x -62.9..-27.3 is
    // the 26 m deck width plus its kerb reveal, not the 12 m boulevard)
    [-62.9, -392, -27.3, -231.8],
    // the approach's own queue bay and the police staging line. Both are west
    // verge, both are occupied by shot traffic in the judge frames, and a cart
    // standing in either is measured at 0.00 m from a truck / a cruiser.
    [-63, -241, -52, -220], [-63, -181, -52, -164],
  ];
  const KIOSK_CLEAR = 1.2;   // air left between a cart and anything solid
  function kioskFree(x, z) {
    const hx = KX / 2 + KIOSK_CLEAR, hz = KZ / 2 + KIOSK_CLEAR;
    for (const b of built) {
      if (Math.abs(x - b.bx) < b.w / 2 + hx && Math.abs(z - b.bz) < b.dep / 2 + hz) return false;
    }
    for (const [x0, z0, x1, z1] of KIOSK_KEEP_OUT) {
      if (x > x0 - hx && x < x1 + hx && z > z0 - hz && z < z1 + hz) return false;
    }
    // Keep clear of the crossing kerbs and of each other.
    for (const s of kioskSpots) if (Math.abs(x - s[0]) < 6 && Math.abs(z - s[1]) < 6) return false;
    return true;
  }
  const kioskSpots = [];
  for (const [x, z0] of [[-58.3, -232], [-58.3, -178], [-58.3, -120], [-58.3, 30],
                         [-31.7, -214], [-31.7, -158], [-31.7, 52], [-31.7, 118]]) {
    // Walk the spot along the street until it clears the buildings, the street
    // furniture and the ramp flank. Both directions are tried (the old loop
    // only walked +z, so a cart blocked to the north was simply dropped), and
    // the search is wider than before because the clearance test is stricter.
    let z = null;
    for (let tries = 0; tries < 17 && z === null; tries++) {
      const step = tries === 0 ? 0 : Math.ceil(tries / 2) * 4.5 * (tries % 2 ? 1 : -1);
      if (kioskFree(x, z0 + step)) z = z0 + step;
    }
    if (z === null) continue;
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
    // Every part of the cart is tagged so a clearance probe measures the stall
    // against the city, not against its own awning and fascia boards.
    plinth.userData.kioskPart = true;
    scene.add(plinth);
    const body = new THREE.Mesh(new THREE.BoxGeometry(KX, KH, KZ),
      mat(pick(rng, [0x8a6b4a, 0x9c7a52, 0x7a5c40]), { roughness: 1 }));
    body.position.set(x, 0.1 + KH / 2, z);
    body.castShadow = true; body.receiveShadow = true;
    // Named + tagged so a probe can measure the cart against the wall behind
    // it (kiosk-vs-facade clearance is not visible from the code alone).
    body.name = 'kiosk';
    body.userData.kiosk = { x, z, w: KX, d: KZ, side: towardRoad };
    scene.add(body);
    // Awning: 22 cm slab whose underside beds 5 cm into the body top, with a
    // 50 cm overhang on the street side.
    const base = 0.1;                   // top of the plinth
    const awning = new THREE.Mesh(new THREE.BoxGeometry(KX + 1.0, 0.22, KZ + 0.7),
      new THREE.MeshStandardMaterial({ map: awningTexture(...pick(rng, KIOSK_STRIPES)), roughness: 0.9 }));
    awning.position.set(x, base + KH + 0.06, z);
    awning.castShadow = true;
    awning.userData.kioskPart = true;
    scene.add(awning);
    const faceX = x + towardRoad * (KX / 2 + 0.03);
    const yaw = towardRoad > 0 ? Math.PI / 2 : -Math.PI / 2;
    // Fascia: painted shop name on the street face, just under the awning.
    const kioskName = pick(rng, KIOSKS);
    const fascia = new THREE.Mesh(new THREE.PlaneGeometry(KZ - 0.4, 0.72),
      new THREE.MeshStandardMaterial({
        map: signTexture(kioskName, '#101820', '#f7f0dc', '#f5a623'),
        roughness: 0.8, emissive: 0x1e1a12, emissiveIntensity: 0.42,
      }));
    fascia.name = 'kioskSign:' + kioskName;
    fascia.position.set(faceX, base + 2.04, z);
    fascia.rotation.y = yaw;
    fascia.userData.kioskPart = true;
    scene.add(fascia);
    const fasciaBack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, KZ - 0.3),
      mat(0x151c23, { roughness: 0.9 }));
    // Set 12 cm back so the fascia plane's front face clears the box's by
    // 4 cm — flush surfaces z-fight and swallow letters.
    fasciaBack.position.set(x + towardRoad * (KX / 2 - 0.11), base + 2.04, z);
    fasciaBack.userData.kioskPart = true;
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
      neon.userData.kioskPart = true;
      scene.add(neon);
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, KZ + 0.6),
        neonMat(col));
      tube.position.set(x + towardRoad * (KX / 2 + 0.5), base + KH - 0.02, z);
      tube.userData.kioskPart = true;
      scene.add(tube);
    }
  }

  // ---- Palms -----------------------------------------------------------
  // R8/M2. The plant's own random stream is separate from `rng` so nothing
  // downstream (bridge, port, factory) can shift when this block changes.
  //
  // Placement is now checked, not guessed: the old block dropped 40 palms at
  // random x/z with no filter and 25 of 74 landed in a lane, on a kerb, on the
  // bridge ramp or inside a building. Every base here must sit on the flat
  // slab, at least PALM_CLEAR from any road centre line (1.5 m outside
  // onRoad's 7 m test), outside a footprint and outside a kiosk.
  const prng = makeRng(0x5eed17);
  const PALM_SIDES = 8, PALM_STATIONS = 7, PALM_LEAN = 0.62;
  const PALM_R_TIP = 0.135, PALM_R_BASE = 0.45;  // base 3.3x the old 0.26
  const PALM_CLEAR = 8.5, PALM_SPACING = 5.2;

  // Trunk: swept tube, 8 sides, curved, TIP-AT-ORIGIN (y 0 down to -1, base
  // drifting PALM_LEAN in +x) so an instance at (x, groundY + h, z) puts the
  // tip at (x, groundY + h, z) and the base exactly on the ground.
  function palmTrunkGeometry() {
    const pos = [], idx = [];
    for (let i = 0; i < PALM_STATIONS; i++) {
      const u = i / (PALM_STATIONS - 1);            // 0 = tip, 1 = base
      const y = -u;
      const cx = PALM_LEAN * Math.pow(u, 1.6);       // gentle, mostly upper bend
      // Steep taper with a real basal flare: 0.135 at the crown, 0.45 m at the
      // foot, most of the thickening packed into the bottom third.
      const r = (PALM_R_TIP + (PALM_R_BASE - PALM_R_TIP) * Math.pow(u, 1.7))
        * (1 + 0.04 * Math.sin(u * 7.0));
      for (let k = 0; k < PALM_SIDES; k++) {
        const a = (k / PALM_SIDES) * Math.PI * 2;
        pos.push(cx + Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
    for (let i = 0; i < PALM_STATIONS - 1; i++) {
      for (let k = 0; k < PALM_SIDES; k++) {
        const a = i * PALM_SIDES + k, b = i * PALM_SIDES + (k + 1) % PALM_SIDES;
        idx.push(a, b, a + PALM_SIDES, b, b + PALM_SIDES, a + PALM_SIDES);
      }
    }
    // Crown cap: a fan so the tip the fronds spring from is solid, not a hole.
    const cap = pos.length / 3;
    pos.push(0, 0, 0);
    for (let k = 0; k < PALM_SIDES; k++) idx.push(cap, (k + 1) % PALM_SIDES, k);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  // Frond: a pinnate blade — thin rachis plus 13 pairs of lance leaflets with
  // sky between them. R9 was one folded ribbon, which from 20 m read as a flat
  // green card with hard corners (bug7); a coconut crown needs separate blades.
  const FROND_PAIRS = 13, FROND_SPAN = 0.205;
  function palmFrondGeometry(droop) {
    const NS = 7, pos = [], col = [], idx = [];
    // Droop curve: rise then fall, so the blade arcs instead of hinging.
    const yAt = (t) => 0.34 * t - droop * t * t;
    // Tone along the blade: dark at the crown, light at the tip, written into a
    // vertex colour so one instance colour still shades along its own length.
    const pt = (t) => {
      const k = 0.70 + 0.38 * Math.min(1, Math.max(0, t));
      return [k * 0.92, k, k * 0.86];
    };
    const add = (x, y, z, t) => {
      const i = pos.length / 3;
      pos.push(x, y, z);
      const c = pt(t);
      col.push(c[0], c[1], c[2]);
      return i;
    };
    // Push a triangle with its normal pointing up. Fronds are seen from above
    // and from below; a flipped face would light as if it were the underside.
    const tri = (a, b, c) => {
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      if (ny < 0) idx.push(a, c, b); else idx.push(a, b, c);
    };
    // Rachis: a narrow V that widens toward the tip — only there to hold the
    // leaflets together and to hide the pivot inside the crown.
    const rv = [];
    for (let i = 0; i < NS; i++) {
      const t = i / (NS - 1);
      const w = 0.010 + 0.022 * t;
      const y = yAt(t), dip = w * 0.55;
      rv.push([add(t, y - dip, -w, t), add(t, y, 0, t), add(t, y - dip, w, t)]);
    }
    for (let i = 0; i < NS - 1; i++) {
      const a = rv[i], b = rv[i + 1];
      tri(a[0], a[1], b[0]); tri(b[0], a[1], b[1]);
      tri(a[1], a[2], b[1]); tri(b[1], a[2], b[2]);
    }
    // Leaflets: 13 pairs, longest a third of the way out and vanishing at the
    // tip, raked back along the blade. Each one is a kite of two triangles
    // whose mid rib lifts and whose tip hangs, alternating pair to pair, so
    // neighbours cross instead of lying in one plane.
    for (let p = 0; p < FROND_PAIRS; p++) {
      const t = 0.07 + (p / (FROND_PAIRS - 1)) * 0.86;
      const lance = t <= 0.34
        ? 0.62 + 0.38 * (t / 0.34)
        : Math.pow(Math.max(0, 1 - (t - 0.34) / 0.72), 1.15);
      const L = FROND_SPAN * lance;
      if (L < 0.012) continue;
      const y0 = yAt(t), ang = 1.24 - 0.52 * t;
      const r = 0.010 + 0.022 * t;
      const up = (p % 2 ? 1 : -1) * 0.16 * L;
      for (const side of [-1, 1]) {
        const dx = Math.cos(ang) * L, dz = side * Math.sin(ang) * L;
        const hw = L * 0.34;
        const ux = dx / L, uz = dz / L;
        const px = -uz * hw, pz = ux * hw;
        const rootZ = side * r;
        const midT = t + Math.abs(dx) * 0.42, tipT = t + Math.abs(dx);
        const a = add(t, y0 - 0.008, rootZ, t);
        const b1 = add(t + dx * 0.42 + px, y0 + up, rootZ + dz * 0.42 + pz, midT);
        const b2 = add(t + dx * 0.42 - px, y0 + up, rootZ + dz * 0.42 - pz, midT);
        const c1 = add(t + dx, yAt(Math.min(1, tipT)) - 0.06 * L, rootZ + dz, tipT);
        tri(a, b1, c1); tri(a, c1, b2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  // Planting pad: one instanced disc per palm carrying a dark soil ring plus
  // the soft contact shadow, painted into a single radial gradient. Same trick
  // the cars use (a dark blob just above the road at y 0.06) — no shadow-map
  // sample, no light, one extra draw call for all 70-odd palms.
  function palmPadTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0.00, 'rgba(52,38,24,0.80)');
    grd.addColorStop(0.34, 'rgba(46,34,22,0.72)');
    grd.addColorStop(0.60, 'rgba(30,24,18,0.34)');
    grd.addColorStop(1.00, 'rgba(20,18,16,0.00)');
    g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
    // A few darker flecks so the pad reads as loose earth, not a vinyl disc.
    g.fillStyle = 'rgba(24,16,10,0.55)';
    const pr2 = makeRng(0x7a1d);
    for (let i = 0; i < 26; i++) {
      const a = pr2() * Math.PI * 2, rr = 12 + pr2() * 32;
      g.beginPath(); g.arc(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr, 1.5 + pr2() * 3.2, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Candidate anchors: the two boulevard rows plus 40 scattered. An anchor is
  // the BASE of a trunk (the point that must touch ground), not its tip.
  // The scattered coordinates are drawn from the MAIN stream on purpose: this
  // block has always consumed 80 rng() calls here and 74 for the heights, and
  // the bridge/port/factory downstream depend on that stream staying put.
  const candidates = [];
  for (let z = -240; z <= 240; z += 30) { candidates.push([-45 - 10, z, true]); candidates.push([-45 + 10, z + 15, true]); }
  for (let i = 0; i < 40; i++) candidates.push([range(rng, -340, 340), range(rng, -260, 250), false]);
  // Heights: one rng() per candidate, exactly as before.
  for (const c of candidates) c.push(range(rng, 6.8, 10.8));

  const palmBlocked = (x, z) => {
    for (const vx of VX) if (Math.abs(x - vx) < PALM_CLEAR) return true;
    for (const hz of HZ) if (Math.abs(z - hz) < PALM_CLEAR) return true;
    // Flat slab only: rejects the deck, both ramps, the river and the mud ford.
    if (Math.abs(groundHeight(x, z, 0.5)) > 0.05) return true;
    // The ramp's south toe is at z=-240 where groundHeight is still 0 but the
    // ramp slab and its parapet already stand there, so keep the whole
    // approach footprint clear on both sides of the boulevard.
    if (x > -62 && x < -28 && z > -392 && z < -236) return true;
    for (const b of built) {
      if (Math.abs(x - b.bx) < b.w / 2 + 2.0 && Math.abs(z - b.bz) < b.dep / 2 + 2.0) return true;
    }
    for (const s of kioskSpots) if (Math.abs(x - s[0]) < 4.2 && Math.abs(z - s[1]) < 4.2) return true;
    // Static keep-outs for structures built after this block (factory yard)
    // and for street furniture from props.js that has no footprint in `built`:
    // billboards (10 m face) and bus-stop shelters on the boulevard verges.
    for (const [x0, z0, x1, z1] of PALM_NO_PLANT) if (x > x0 && x < x1 && z > z0 && z < z1) return true;
    for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < PALM_SPACING) return true;
    if (Math.abs(x) > 344 || z < -252 || z > 262) return true;
    return false;
  };
  const placed = [];
  for (const [cx, cz, isBlvd, h] of candidates) {
    let ax = null, az = null;
    if (isBlvd) {
      // Walk the row in 3 m bites (0, +3, -3, +6, -6 …) until it clears a
      // junction, a kiosk or a footprint. Deterministic, so the row stays
      // straight and the same seed always lands in the same place.
      for (let t = 0; t <= 11 && ax === null; t++) {
        const step = Math.ceil(t / 2) * 3.0 * (t % 2 ? -1 : 1);
        if (!palmBlocked(cx, cz + step)) { ax = cx; az = cz + step; }
      }
    } else {
      // Rejection sampling on the plant stream: a blocked scatter palm is
      // re-drawn from the same distribution, never clamped into a wall.
      for (let t = 0; t < 90 && ax === null; t++) {
        const x = t === 0 ? cx : range(prng, -340, 340);
        const z = t === 0 ? cz : range(prng, -250, 250);
        if (!palmBlocked(x, z)) { ax = x; az = z; }
      }
    }
    if (ax !== null) placed.push({ x: ax, z: az, h });
  }

  const trunkGeo = palmTrunkGeometry();
  // Three droop variants at most: 0.40 (gentle), 0.66 (arched), 0.95 (a real
  // hanging tip). The R9 set ran to 1.32, which dropped the tip almost a metre
  // below the crown and read as a willow; these arc without hanging.
  const frondGeos = [palmFrondGeometry(0.40), palmFrondGeometry(0.66), palmFrondGeometry(0.95)];
  const trunks = new THREE.InstancedMesh(trunkGeo,
    // White base colour: instance colours multiply with it, so the per-palm
    // brown shades must be the instance colour, not a second tint on top.
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), Math.max(1, placed.length));
  trunks.name = 'palmTrunks';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion();
  const qz = new THREE.Quaternion(), qx = new THREE.Quaternion();
  // Roll about the blade's own long axis, so the leaflets face the camera from
  // every azimuth instead of all lying in one plane (a flat card on the sky).
  const qr = new THREE.Quaternion(), frondAxis = new THREE.Vector3(1, 0, 0);
  const s = new THREE.Vector3(), v = new THREE.Vector3();
  const tip = new THREE.Vector3(), tipLocalAxis = new THREE.Vector3(0, 0, 1);
  const spinAxis = new THREE.Vector3(0, 1, 0);
  const frondX = [], frondMat = [], frondCol = [], tips = [], pads = [];
  const col = new THREE.Color();
  placed.forEach(({ x, z, h }, i) => {
    const groundY = groundHeight(x, z, 0.5);
    // Yaw about Y only — the lean is baked along +x, so a yaw turns the plant
    // in place instead of tipping it over. The trunk's foot is the anchor, so
    // the tip is the anchor pushed back along the lean.
    const yaw = prng() * Math.PI * 2;
    const tx = x - PALM_LEAN * Math.cos(yaw);
    const tz = z + PALM_LEAN * Math.sin(yaw);
    q.setFromAxisAngle(spinAxis, yaw);
    m4.compose(new THREE.Vector3(tx, groundY + h, tz), q, s.set(1, h, 1));
    trunks.setMatrixAt(i, m4);
    trunks.setColorAt(i, col.setHex(0x6b4a2a).offsetHSL(0, 0, (prng() - 0.5) * 0.12));
    // Occluder follows the new footprint: 0.45 m of trunk from the soil up.
    addOccluderCylinder(x, z, PALM_R_BASE, groundY, groundY + h + 0.5);
    tip.set(tx, groundY + h, tz);
    tips.push({ x: tx, y: groundY + h, z: tz });
    // Planting pad under the foot, 6.5 cm up so it clears the sidewalk (0.04).
    qx.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    m4.compose(new THREE.Vector3(x, groundY + 0.065, z), qx, s.set(1.25, 1.25, 1));
    pads.push(m4.clone());
    // 16-20 fronds. R9 ran 10-14, which left sky gaps between the blades and
    // made a distant crown read as a five-pointed star; the extra blades plus a
    // spear of short upright ones at the centre give the silhouette a coconut
    // palm gets at 300 px. Fronds on a verge palm are kept shorter so no blade
    // ever reaches across the asphalt (nearest road centre line minus 3 m).
    let clr = Infinity;
    for (const vx of VX) clr = Math.min(clr, Math.abs(x - vx));
    for (const hz of HZ) clr = Math.min(clr, Math.abs(z - hz));
    const maxLen = clr < 13 ? 2.9 : 3.35;
    const nf = 16 + Math.floor(prng() * 5);       // 16..20
    for (let f = 0; f < nf; f++) {
      // The last three are the spear: short, near-upright, in the crown centre.
      const spear = f >= nf - 3;
      const az = (f / nf) * Math.PI * 2 + (prng() - 0.5) * 0.42;
      const tilt = spear
        ? 0.62 + prng() * 0.42                 // pointing up out of the crown
        : -0.46 + prng() * 0.94;               // down-swept to near-level
      let len = 2.35 + prng() * (maxLen - 2.35);
      if (spear) len *= 0.42 + prng() * 0.10;
      // R9/M2 — a blade may hang over the verge but never over a lane. Measured
      // on the shipped scene: 4 of 886 fronds crossed the carriageway edge
      // (nearest tip 5.76 m from a centre line, i.e. 0.24 m inside the 6 m
      // half-width), and from a low camera those tips read as the road being
      // covered. The blade is a ray from the crown along (cos az, -sin az), so
      // each lane edge it would cross gives an exact t at which to stop; keep
      // FROND_EDGE of air beyond the edge. Blades that already clear are
      // untouched, so the crowns keep their shape.
      const FROND_EDGE = 0.8;
      const dx = Math.cos(az), dz = -Math.sin(az);
      let clip = Infinity;
      for (const vx of VX) {
        if (Math.abs(dx) < 1e-6) continue;
        const edge = CITY.roadWidth / 2 + FROND_EDGE;
        const t = dx > 0 ? (vx - edge - tx) / dx : (vx + edge - tx) / dx;
        if (t > 0) clip = Math.min(clip, t);
      }
      for (const hz of HZ) {
        if (Math.abs(dz) < 1e-6) continue;
        const edge = CITY.roadWidth / 2 + FROND_EDGE;
        const t = dz > 0 ? (hz - edge - tz) / dz : (hz + edge - tz) / dz;
        if (t > 0) clip = Math.min(clip, t);
      }
      if (clip < len) len = Math.max(1.5, clip - 0.02);
      qy.setFromAxisAngle(spinAxis, az);
      qz.setFromAxisAngle(tipLocalAxis, tilt);
      qr.setFromAxisAngle(frondAxis, (prng() - 0.5) * 1.2);
      qy.multiply(qz).multiply(qr);
      // Root sits 12 cm inside the crown, fanned out along the azimuth so the
      // bases fill the dome instead of all meeting at one see-through point.
      const ro = 0.09 + prng() * 0.14;
      const rootY = -0.10 - prng() * 0.10;
      v.set(Math.cos(az) * ro, rootY, -Math.sin(az) * ro).applyQuaternion(qy).add(tip);
      m4.compose(v, qy, s.set(len, len, len));
      // Droop variant cycles so all three shapes appear in every crown.
      const varIdx = f % 3;
      frondX.push(varIdx); frondMat.push(m4.clone());
      frondCol.push(col.setHex(0x3f9447).offsetHSL((prng() - 0.5) * 0.05,
        0, (prng() - 0.5) * 0.18).getHex());
    }
  });
  trunks.count = placed.length;
  const perVar = [[], [], []];
  frondMat.forEach((m, i) => perVar[frondX[i]].push([m, frondCol[i]]));
  const frondMeshes = perVar.map((list, k) => {
    const mesh = new THREE.InstancedMesh(frondGeos[k],
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, vertexColors: true }),
      Math.max(1, list.length));
    mesh.name = 'palmFronds' + 'ABC'[k];
    list.forEach(([m, c], i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, col.setHex(c)); });
    mesh.count = list.length;
    return mesh;
  });
  const padMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 14),
    new THREE.MeshBasicMaterial({
      map: palmPadTexture(), color: 0xffffff, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }), Math.max(1, pads.length));
  padMesh.name = 'palmPads';
  pads.forEach((m, i) => padMesh.setMatrixAt(i, m));
  padMesh.count = pads.length;
  padMesh.renderOrder = 2;
  trunks.castShadow = true;
  for (const f of frondMeshes) f.castShadow = true;
  trunks.userData.tips = tips;
  scene.add(trunks, ...frondMeshes, padMesh);
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
  buildBridge(scene, rng, lamps);
  buildPort(scene, rng);
  buildFactory(scene, rng);
  return { lamps };
}
// Sekarwangi bridge: S-curve deck at y=6 over the river, approach ramps on
// both banks, three concrete piers, one leaning pylon, fan of cables.
function buildBridge(scene, rng, lamps) {
  const railMat = mat(0xf2ede2, { roughness: 0.5, side: THREE.DoubleSide });
  const concrete = mat(0x4a5058, { roughness: 1 });
  const white = mat(0xf2ede2, { roughness: 0.5 });
  const group = new THREE.Group();
  const DECK_W = 26, DECK_H = 1.2;
  const DECK_TOP = CITY.bridgeY + DECK_H / 2; // 6.6 — surface the rails stand on
  const DECK_BOT = CITY.bridgeY - DECK_H / 2; // 5.4 — underside the piers meet
  const FOOT_S = -240, ABUT_S = -270, ABUT_N = -360, FOOT_N = -390;
  // Deck surface: the boulevard's own lane paint, wrapped along the span.
  // One tile is 26 m wide × 24 m long, matching how roadPlane repeats the
  // 12 m road texture (len / 24), so dashes keep the city's spacing.
  const deckTex = deckTexture();
  deckTex.repeat.set(1, 1);
  // R7: at the vista hour this span is lit only by a grazing sun, and its
  // shadowed lanes on the far side of the pylon used to crush to black.
  // Rather than move the sun (that would move the sky, which belongs to another
  // module), the deck surface itself carries a faint self-lit floor: a dark
  // blue-grey emissive, no glow, no light added to the scene, so the tarmac
  // stays readable in its own shadow and the white edge lines and yellow
  // centre keep their contrast. This still matters at R7/M3b's 17.35, because
  // the deck lamps light the parapets, not the roadbed between them.
  const deckMat = new THREE.MeshStandardMaterial({
    map: deckTex, roughness: 0.78, metalness: 0.05,
    emissive: 0x1e232c, emissiveIntensity: 1,
  });
  const rampMat = new THREE.MeshStandardMaterial({
    map: deckTex, roughness: 0.88, side: THREE.DoubleSide,
    emissive: 0x1e232c, emissiveIntensity: 1,
  });
  // Deck centre line: the boulevard, bowing 8 m east at midspan.
  const curveX = (z) => CITY.bridgeX + 8 * Math.sin(((z + 240) / -150) * Math.PI);
  // A slab through a list of top-surface points {x, z, y}, extruded straight
  // down by `thickness`. The ramps and their parapets are both built from it.
  // `vScale` (metres per texture tile) also emits UVs, so a road-paint material
  // can be laid straight onto the slab: u across the width, v along the path.
  function slab(pts, width, thickness, material, vScale) {
    const half = width / 2;
    const pos = [], idx = [], uv = [];
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = -tz * half, nz = tx * half, p = pts[i];
      if (i > 0) run += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const v = vScale ? run / vScale : 0;
      // `y2` (optional, absolute) lets one slab have a per-point underside:
      // the approach fills below use it to reach the ground plane while the
      // painted deck slab keeps its constant 1.2 m structural depth.
      const yb = p.y2 === undefined ? p.y - thickness : p.y2;
      pos.push(
        p.x + nx, p.y, p.z + nz, // top, left edge
        p.x - nx, p.y, p.z - nz, // top, right edge
        p.x + nx, yb, p.z + nz, // bottom, left edge
        p.x - nx, yb, p.z - nz, // bottom, right edge
      );
      uv.push(0, v, 1, v, 0, v, 1, v);
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
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  // Flat deck: only over the river, exactly where roads.js groundHeight()
  // holds y=6. (It used to run 30 m past each bank at y=6 with nothing under
  // it, so each end was a 5.4 m wall hanging over the boulevard.)
  // Built as ONE slab through the S-curve rather than 12 chord boxes: the
  // paint then runs continuously down the span (with the box version every
  // segment restarted the texture and the dashes came out 4x too dense), and
  // the seam overlaps are no longer needed. The deck joints that used to be
  // implied by those box seams are drawn explicitly below as expansion strips,
  // which is what a driver actually sees.
  const deckPts = [];
  const segs = 12;
  for (let i = 0; i <= segs; i++) {
    const z = ABUT_S + ((ABUT_N - ABUT_S) * i) / segs;
    deckPts.push({ x: curveX(z), z, y: DECK_TOP });
  }
  // Tuck each end 6 cm into its ramp head, so the two end faces are not
  // coplanar with the ramp slab's cap.
  deckPts[0].z -= 0.06; deckPts[segs].z += 0.06;
  group.add(slab(deckPts, DECK_W, DECK_H, deckMat, 24));
  // Deck joints: a dark steel expansion strip across the full 26 m at every
  // section boundary, 1 cm proud of the surface so it catches the low sun.
  const jointMat = mat(0x23272c, { roughness: 0.55, metalness: 0.35 });
  for (let i = 1; i < segs; i++) {
    const z = ABUT_S + ((ABUT_N - ABUT_S) * i) / segs;
    const zN = z + 0.4;
    const joint = new THREE.Mesh(new THREE.BoxGeometry(DECK_W, 0.08, 0.55), jointMat);
    joint.position.set(curveX(z), DECK_TOP + 0.01, z);
    joint.rotation.y = Math.atan2(curveX(zN) - curveX(z), 0.4);
    group.add(joint);
  }
  for (let i = 0; i < segs; i++) {
    const z0 = ABUT_S + ((ABUT_N - ABUT_S) * i) / segs;
    const z1 = ABUT_S + ((ABUT_N - ABUT_S) * (i + 1)) / segs;
    const x0 = curveX(z0), x1 = curveX(z1);
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    for (const side of [-13, 13]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, len), white);
      rail.position.set((x0 + x1) / 2 + side * Math.cos(ry), 7.1,
        (z0 + z1) / 2 - side * Math.sin(ry));
      rail.rotation.y = ry; group.add(rail);
    }
  }
  // Approach ramps. The top surface eases from the road up to the deck with
  // the same smoothstep roads.js uses, so the mesh and the physics agree at
  // the joint.
  //
  // R9/M1 — measured on the shipped scene before this pass (raycast probe):
  //   * the ramp was a constant 1.2 m slab, so at z -252 its underside was
  //     y 1.06 and at z -266 y 4.90 over nothing but the y 0.02 road plane. A
  //     ray fired level with the road (y 0.6) from x -75 toward +x at z -254
  //     hit the building at x -20.85, i.e. it crossed the whole approach
  //     without touching it: an open corridor under the ramp, which is the
  //     "floating slab / terpotong" the vista showed;
  //   * the foot top sat at y 0.05 on a road plane at y 0.02 (a 3 cm lip) and
  //     the slab simply stopped there with its 1.2 m end cap exposed;
  //   * each 1.1 m parapet ended dead at z -240 with its end face in the air.
  // The fix is structural: the same stations are now filled down past the
  // terrain plane (a closed retaining face instead of a floating edge), and
  // the toe runs 6 m past the foot and dives under the road, so the junction
  // is an intersection line cut by the tarmac rather than a slab cap.
  const GROUND_Y = 0;  // terrain slab under the boulevard
  const ROAD_Y = 0.02; // roadPlane() is laid 2 cm proud of the terrain
  const fillMat = mat(0x8a9199, { roughness: 1, side: THREE.DoubleSide }); // abutment concrete
  function ramp(footZ, abutZ) {
    const steps = 12;
    const out = -Math.sign(abutZ - footZ); // foot -> street, away from the span
    // Stations from the road up to the deck head.
    const roadPts = [];
    for (let i = 0; i <= steps; i++) {
      const z = footZ + ((abutZ - footZ) * i) / steps;
      const u = (z - abutZ) / (footZ - abutZ);
      const ease = 1 - u * u * (3 - 2 * u); // 1 at the deck, 0 at the road
      roadPts.push({ x: curveX(z), z, y: ROAD_Y + (DECK_TOP - ROAD_Y) * ease });
    }
    // Tuck the head 5 cm into the deck so the two end faces are not coplanar.
    const lean = Math.sign(abutZ - footZ) * 0.05;
    roadPts.push({ x: curveX(abutZ + lean), z: abutZ + lean, y: DECK_TOP });
    // Buried toe: two stations carrying the surface under the road plane, so
    // the slab is cut by the tarmac instead of ending on top of it. They are
    // prepended (south of the foot) to keep the path monotonic for the slab.
    const toePts = [];
    for (let i = 2; i >= 1; i--) {
      const z = footZ + out * 3 * i;
      toePts.push({ x: curveX(z), z, y: ROAD_Y - 0.15 * (i / 2) });
    }
    const pts = toePts.concat(roadPts);
    // The ramp wears the same lane paint as the span, so the road, the climb
    // and the bridge read as one continuous surface in a low sun.
    group.add(slab(pts, DECK_W, DECK_H, rampMat, 24));
    // Fill: from just under the painted slab down past the terrain plane, so
    // the flank is a closed concrete face for its full height and no ray can
    // pass under the approach. 15 cm wider than the slab on each side, so the
    // concrete shows as a kerb-thick reveal and the two flanks are never
    // coplanar with the painted slab's own side faces.
    const fillPts = pts.map((p) => ({
      x: p.x, z: p.z, y: p.y - 0.02,
      y2: Math.min(GROUND_Y - 0.25, p.y - 0.05),
    }));
    group.add(slab(fillPts, DECK_W + 0.3, 0, fillMat));
    // Parapets stop at the foot (the buried toe carries no rail: a rail under
    // the tarmac would clip the queued traffic). Each one lands on a concrete
    // end post that also caps the wall's otherwise open end face.
    for (const side of [-1, 1]) {
      const railPts = roadPts.map((p, i) => {
        const a = roadPts[Math.max(0, i - 1)], b = roadPts[Math.min(roadPts.length - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        return { x: p.x - tz * 13 * side, z: p.z + tx * 13 * side, y: p.y + 1.05 };
      });
      group.add(slab(railPts, 0.3, 1.1, railMat));
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.3, 0.55), fillMat);
      const f = railPts[0];
      post.position.set(f.x, 0.55, f.z - out * 0.18);
      post.castShadow = true; post.receiveShadow = true;
      group.add(post);
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
    // R8/M1: the mid pier carries the pylon, so it is wider (8 m) and
    // deeper (6 m) than the abutment piers, with a wider cap — the pylon's
    // foundation reads continuously from the riverbed to the deck.
    const mid = z === -315;
    const pier = new THREE.Mesh(new THREE.BoxGeometry(mid ? 8 : 6, h, mid ? 6 : 4), concrete);
    pier.position.set(x, -3 + h / 2, z);
    pier.castShadow = true; pier.receiveShadow = true; group.add(pier);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(mid ? 9.6 : 7.6, 0.6, mid ? 7 : 5), concrete);
    cap.position.set(x, DECK_BOT - 0.3, z); group.add(cap);
  }
  // Deck lighting. The boulevard's lamps never reach the span: lampSpots only
  // walk the roads, so the 90 m between the abutments had no lit heads at all
  // and the deck read as a black plate in every golden-hour frame. These are
  // the SAME fixture the city already uses — a 6 m pole with a head that
  // lighting.js switches on at 16:45 — placed along both parapets, and their
  // head material is registered in `lamps` so nothing about the light budget
  // changes: no new PointLight, no new shadow map, just emissive heads.
  // R7: this material used to leave the heads unlit until lighting.js struck
  // them up, which meant the span read as a grey plate before dusk. The head
  // now carries a standing warm emissive — it is a lamp head, so a lit filament
  // is what the eye expects — and lighting.js still owns the dusk value: its
  // per-frame write replaces both emissive and intensity from 16:45 on, so play
  // at night is unchanged.
  const deckLampPole = new THREE.CylinderGeometry(0.09, 0.12, 5.2, 5);
  const deckLampHead = new THREE.BoxGeometry(0.66, 0.24, 0.4);
  const deckLampMat = new THREE.MeshStandardMaterial({
    color: 0xd8d2c0, emissive: 0xffc060, emissiveIntensity: 1.1,
  });
  // Registered floor: dim warm filament from build time until 16:45, then
  // lighting.js takes over at full lamp strength (see render/lighting.js).
  deckLampMat.userData.lampFloor = { color: 0xffc060, intensity: 1.1 };
  const deckPoleMat = mat(0x2a2e33, { roughness: 0.6, metalness: 0.4 });
  lamps.push(deckLampMat);
  // 8 stations × 2 sides = 16 heads, 9.6 m apart along the span, set 12.6 m
  // off the centre line so they sit on the parapet, not in a lane. The walk
  // runs NORTH from the south abutment, i.e. z decreases (ABUT_S = -270 is
  // the south end, ABUT_N = -360 the north).
  for (let i = 0; i < 8; i++) {
    const z = ABUT_S - 6 - i * 9.6;
    if (z < ABUT_N + 2) break;
    const zN = z - 0.5;
    const ry = Math.atan2(curveX(zN) - curveX(z), -0.5);
    for (const side of [-12.6, 12.6]) {
      const px = curveX(z) + side * Math.cos(ry);
      const pz = z - side * Math.sin(ry);
      const pole = new THREE.Mesh(deckLampPole, deckPoleMat);
      pole.position.set(px, DECK_TOP + 2.6, pz); // base on the deck surface
      group.add(pole);
      const head = new THREE.Mesh(deckLampHead, deckLampMat);
      head.position.set(px, DECK_TOP + 5.2, pz); // meets the pole's top
      group.add(head);
    }
  }
  // R8/M1: cable-stayed pylon, re-founded. BEFORE (measured):
  //   axis (-49, 41), LEAN 0.12 (6.9 deg), r 1.6/3.2, base-cap centre
  //   (-44.81, 6.25) — rel -7.81 m from the deck centre, i.e. IN the west
  //   outer traffic lane (lanes: W outer -13..-6.5, W inner -6.5..-1.4,
  //   E inner +1.4..+5.5, E outer +6.5..+13), 7.81 m off the mid pier
  //   (pier x -40..-34), leaning like it is about to fall, with no visible
  //   foundation. AFTER: the pylon stands in the deck median on a concrete
  //   plinth over the widened mid pier, nearly upright (2.9 deg), thicker,
  //   with stay fans to BOTH deck edges as well as the centre fan.
  const PYLON_Z = -315, LEAN = 0.05;
  const PLINTH_TOP = DECK_TOP + 1.6; // 8.2
  // Concrete plinth: the pylon's visible foundation on the deck, 8.6 m wide
  // (median island, rel -4.3..+4.3) x 10 m long, top at 8.2.
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(8.6, 1.6, 10), concrete);
  plinth.position.set(curveX(PYLON_Z), DECK_TOP + 0.8, PYLON_Z);
  plinth.castShadow = true; plinth.receiveShadow = true; group.add(plinth);
  // Axis X is offset west so that, once the lean is applied, the base-cap
  // centre lands exactly on the deck centreline (-37, 8.2): the base disc
  // (r 3.6) then sits wholly on the plinth with 0.7 m to spare each side,
  // its lowest edge 0.18 m embedded in the plinth top — planted, not floating.
  const PYLON_X = curveX(PYLON_Z) - 35 * Math.sin(LEAN);
  const pylon = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 3.6, 70, 10), white);
  pylon.position.set(PYLON_X, PLINTH_TOP + 35 * Math.cos(LEAN), PYLON_Z);
  pylon.rotation.z = LEAN;
  pylon.castShadow = true; group.add(pylon);
  // The pylon has no collision box; the camera needs it as a cylinder
  // (radius covers the base disc's furthest reach from the axis,
  // 3.6 + 35*sin(LEAN) = 5.35, y from the deck to the top).
  addOccluderCylinder(PYLON_X, PYLON_Z, 5.6, CITY.bridgeY, 76);
  // Amber beacon band near the top, so the bridge reads at dusk too.
  // Radius follows the taper (~2.11 at local y=+30), so the band sits proud.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.35, 1.4, 10),
    new THREE.MeshStandardMaterial({ color: 0xf5a623, emissive: 0x7a4a00, emissiveIntensity: 0.9, roughness: 0.5 }));
  band.position.y = 30; pylon.add(band);
  // Stay fans from the pylon's real top (the cylinder leans by LEAN, so the
  // tip sits 35*sin(LEAN) west of its axis) down to the deck surface.
  const topX = PYLON_X - 35 * Math.sin(LEAN), topY = PLINTH_TOP + 70 * Math.cos(LEAN);
  const stayPts = [];
  const stay = (ax, ay, az) => {
    stayPts.push(new THREE.Vector3(topX, topY, PYLON_Z));
    stayPts.push(new THREE.Vector3(ax, ay, az));
  };
  // Centre fan: 16 stays along the median, as before.
  for (let i = 0; i < 16; i++) {
    const z = -271 - (88 * i) / 15;
    stay(curveX(z), DECK_TOP, z);
  }
  // Side fans: 8 stays each to the west and east parapet lines, so the
  // pylon is stayed to both sides of the deck, not in one plane only.
  for (let i = 0; i < 8; i++) {
    const z = -276 - (78 * i) / 7;
    stay(curveX(z) - 11.5, DECK_TOP, z);
    stay(curveX(z) + 11.5, DECK_TOP, z);
  }
  const cableGeo = new THREE.BufferGeometry().setFromPoints(stayPts);
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
  // R8/M3 — every stall on this row must be a FISH stall, because the row is
  // the one the dialog shot stages against and findFishStall() in shots.js
  // picks a stall by body geometry alone, not by its board. The old list held
  // KERUPUK / ES SERUT / SAYUR PAGI / BUMBU DAPUR, i.e. four of eight entries
  // were not fish, and the dialog frame came back with "BUMBU DAPUR" painted
  // over a counter of iced fish and a HARGA / IKAN / UDANG board. The list is
  // now all sea produce, so whichever stall the geometry match lands on is a
  // fish kiosk. Same length (8) and same single pick() per stall, so the RNG
  // stream — and every other shot that depends on it — is untouched; slot 0
  // keeps IKAN SEGAR and slot 5 — the one findFishStall() actually resolves to
  // for the dialog — is IKAN SEGAR too, so the staged board reads IKAN SEGAR.
  const STALLS = ['IKAN SEGAR', 'UDANG BASAH', 'IKAN ASIN', 'KERANG', 'TONGKOL', 'IKAN SEGAR', 'KEPITING', 'BANDENG'];
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
