// ARUNIKA — tuning & constants. All numbers are the game's own design;
// see GAME_DESIGN.md §1–§5 for where each value comes from.
export const PALETTE = {
  navy: 0x0e1a22, cream: 0xede6d6, teal: 0x2fd3c4, amber: 0xf5a623,
  red: 0xe0453a, sky: 0x9fd8e8, sun: 0xfff3d6, asphalt: 0x2e3138,
  sidewalk: 0xb9b3a4, sand: 0xd9c9a3, water: 0x2e7f9e, mud: 0x6b543a,
};
// City: x in [-360, 360], z in [-450, 270]. River band z in [-360, -270] (Sagara
// Hilir sits north of it, z in [-450, -360]); the Sekarwangi bridge crosses at x=-45.
export const CITY = {
  minX: -360, maxX: 360, minZ: -450, maxZ: 270,
  roadGap: 90, roadWidth: 12, riverZ0: -360, riverZ1: -270,
  bridgeX: -45, bridgeY: 6, hillZ0: 120, hillTop: 14,
};
export const DISTRICTS = [
  { name: 'Kemuning Lurus', x0: -180, x1: 90, z0: -270, z1: 90, hMin: 18, hMax: 42,
    colors: [0xf2e3c6, 0xcfe3d8, 0xf6d9c9, 0xe8dcc8, 0xd8e6ee] },
  { name: 'Waringin Tepi', x0: -360, x1: -180, z0: -270, z1: 90, hMin: 4, hMax: 9,
    colors: [0xe8d9b8, 0xd8c9a8, 0xc9b896, 0xf0e2c8, 0xcfd8c2] },
  { name: 'Tunjung Mas', x0: -360, x1: 360, z0: 90, z1: 270, hMin: 6, hMax: 14,
    colors: [0xf5f2ea, 0xece6d8, 0xffffff, 0xf0e8d8, 0xe2e8e2] },
  { name: 'Loji Cempaka', x0: 90, x1: 360, z0: -270, z1: 90, hMin: 6, hMax: 20,
    colors: [0x9e5b45, 0x8a4a38, 0xb0705a, 0x7d7d7d, 0x6b6b6b] },
  { name: 'Sagara Hilir', x0: -360, x1: 360, z0: -450, z1: -360, hMin: 4, hMax: 8,
    colors: [0x8a6b4a, 0x7a5c40, 0x9c7a52, 0x6b4f36, 0xa8895e] },
];
// Vehicle classes: top speed m/s, accel m/s^2, brake m/s^2, mass kg, drift.
export const VEHICLES = {
  compact: { top: 40, accel: 4.2, brake: 9.2, mass: 1100, driftMax: 30, grip: 1.0, len: 3.9, wid: 1.8, color: 0xd8d8d8 },
  sedan: { top: 54, accel: 5.6, brake: 9.9, mass: 1450, driftMax: 26, grip: 1.0, len: 4.7, wid: 1.9, color: 0x2a4d6e },
  truck: { top: 30, accel: 2.2, brake: 5.0, mass: 2600, driftMax: 14, grip: 0.9, len: 6.2, wid: 2.2, color: 0x7a6a4a },
  police: { top: 46, accel: 6.4, brake: 10.5, mass: 1500, driftMax: 22, grip: 1.05, len: 4.7, wid: 1.9, color: 0x1a1a1a },
  heli: { top: 53, accel: 8, brake: 8, mass: 2000, driftMax: 0, grip: 1, len: 7, wid: 2.4, color: 0x223344 },
};
export const WEAPONS = {
  pistol: { name: 'Kobra-9', dmg: 26, rof: 4, mag: 13, reload: 1.8, range: 40, auto: false },
  shotgun: { name: 'Bandot-12', dmg: 88, rof: 1.1, mag: 6, reload: 1.9, range: 20, auto: false },
  smg: { name: 'Tawon-45', dmg: 14, rof: 11, mag: 30, reload: 2.3, range: 35, auto: true },
};
// Wanted: heat thresholds per star; decay needs line-of-sight broken.
export const WANTED = { thresholds: [20, 40, 70, 110, 160], decayPerSec: 1 / 12, losBreak: 6 };
export const TIDE = { period: 480, high: 0.75, low: 0.35 }; // seconds per full cycle
export const DAY = { seconds: 32 * 60, start: 11 + 40 / 60 }; // 32-min day, start 11:40
export const KEYS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  brake: ['Space'], hand: ['ShiftLeft', 'ShiftRight'],
  enter: ['KeyE'], jump: ['KeyF'], sprint: ['ShiftLeft'],
  fire: ['Mouse0'], reload: ['KeyR'], weapon: ['KeyQ'],
  // Right mouse button = aim only (never fires); see input.js held('aim').
  aim: ['Mouse2'],
  radio: ['KeyV'], map: ['KeyM'], pause: ['Escape', 'KeyP'],
  mission: ['KeyJ'], horn: ['KeyH'], mute: ['KeyN'],
};
