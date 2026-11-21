// Sun, sky and fog across the 32-minute day. Midday is the signature look:
// pale cyan sky, hard black shadows, bleached pastel facades.
import * as THREE from 'three';
import { clamp, lerp } from '../random.js';

// Keyframes: hour -> sky, fog, sun colour/intensity, hemisphere intensity.
// Sorted ascending; the night wraps past midnight via the +24 entries
// (26:00 = 02:00, 29:30 = 05:30), so 22:00–05:30 stays night instead of
// rendering dawn colours. (The old list was unsorted — hour 2 sat after
// hour 22 — so every night hour interpolated toward the dawn stop.)
const STOPS = [
  { h: 2, sky: 0x141828, fog: 0x101420, sun: 0x7080b0, sunI: 0.2, hemi: 0.22 },
  { h: 5.5, sky: 0xd8c9a8, fog: 0xcfc4ae, sun: 0xffd9a0, sunI: 1.3, hemi: 0.75 },
  { h: 8, sky: 0xbfe0ea, fog: 0xc4d8de, sun: 0xfff0c8, sunI: 1.6, hemi: 0.85 },
  { h: 11.66, sky: 0x9fd8e8, fog: 0xaed4de, sun: 0xfff3d6, sunI: 2.6, hemi: 0.9 },
  { h: 15, sky: 0xa8d0dc, fog: 0xb2c8cc, sun: 0xffe8b0, sunI: 2.2, hemi: 0.8 },
  { h: 18, sky: 0xc9a8a0, fog: 0xbfa8a0, sun: 0xffc890, sunI: 1.4, hemi: 0.6 },
  { h: 19.2, sky: 0x4a4a72, fog: 0x3a3a58, sun: 0x8090c0, sunI: 0.5, hemi: 0.35 },
  { h: 22, sky: 0x1c2238, fog: 0x141828, sun: 0x7080b0, sunI: 0.25, hemi: 0.25 },
  { h: 26, sky: 0x141828, fog: 0x101420, sun: 0x7080b0, sunI: 0.2, hemi: 0.22 },
  { h: 29.5, sky: 0xd8c9a8, fog: 0xcfc4ae, sun: 0xffd9a0, sunI: 1.3, hemi: 0.75 },
];
const cA = new THREE.Color(), cB = new THREE.Color();
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
  sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
  sun.shadow.camera.far = 600;
  const hemi = new THREE.HemisphereLight(0xbfd8e8, 0x8a7a5a, 0.9);
  scene.add(sun, hemi);
  scene.fog = new THREE.Fog(0xaed4de, 300, 1400);
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
  const fogC = new THREE.Color(a.fog).lerp(new THREE.Color(b.fog), t);
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
  scene.fog.far = rain > 0 ? 500 : 1400;
  // Sun position: east at dawn, overhead at noon, west at dusk. The shadow
  // camera only covers ±160 m, so it follows the player (focus) — otherwise
  // shadows vanish everywhere except the city centre. At night the sun
  // stays above the horizon instead of shining up from below.
  const fx = focus ? focus.x : 0, fz = focus ? focus.z : 0;
  const ang = ((hour - 6) / 12) * Math.PI;
  L.sun.position.set(fx + Math.cos(ang) * 300, Math.max(60, Math.sin(ang) * 300 + 40), fz + 120);
  L.sun.target.position.set(fx, 0, fz);
  L.sun.target.updateMatrixWorld();
  cA.setHex(a.sun); cB.setHex(b.sun); cA.lerp(cB, t);
  L.sun.color.copy(cA);
  L.sun.intensity = lerp(a.sunI, b.sunI, t) * (rain > 0 ? 0.45 : 1);
  L.hemi.intensity = lerp(a.hemi, b.hemi, t) * (rain > 0 ? 0.7 : 1);
  // Street lamps glow after dusk.
  const night = hour >= 18.5 || hour < 5.5;
  for (const m of lampMats) m.emissive.setHex(night ? 0xffc860 : 0x000000);
  return { night };
}
