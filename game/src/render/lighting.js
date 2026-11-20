// Sun, sky and fog across the 32-minute day. Midday is the signature look:
// pale cyan sky, hard black shadows, bleached pastel facades.
import * as THREE from 'three';
import { clamp, lerp } from '../random.js';

// Keyframes: hour -> sky, fog, sun colour/intensity, hemisphere intensity.
// Sorted ascending; the night wraps past midnight via the +24 entries
// (26:00 = 02:00, 29:30 = 05:30), so 22:00–05:30 stays night instead of
// rendering dawn colours. (The old list was unsorted — hour 2 sat after
// hour 22 — so every night hour interpolated toward the dawn stop.)
// The sky/fog hues are the art direction and stay put; only the midday
// sun/hemisphere intensities are nudged so 11:00–15:00 reads hotter.
const STOPS = [
  { h: 2, sky: 0x141828, fog: 0x101420, sun: 0x7080b0, sunI: 0.2, hemi: 0.22 },
  { h: 5.5, sky: 0xd8c9a8, fog: 0xcfc4ae, sun: 0xffd9a0, sunI: 1.3, hemi: 0.75 },
  { h: 8, sky: 0xbfe0ea, fog: 0xc4d8de, sun: 0xfff0c8, sunI: 1.62, hemi: 0.84 },
  { h: 11.66, sky: 0x9fd8e8, fog: 0xaed4de, sun: 0xfff3d6, sunI: 2.72, hemi: 0.84 },
  { h: 15, sky: 0xa8d0dc, fog: 0xb2c8cc, sun: 0xffe8b0, sunI: 2.28, hemi: 0.78 },
  { h: 18, sky: 0xc9a8a0, fog: 0xbfa8a0, sun: 0xffc890, sunI: 1.4, hemi: 0.6 },
  { h: 19.2, sky: 0x4a4a72, fog: 0x3a3a58, sun: 0x8090c0, sunI: 0.5, hemi: 0.35 },
  { h: 22, sky: 0x1c2238, fog: 0x141828, sun: 0x7080b0, sunI: 0.25, hemi: 0.25 },
  { h: 26, sky: 0x141828, fog: 0x101420, sun: 0x7080b0, sunI: 0.2, hemi: 0.22 },
  { h: 29.5, sky: 0xd8c9a8, fog: 0xcfc4ae, sun: 0xffd9a0, sunI: 1.3, hemi: 0.75 },
];

// Shadow frustum: 150 m half-extent over 2048 texels ≈ 0.15 m/texel, so
// building/car edges stay crisp right around the player while roughly one
// city block of casters still fits. near/far bracket the sun's orbit
// (60–360 m out) plus the tallest facades, which keeps depth precision high
// enough that the depth bias can stay small (no peter-panning).
const SHADOW_HALF = 150;
const SHADOW_NEAR = 20;
const SHADOW_FAR = 620;

const cA = new THREE.Color(), cB = new THREE.Color();
const cFog = new THREE.Color();
const cHemiSky = new THREE.Color(), cHemiGround = new THREE.Color();
const HEMI_SKY_BASE = 0xbfd8e8, HEMI_GROUND_BASE = 0x8a7a5a;
const HEMI_SKY_NOON = 0x84c0e6;   // cooler blue fill in the shade
const HEMI_GROUND_NOON = 0xb08a56; // warm bounce off bleached pavement

// Scratch vectors for the light-space texel snap (no per-frame allocation).
const vOff = new THREE.Vector3(), vDir = new THREE.Vector3();
const vRight = new THREE.Vector3(), vUp = new THREE.Vector3();
const vSnap = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function stopAt(hour) {
  const h = hour < 2 ? hour + 24 : hour;
  let i = 0;
  while (i < STOPS.length - 2 && STOPS[i + 1].h <= h) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  const t = clamp((h - a.h) / (b.h - a.h || 1), 0, 1);
  return { a, b, t };
}
export function buildLighting(scene) {
  const sun = new THREE.DirectionalLight(0xfff3d6, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -SHADOW_HALF;
  sun.shadow.camera.right = SHADOW_HALF;
  sun.shadow.camera.top = SHADOW_HALF;
  sun.shadow.camera.bottom = -SHADOW_HALF;
  sun.shadow.camera.near = SHADOW_NEAR;
  sun.shadow.camera.far = SHADOW_FAR;
  sun.shadow.camera.updateProjectionMatrix();
  // Bias pair: a tiny negative depth bias alone leaves acne on angled
  // facades and roofs, so normalBias (≈1/3 texel) does the heavy lifting
  // along the surface normal — acne gone, shadows still meet the wall at
  // the base (no floating cars).
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 1;
  const hemi = new THREE.HemisphereLight(HEMI_SKY_BASE, HEMI_GROUND_BASE, 0.9);
  scene.add(sun, hemi);
  // Haze ladder: 0–300 m clear, 300–900 m whitens (bridge stays a dark
  // silhouette), 900 m+ hills fade out before the 1200 m wall.
  scene.fog = new THREE.Fog(0xaed4de, 300, 1200);
  // Gradient sky (zenith -> horizon haze) instead of a flat colour: the
  // same canvas is repainted only when the hour moves, so it costs nothing
  // per frame.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  return { sun, hemi, lampMats: [], skyCanvas, skyTex, lastGradHour: -99 };
}
export function updateLighting(L, hour, rain, lampMats, focus) {
  const { a, b, t } = stopAt(hour);
  cA.setHex(a.sky); cB.setHex(b.sky); cA.lerp(cB, t);
  cFog.setHex(a.fog).lerp(cB.setHex(b.fog), t);
  const fogC = cFog;
  const scene = L.sun.parent;
  // Repaint the sky gradient when the hour has moved (cheap, throttled).
  // The zenith is a deepened sky colour so the gradient reads as a real
  // sky (at dawn the raw sky/fog colours are nearly identical and the
  // frame turns into a flat beige wash).
  if (Math.abs(hour - L.lastGradHour) > 0.05) {
    L.lastGradHour = hour;
    const g2 = L.skyCanvas.getContext('2d');
    const grad = g2.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#' + cA.clone().multiplyScalar(0.55).getHexString());
    grad.addColorStop(0.62, '#' + cA.getHexString());
    grad.addColorStop(1, '#' + fogC.getHexString());
    g2.fillStyle = grad; g2.fillRect(0, 0, 4, 256);
    L.skyTex.needsUpdate = true;
  }
  scene.fog.color.copy(fogC);
  scene.fog.near = rain > 0 ? 60 : 300;
  scene.fog.far = rain > 0 ? 470 : 1200;
  // Sun position: east at dawn, overhead at noon, west at dusk. The shadow
  // camera only covers ±150 m, so it follows the player (focus) — otherwise
  // shadows vanish everywhere except the city centre. At night the sun
  // stays above the horizon instead of shining up from below.
  const fx = focus ? focus.x : 0, fz = focus ? focus.z : 0;
  const ang = ((hour - 6) / 12) * Math.PI;
  const elev = Math.max(60, Math.sin(ang) * 300 + 40);
  vOff.set(Math.cos(ang) * 300, elev, 120);
  const dist = vOff.length();
  vDir.copy(vOff).divideScalar(dist);
  // Snap the frustum centre to whole shadow texels measured in light space:
  // otherwise the map slides a fraction of a texel every frame as the player
  // moves and every PCF edge crawls ("berkedip"). Snapping keeps the texel
  // grid locked so shadows are rock steady, at the cost of a ≤1 texel lag.
  vRight.crossVectors(vDir, WORLD_UP).normalize();
  vUp.crossVectors(vRight, vDir).normalize();
  const texel = (SHADOW_HALF * 2) / L.sun.shadow.mapSize.x;
  vSnap.set(fx, 0, fz);
  const sr = Math.round(vSnap.dot(vRight) / texel) * texel;
  const su = Math.round(vSnap.dot(vUp) / texel) * texel;
  const sf = vSnap.dot(vDir);
  vSnap.set(0, 0, 0)
    .addScaledVector(vRight, sr)
    .addScaledVector(vUp, su)
    .addScaledVector(vDir, sf);
  L.sun.target.position.copy(vSnap);
  L.sun.position.copy(vSnap).addScaledVector(vDir, dist);
  L.sun.target.updateMatrixWorld();
  cA.setHex(a.sun); cB.setHex(b.sun); cA.lerp(cB, t);
  L.sun.color.copy(cA);
  // "Terik" factor: 0 at night/dawn, ~1 when the sun is high (11:00–15:00).
  // Pushing sun up and the sky fill down deepens the shadows toward the
  // design's near-black midday shade without darkening the whole frame.
  const harsh = clamp((elev - 230) / 110, 0, 1);
  L.sun.intensity = lerp(a.sunI, b.sunI, t) * (1 + 0.07 * harsh) * (rain > 0 ? 0.45 : 1);
  // Hemisphere: blue from above (cool shade), warm bounce from below.
  cHemiSky.setHex(HEMI_SKY_BASE).lerp(cB.setHex(HEMI_SKY_NOON), harsh * 0.8);
  cHemiGround.setHex(HEMI_GROUND_BASE).lerp(cB.setHex(HEMI_GROUND_NOON), harsh * 0.8);
  L.hemi.color.copy(cHemiSky);
  L.hemi.groundColor.copy(cHemiGround);
  L.hemi.intensity = lerp(a.hemi, b.hemi, t) * (1 - 0.17 * harsh) * (rain > 0 ? 0.7 : 1);
  // Street lamps glow after dusk.
  const night = hour >= 18.5 || hour < 5.5;
  for (const m of lampMats) m.emissive.setHex(night ? 0xffc860 : 0x000000);
  return { night };
}
