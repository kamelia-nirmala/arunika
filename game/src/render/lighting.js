// Sun, sky and fog across the 32-minute day. Midday is the signature look:
// pale cyan sky, hard black shadows, bleached pastel facades. Golden hour
// (16:00–18:30) is the second look: an orange horizon under a blue zenith,
// a low sun that rakes 3–5x object height across the road, and street lamps
// already lit while the sky is still warm.
import * as THREE from 'three';
import { clamp, lerp } from '../random.js';

// Keyframes: hour -> sky, fog, sun colour/intensity, hemisphere intensity.
// Golden-hour stops (16–18.5) carry a `zen` field: the zenith stays blue
// while the horizon goes orange, so the sky reads as a real sunset gradient
// instead of a flat warm wash. Stops without `zen` keep the old behaviour
// (zenith = sky darkened 0.55x).
const STOPS = [
  { h: 2, sky: 0x141828, fog: 0x101420, sun: 0x7080b0, sunI: 0.2, hemi: 0.22 },
  { h: 5.5, sky: 0xd8c9a8, fog: 0xcfc4ae, sun: 0xffd9a0, sunI: 1.3, hemi: 0.75 },
  { h: 8, sky: 0xbfe0ea, fog: 0xc4d8de, sun: 0xfff0c8, sunI: 1.6, hemi: 0.85 },
  { h: 11.66, sky: 0x9fd8e8, fog: 0xaed4de, sun: 0xfff3d6, sunI: 2.6, hemi: 0.9 },
  { h: 15, sky: 0xa8d0dc, fog: 0xb2c8cc, sun: 0xffe8b0, sunI: 2.2, hemi: 0.8 },
  { h: 16, sky: 0xeec088, fog: 0xe8c098, sun: 0xffb060, sunI: 2.1, hemi: 0.85, zen: 0x7a9cc0 },
  { h: 17, sky: 0xf0a060, fog: 0xe8a878, sun: 0xff9a40, sunI: 2.0, hemi: 0.8, zen: 0x5a7fb0 },
  { h: 17.8, sky: 0xe07a45, fog: 0xd08a60, sun: 0xff8030, sunI: 1.6, hemi: 0.65, zen: 0x4a6a9a },
  { h: 18.5, sky: 0x8a5a72, fog: 0x6a4a60, sun: 0xff7040, sunI: 0.8, hemi: 0.4, zen: 0x3a4a72 },
  { h: 19.2, sky: 0x4a4a72, fog: 0x3a3a58, sun: 0x8090c0, sunI: 0.5, hemi: 0.35 },
  { h: 22, sky: 0x1c2238, fog: 0x141828, sun: 0x7080b0, sunI: 0.25, hemi: 0.25 },
  { h: 26, sky: 0x141828, fog: 0x101420, sun: 0x7080b0, sunI: 0.2, hemi: 0.22 },
  { h: 29.5, sky: 0xd8c9a8, fog: 0xcfc4ae, sun: 0xffd9a0, sunI: 1.3, hemi: 0.75 },
];
// Night on/off thresholds, and the hour the lamps strike up: 16:45, i.e.
// while the sky above the horizon is still orange and the heads read as lit
// rather than grey.
const NIGHT_HOUR = 18.5;
const DAWN_HOUR = 5.5;
const LAMPS_HOUR = 16.75;
const cA = new THREE.Color(), cB = new THREE.Color(), cZ = new THREE.Color();

function stopAt(hour) {
  const h = hour < 2 ? hour + 24 : hour;
  let i = 0;
  while (i < STOPS.length - 2 && STOPS[i + 1].h <= h) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  const t = clamp((h - a.h) / (b.h - a.h || 1), 0, 1);
  return { a, b, t };
}

export function buildLighting(scene) {
  // One shadow-casting sun (2048 map over ±160 m, follows the player) plus a
  // sky/ground hemisphere fill. Nothing else: lamps, neons and lit windows
  // are emissive materials driven below, so the light count never grows.
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
  // `lampMats` is filled by the city: street-lamp heads, lit-window facade
  // materials and any other emissive surface that should switch on at dusk.
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
    // Zenith: golden-hour stops carry their own blue zenith, so the gradient
    // runs blue (top) -> warm sky -> orange haze (horizon). Other stops keep
    // the old darkened-sky zenith.
    let zenHex;
    if (a.zen !== undefined || b.zen !== undefined) {
      cZ.setHex(a.zen !== undefined ? a.zen : a.sky);
      cB.setHex(b.zen !== undefined ? b.zen : b.sky);
      cZ.lerp(cB, t);
      zenHex = '#' + cZ.getHexString();
    } else {
      zenHex = '#' + cA.clone().multiplyScalar(0.55).getHexString();
    }
    grad.addColorStop(0, zenHex);
    grad.addColorStop(0.55, '#' + cA.getHexString());
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
  // stays above the horizon instead of shining up from below. The low
  // golden-hour arc (260 scale, +25 lift, 35 floor) keeps the sun ~12–16°
  // up at 17:00–17:45, so shadows run 3–5x object height.
  const fx = focus ? focus.x : 0, fz = focus ? focus.z : 0;
  const ang = ((hour - 6) / 12) * Math.PI;
  L.sun.position.set(fx + Math.cos(ang) * 300, Math.max(35, Math.sin(ang) * 260 + 25), fz + 120);
  L.sun.target.position.set(fx, 0, fz);
  L.sun.target.updateMatrixWorld();
  cA.setHex(a.sun); cB.setHex(b.sun); cA.lerp(cB, t);
  L.sun.color.copy(cA);
  L.sun.intensity = lerp(a.sunI, b.sunI, t) * (rain > 0 ? 0.45 : 1);
  L.hemi.intensity = lerp(a.hemi, b.hemi, t) * (rain > 0 ? 0.7 : 1);
  // Street lamps glow from golden hour (16:45) on, brighter while the sky
  // is still warm so the heads read as lit, not grey. No new lights: the
  // same shared emissive materials are simply switched on here — lamp heads
  // and, since R6, the lit-window facade materials the city registers.
  const night = hour >= NIGHT_HOUR || hour < DAWN_HOUR;
  const lampsOn = hour >= LAMPS_HOUR || hour < DAWN_HOUR;
  for (const m of lampMats) {
    // Facade materials (emissive-mapped windows) ride at a fraction of a lamp
    // head's strength so rooms read warm instead of glowing white.
    const scale = m.userData && m.userData.lampScale ? m.userData.lampScale : 1;
    m.emissive.setHex(lampsOn ? 0xffc860 : 0x000000);
    m.emissiveIntensity = lampsOn ? (night ? 1.4 : 3.0) * scale : 0;
  }
  return { night };
}
