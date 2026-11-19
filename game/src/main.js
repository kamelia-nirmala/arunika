// ARUNIKA — boot, fixed-step loop, and the glue between every system.
// Entry point: game/index.html loads this module. Shot mode (?shot=cover|
// street|dialog|vista&seed=1) stages a deterministic scene, steps it, and
// renders one frame for the screenshot pipeline.
import * as THREE from 'three';
import { DAY } from './config.js';
import { makeRng, clamp, lerp } from './random.js';
import { input, bindInput } from './input.js';
import { buildRoads } from './world/roads.js';
import { buildWater, updateWater } from './world/water.js';
import { buildCity } from './world/city.js';
import { buildProps } from './world/props.js';
import { createVehicle, carCollide } from './physics/vehicle.js';
import { createPlayer, stepPlayer, cameraFor } from './player/controller.js';
import { createWeapons, fire, updateWeapons, switchWeapon, startReload } from './player/weapons.js';
import { createTraffic, updateTraffic } from './world/traffic.js';
import { createPeds, updatePeds, panicPeds } from './ai/pedestrians.js';
import { createPolice, updatePolice } from './ai/police.js';
import { createGangs, updateGangs, spawnGang } from './ai/gangs.js';
import { createBoats, updateBoats } from './ai/boats.js';
import { createTide, updateTide, tideRising } from './systems/tide.js';
import { createEconomy } from './systems/economy.js';
import { createWanted, addHeat, updateWanted, tryPayoff } from './systems/wanted.js';
import { createMissions, startMission, updateMissions, missionMarker } from './missions/objectives.js';
import { JOBS } from './missions/jobs.js';
import { bindDialogue, showDialog, advance as advanceDialog, isDialogOpen } from './missions/dialogue.js';
import { buildLighting, updateLighting } from './render/lighting.js';
import { buildEffects } from './render/effects.js';
import { bindHud, updateHud, toast } from './ui/hud.js';
import { drawMinimap } from './ui/minimap.js';
import { bindMenus, showTitle, pauseGame, resumeGame, gameOver } from './ui/menus.js';
import { createAudio } from './audio/engine.js';
import { createRadio, radioTick, nextStation } from './audio/radio.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || null;
const SEED = Number(params.get('seed') || 1);
const STEP = 1 / 60;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd8e8);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 3000);
camera.position.set(0, 40, 120);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
window.addEventListener('error', (e) => { window.__ARUNIKA_ERROR__ = String(e.message); });

const rng = makeRng(SEED);
const roads = buildRoads();
const water = buildWater(scene);
const city = buildCity(scene, rng);
buildProps(scene, rng);
const lighting = buildLighting(scene);
lighting.lampMats = city.lamps;
const fx = buildEffects(scene);

const g = {
  scene, camera, roads, rng, seed: SEED,
  state: SHOT ? 'shot' : 'title',
  hour: DAY.start, rain: 0, fps: 0, time: 0,
  cars: [], camOverride: null, radioName: 'OMBAK FM 88.4',
  tideRising: true,
};
g.tide = createTide();
g.economy = createEconomy();
g.wanted = createWanted();
g.missions = createMissions(scene);
g.police = createPolice(scene);
g.gangs = createGangs(scene);
g.boats = createBoats(scene);
g.traffic = createTraffic(scene, roads, rng);
g.peds = createPeds(scene, rng);
g.player = createPlayer(scene, -45, 20);
// Spawn facing north, toward the parked sedan: W walks straight to the car.
g.player.heading = Math.PI; g.player.camYaw = Math.PI;
g.weapons = createWeapons();
g.audio = createAudio();
g.radio = createRadio(g.audio);
g.missionMarker = () => missionMarker(g.missions);
g.dialogApi = { showDialog };
g.reset = resetGame;
bindInput(canvas);
bindHud();
bindDialogue(document);
bindMenus(document, g);
showTitle(g);

// The player's own sedan, parked on the boulevard, plus a few parked cars.
function parkCar(kind, x, z, heading, color) {
  const v = createVehicle(kind, x, z, heading, color);
  scene.add(v.mesh.group);
  g.cars.push(v);
  return v;
}
parkCar('sedan', -45, 12, Math.PI, 0x2fd3c4);
parkCar('compact', 45, -60, 0, 0xc8c8c8);
parkCar('compact', -135, 80, Math.PI / 2, 0x8a2f2f);
parkCar('truck', 135, -140, 0, 0x7a6a4a);
parkCar('sedan', -225, 30, Math.PI, 0x2a4d6e);

let camState = { pos: new THREE.Vector3(0, 40, 120), look: new THREE.Vector3(0, 0, 0), fov: 60 };
let lastDamageT = -99, shakeT = 0, mapT = 0, hudT = 0, sirenOn = false;

function resetGame() {
  for (const c of [...g.traffic.cars]) scene.remove(c.v.mesh.group);
  for (const p of [...g.peds.list]) scene.remove(p.mesh.group);
  for (const u of [...g.police.cars]) scene.remove(u.v.mesh.group);
  for (const gg of [...g.gangs.list]) scene.remove(gg.mesh);
  g.traffic.cars.length = 0; g.peds.list.length = 0;
  g.police.cars.length = 0; g.gangs.list.length = 0;
  g.player.pos.set(-45, 0, 20); g.player.heading = Math.PI; g.player.camYaw = Math.PI;
  g.player.health = 100; g.player.armor = 0; g.player.mode = 'foot'; g.player.car = null;
  g.economy.money = 0; g.wanted.heat = 0; g.wanted.stars = 0;
  g.missions.job = null; g.missions.obj = 0; g.missions.done = []; g.missions.available = 1;
  g.hour = DAY.start; g.tide.elapsed = 0;
}

function damagePlayer(n) {
  g.player.health -= n;
  lastDamageT = g.time;
  shakeT = 0.3;
  if (g.player.health <= 0) { g.player.health = 0; gameOver(g); }
}
function step(dt) {
  g.time += dt;
  // Day clock + rain schedule (drizzle 13:00, heavy 17:30, storm 03:00).
  // In shot mode the staged rain stays: the schedule only runs in live play.
  if (g.state === 'play') {
    g.hour += (dt / DAY.seconds) * 24;
    if (g.hour >= 24) g.hour -= 24;
    const h = g.hour;
    g.rain = (h >= 13 && h < 13.33) ? 0.4 : (h >= 17.5 && h < 17.6) ? 1 : (h >= 3 && h < 3.25) ? 0.8 : 0;
  }
  updateTide(g.tide, dt);
  g.tideRising = tideRising(g.tide);
  // Dialog open: freeze the world, Space/E/click advances.
  if (isDialogOpen()) {
    if (input.edge('brake') || input.edge('enter')) advanceDialog();
    return;
  }
  if (input.edge('pause')) { g.state === 'play' ? pauseGame(g) : resumeGame(g); return; }
  if (g.state !== 'play' && g.state !== 'shot') return;
  const p = g.player;
  const prevMode = p.mode;
  stepPlayer(p, dt, g.cars, g.tide.t);
  // Carjacked a car with a driver: heat + panicking witnesses.
  if (prevMode === 'jacking' && p.mode === 'driving') {
    addHeat(g.wanted, 8);
    panicPeds(g.peds, p.pos.x, p.pos.z, 35);
  }
  // Player car died: bail out on foot.
  if (p.mode === 'driving' && p.car && p.car.dead) {
    toast('Mobil hancur — cari kendaraan lain');
    p.mode = 'foot'; p.car = null;
  }
  // Player car vs traffic.
  if (p.car) {
    for (const c of g.traffic.cars) {
      if (Math.abs(c.v.pos.x - p.car.pos.x) < 12 && Math.abs(c.v.pos.z - p.car.pos.z) < 12) {
        if (carCollide(p.car, c.v)) { damagePlayer(2); addHeat(g.wanted, 2); }
      }
    }
  }
  // Traffic cars running over the player on foot.
  if (p.mode === 'foot') {
    for (const c of g.traffic.cars) {
      if (Math.hypot(c.v.pos.x - p.pos.x, c.v.pos.z - p.pos.z) < 2.2) {
        damagePlayer(20); addHeat(g.wanted, 12);
        panicPeds(g.peds, p.pos.x, p.pos.z, 25);
        p.pos.x += (p.pos.x - c.v.pos.x) * 0.5; p.pos.z += (p.pos.z - c.v.pos.z) * 0.5;
      }
    }
  }
  sirenOn = g.wanted.stars >= 2;
  updateTraffic(g.traffic, dt, p, sirenOn);
  updatePeds(g.peds, dt, p);
  const policeNear = g.police.cars.some((u) => Math.hypot(u.v.pos.x - p.pos.x, u.v.pos.z - p.pos.z) < 60);
  if (updatePolice(g.police, dt, p, g.wanted.stars, g.time)) damagePlayer(18);
  updateWanted(g.wanted, dt, policeNear);
  updateGangs(g.gangs, dt, p, (x, y, z) => fx.muzzle(x, y, z));
  updateBoats(g.boats, dt, g.tide.t, p, (n) => addHeat(g.wanted, n));
  // Missions.
  const ev = updateMissions(g.missions, dt, g, g.time);
  if (ev) {
    if (ev.event === 'complete') { toast(`MISI SELESAI — ${ev.title} · +Rp ${ev.reward.toLocaleString('id-ID')}`); g.audio.blip(990); }
    else if (ev.event === 'failed') { toast(`MISI GAGAL — ${ev.title}: ${ev.reason}`); g.audio.blip(220); }
    else toast(ev.text);
  }
  // Mission keys: J starts the next job (tide-gated jobs need the right tide).
  if (input.edge('mission') && !g.missions.job && g.missions.available <= 9) {
    const job = JOBS[g.missions.available - 1];
    if (job.tideGate === 'high' && g.tide.t < 0.75) toast('Misi ini hanya bisa dimulai saat PASANG');
    else if (job.tideGate === 'low' && g.tide.t > 0.35) toast('Misi ini hanya bisa dimulai saat SURUT');
    else {
      startMission(g.missions, job.id, () => {
        if (job.id === 6) spawnGang(g.gangs, 60, -405, 5);
      });
    }
  }
  // Pay off wanted at the Waringin Tepi hideout (E, on foot, no car near).
  if (p.mode === 'foot' && input.edge('enter')) {
    const d = Math.hypot(p.pos.x + 270, p.pos.z - 0);
    if (d < 12 && g.wanted.stars > 0) {
      const r = tryPayoff(g.wanted, g.economy.money, policeNear);
      if (r.ok) { g.economy.money -= r.cost; toast(`Suap dibayar — Rp ${r.cost.toLocaleString('id-ID')}. Buruan hilang.`); }
      else toast('Tidak cukup uang atau polisi terlalu dekat');
    }
  }
  // Weapons.
  updateWeapons(g.weapons, dt, p);
  if (input.edge('weapon')) switchWeapon(g.weapons, p);
  if (input.edge('reload')) startReload(g.weapons, p);
  if (input.edge('radio')) { g.radioName = nextStation(g.radio); toast(g.radioName); }
  if (input.edge('map')) {
    const cv = document.getElementById('minimap-canvas');
    const big = cv.style.width === '480px';
    cv.style.width = big ? '190px' : '480px';
    cv.style.height = big ? '190px' : '480px';
  }
  if (p.mode === 'foot' && input.held('fire')) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const res = fire(g.weapons, p, { x: dir.x, z: dir.z }, g.gangs, g.police, (x, y, z) => fx.muzzle(x, y, z));
    if (res === 'shot' || res === 'hit') {
      g.audio.shot();
      addHeat(g.wanted, 10);
      panicPeds(g.peds, p.pos.x, p.pos.z, 25);
      shakeT = 0.12;
    } else if (res === 'kill') {
      const o = g.missions.job ? g.missions.job.objectives[g.missions.obj] : null;
      if (o && o.kind === 'kill') g.missions.kills++;
      addHeat(g.wanted, 25);
      panicPeds(g.peds, p.pos.x, p.pos.z, 35);
      shakeT = 0.2;
    } else if (res === 'dry') g.audio.blip(180);
  }
  // Health regen after 6 s without damage.
  if (g.time - lastDamageT > 6 && p.health > 0 && p.health < 100) {
    p.health = Math.min(100, p.health + 8 * dt);
  }
  // Drift smoke + skid marks from the player's car.
  if (p.car) {
    if (p.car.smoke) {
      fx.puff(p.car.pos.x - Math.sin(p.car.heading) * 2, 0.4, p.car.pos.z - Math.cos(p.car.heading) * 2, 1.6);
      if (Math.random() < 0.3) fx.skid(p.car.pos.x, 0.05, p.car.pos.z, p.car.heading);
    }
    if (p.car.damage >= 60) fx.puff(p.car.pos.x, 1.2, p.car.pos.z, 2.2);
  }
  updateWater(water, g.tide.t);
  updateLighting(lighting, g.hour, g.rain, lighting.lampMats);
  fx.update(dt, camera.position, g.rain > 0);
  // Audio.
  g.audio.setEngine(p.car ? p.car.rpm : 0, !!p.car);
  g.audio.setSkid(p.car && p.car.smoke ? 1 : 0);
  g.audio.setSiren(sirenOn ? clamp(1 - Math.hypot(p.pos.x, p.pos.z) / 400, 0, 1) : 0);
  if (g.audio.ctx && g.radio.on) radioTick(g.radio, g.audio.ctx, g.audio.master, g.audio.ctx.currentTime);
  // HUD + minimap (throttled).
  hudT += dt;
  if (hudT > 0.1) { hudT = 0; updateHud(g, dt); }
  mapT += dt;
  if (mapT > 0.15) { mapT = 0; drawMinimap(document.getElementById('minimap-canvas'), g); }
}

let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0;
// Adaptive quality: on a weak machine (sustained < 25 fps) step the shadow
// map and pixel ratio down — the game stays playable instead of stalling.
let qual = 0, lowT = 0;
function adaptQuality(dt) {
  if (g.fps > 0 && g.fps < 25) {
    lowT += dt;
    if (lowT > 3 && qual === 0) {
      qual = 1; lowT = 0;
      renderer.setPixelRatio(1);
      lighting.sun.shadow.mapSize.set(1024, 1024);
      if (lighting.sun.shadow.map) { lighting.sun.shadow.map.dispose(); lighting.sun.shadow.map = null; }
    } else if (lowT > 3 && qual === 1) {
      qual = 2; lowT = 0;
      renderer.setPixelRatio(0.75);
      lighting.sun.shadow.mapSize.set(512, 512);
      if (lighting.sun.shadow.map) { lighting.sun.shadow.map.dispose(); lighting.sun.shadow.map = null; }
    }
  } else lowT = 0;
}
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { g.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  adaptQuality(dt);
  if (g.state === 'title') {
    // Attract mode: slow orbit over the city.
    const t = now * 0.00004;
    camera.position.set(Math.sin(t) * 260, 90, Math.cos(t) * 260 - 60);
    camera.lookAt(0, 0, -60);
    updateLighting(lighting, g.hour, 0, lighting.lampMats);
    updateWater(water, g.tide.t);
    renderer.render(scene, camera);
    return;
  }
  if (g.state === 'shot') return; // staged separately below
  if (g.state === 'pause' || g.state === 'over') {
    if (g.state === 'pause' && input.edge('pause')) resumeGame(g);
    renderer.render(scene, camera);
    return;
  }
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) { step(STEP); acc -= STEP; n++; }
  // Camera.
  if (g.camOverride) {
    camera.position.set(g.camOverride.pos.x, g.camOverride.pos.y, g.camOverride.pos.z);
    camera.lookAt(g.camOverride.look.x, g.camOverride.look.y, g.camOverride.look.z);
    camera.fov = g.camOverride.fov;
  } else {
    cameraFor(g.player, dt, camState);
    camera.position.copy(camState.pos);
    if (shakeT > 0) {
      shakeT -= dt;
      camera.position.x += (Math.random() - 0.5) * 0.3 * shakeT;
      camera.position.y += (Math.random() - 0.5) * 0.3 * shakeT;
    }
    camera.lookAt(camState.look);
    if (Math.abs(camera.fov - camState.fov) > 0.1) {
      camera.fov = lerp(camera.fov, camState.fov, clamp(dt * 3, 0, 1));
    }
  }
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

// Debug hook for automated testing (harmless in play): the live game state.
window.__ARUNIKA_GAME__ = g;
window.__ARUNIKA_MAIN_LOADED__ = true;
if (SHOT) {
  try {
    document.getElementById('title-screen').classList.remove('show');
  const steps = stageShot(SHOT, g);
  for (let i = 0; i < steps; i++) {
    if (SHOT === 'cover' && g.player.car) g.player.car.speed = 21.7;
    step(STEP);
  }
  if (g.camOverride) {
    camera.position.set(g.camOverride.pos.x, g.camOverride.pos.y, g.camOverride.pos.z);
    camera.lookAt(g.camOverride.look.x, g.camOverride.look.y, g.camOverride.look.z);
    camera.fov = g.camOverride.fov;
    camera.updateProjectionMatrix();
  }
  updateHud(g, 0);
  drawMinimap(document.getElementById('minimap-canvas'), g);
  renderer.render(scene, camera);
  window.__ARUNIKA_READY__ = true;
  } catch (err) {
    window.__ARUNIKA_ERROR__ = 'shot: ' + String(err && err.stack || err);
  }
} else {
  requestAnimationFrame(frame);
}
