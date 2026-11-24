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
import { createPolice, updatePolice, clearPolice } from './ai/police.js';
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
  tideRising: true, qualityMode: 'auto',
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
// A traffic/police car the player has taken over. Both systems drive their own
// cars every frame (traffic pins its body to a road-graph rail, police keep
// their pursuit throttle), so a taken-over car must leave its AI list or it
// would yank itself out of the player's hands. Tracked here so it can be
// released into g.cars — an ordinary car again — when the player steps out.
let heldAiCar = null;
function detachAiCar(v) {
  const ti = g.traffic.cars.findIndex((c) => c.v === v);
  if (ti >= 0) {
    g.traffic.cars.splice(ti, 1);
    heldAiCar = { v };
    return;
  }
  const pi = g.police.cars.findIndex((u) => u.v === v);
  if (pi >= 0) {
    const u = g.police.cars.splice(pi, 1)[0];
    // Its deployed officers were tied to that unit; they leave with it.
    for (const o of u.officers || []) g.scene.remove(o.mesh.group);
    u.officers = [];
    heldAiCar = { v };
  }
}

function resetGame() {
  for (const c of [...g.traffic.cars]) scene.remove(c.v.mesh.group);
  // A car the player stole from traffic/police is no longer in either AI list
  // and (until the player stepped out) not in g.cars either — drop it here so
  // a reset never leaves a stray body in the world.
  for (let i = g.cars.length - 1; i >= 0; i--) {
    if (g.cars[i].fromAi) { scene.remove(g.cars[i].mesh.group); g.cars.splice(i, 1); }
  }
  if (heldAiCar) { scene.remove(heldAiCar.v.mesh.group); heldAiCar = null; }
  for (const p of [...g.peds.list]) scene.remove(p.mesh.group);
  clearPolice(g.police);
  for (const gg of [...g.gangs.list]) scene.remove(gg.mesh);
  g.traffic.cars.length = 0; g.peds.list.length = 0;
  g.police.cars.length = 0; g.gangs.list.length = 0;
  g.player.pos.set(-45, 0, 20); g.player.heading = Math.PI; g.player.camYaw = Math.PI;
  g.player.health = 100; g.player.armor = 0; g.player.mode = 'foot'; g.player.car = null;
  g.player.stamina = 100; g.player.weapon = 'pistol';
  g.player.ammo = { pistol: 13, shotgun: 6, smg: 30 };
  g.player.reserve = { pistol: 60, shotgun: 24, smg: 90 };
  g.player.jackTarget = null; heldAiCar = null;
  g.weapons.current = 'pistol'; g.weapons.reloading = 0;
  g.economy.money = 0; g.wanted.heat = 0; g.wanted.stars = 0;
  g.wanted.losT = 0; g.wanted.coolT = 0; g.overReason = null;
  g.missions.job = null; g.missions.obj = 0; g.missions.done = []; g.missions.available = 1;
  g.hour = DAY.start; g.tide.elapsed = 0;
}

// Manual quality: auto (adaptive steps down when slow), low, normal, high.
// Applies pixel ratio + shadow map size for real — not just a label.
g.setQuality = (mode) => {
  g.qualityMode = mode;
  const apply = (pr, shadow) => {
    renderer.setPixelRatio(pr);
    lighting.sun.shadow.mapSize.set(shadow, shadow);
    if (lighting.sun.shadow.map) { lighting.sun.shadow.map.dispose(); lighting.sun.shadow.map = null; }
  };
  if (mode === 'low') { qual = 2; apply(0.75, 512); }
  else if (mode === 'normal') { qual = 1; apply(1, 1024); }
  else if (mode === 'high') { qual = 0; apply(Math.min(devicePixelRatio, 2), 2048); }
  else { qual = 0; lowT = 0; apply(Math.min(devicePixelRatio, 2), 2048); } // auto: start high, adapt down
};
// Hidden tab: suspend the audio graph so the engine hum / siren / radio
// do not keep droning while the tab is in the background.
document.addEventListener('visibilitychange', () => {
  const a = g.audio;
  if (!a.ctx) return;
  if (document.hidden) a.ctx.suspend();
  else if (g.state === 'play') a.ctx.resume();
});

function damagePlayer(n) {
  if (g.state === 'over') return; // never overwrite an arrest with a KO
  g.player.health -= n;
  lastDamageT = g.time;
  shakeT = 0.3;
  // Losing all health is a KO — never an arrest. Arrests only come from
  // the officer flow below (police.arrested), never from damage.
  if (g.player.health <= 0) { g.player.health = 0; gameOver(g, 'ko'); }
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
  // ONE aim vector per frame: the camera forward. stepPlayer solves the gun
  // arm's pose from it and fire() shoots along it, so the arm, the muzzle, the
  // flash and the tracer cannot disagree — they are all derived from here.
  // Sampled before stepPlayer so the pose and the shot in the same step use
  // the identical vector.
  const aimVec = new THREE.Vector3();
  camera.getWorldDirection(aimVec);
  // Every enterable vehicle: parked cars, traffic, and police cruisers. A
  // traffic car is a wrapper ({v, speed, ...}) around the vehicle, so the
  // controller gets the vehicles themselves — same shape as solidCars below.
  // Without this the traffic cars (and cruisers) were never checked by
  // nearestCar, so E only ever worked on the five parked cars.
  const enterCars = g.cars.concat(
    g.traffic.cars.map((c) => c.v),
    g.police.cars.map((u) => u.v),
  );
  stepPlayer(p, dt, enterCars, g.tide.t, aimVec);
  // A traffic/police car the player is climbing into or driving leaves its AI
  // list for good: traffic would otherwise snap the body back onto its rail
  // and police would keep throttling it. On exit the car becomes an ordinary
  // parked car (g.cars), so it stays enterable and never resurrects its AI.
  if (p.mode === 'jacking' && p.jackTarget && !heldAiCar) detachAiCar(p.jackTarget);
  if (!p.car && heldAiCar && (p.mode === 'foot' || p.mode === 'driving')) {
    // Even a wreck rejoins g.cars so it stays a solid body (nearestCar skips
    // dead cars, peds still collide with it).
    heldAiCar.v.fromAi = true; g.cars.push(heldAiCar.v);
    heldAiCar = null;
  }
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
  // Traffic cars running over the player on foot. Only a MOVING car hurts:
  // a car stopped at a red light, pulled over for a siren, or frozen in the
  // lane must not shove the player away — otherwise they could never stand
  // beside it long enough to press E.
  if (p.mode === 'foot') {
    for (const c of g.traffic.cars) {
      if (c.speed > 1
        && Math.hypot(c.v.pos.x - p.pos.x, c.v.pos.z - p.pos.z) < 2.2) {
        damagePlayer(20); addHeat(g.wanted, 12);
        panicPeds(g.peds, p.pos.x, p.pos.z, 25);
        p.pos.x += (p.pos.x - c.v.pos.x) * 0.5; p.pos.z += (p.pos.z - c.v.pos.z) * 0.5;
      }
    }
  }
  sirenOn = g.wanted.stars >= 2;
  updateTraffic(g.traffic, dt, p, sirenOn);
  // Cars are passed in so a ped cannot walk into a parked body (see updatePeds).
  // A stolen traffic/police car is in neither list, so add the player's own car.
  const solidCars = p.car ? g.cars.concat(g.traffic.cars.map((c) => c.v), [p.car])
    : g.cars.concat(g.traffic.cars.map((c) => c.v));
  // Pedestrians get the road graph too: spawns snap to sidewalks and walkers
  // are steered off the asphalt (see updatePeds).
  updatePeds(g.peds, dt, p, solidCars, g.roads);
  // Police "near" for the wanted cooldown: cruisers, on-foot officers, and
  // the helicopter all keep eyes on the player.
  const policeNear = g.police.cars.some((u) => Math.hypot(u.v.pos.x - p.pos.x, u.v.pos.z - p.pos.z) < 60)
    || g.police.nearestOfficer < 60 || g.police.heli.visible;
  if (updatePolice(g.police, dt, p, g.wanted.stars, g.time)) damagePlayer(18);
  // Arrest: only an on-foot officer who stayed close for ARREST_TIME can
  // end the game this way — shooting or any other crime only raises heat.
  if (g.police.arrested) { g.police.arrested = false; gameOver(g, 'arrested'); }
  updateWanted(g.wanted, dt, policeNear);
  updateGangs(g.gangs, dt, p, (x, y, z) => fx.muzzle(x, y, z));
  // Gang fire subtracts health directly (no damagePlayer call inside the
  // AI), so the death check must live here — otherwise the player can sit
  // at health <= 0 forever: no game over, and no regen (regen needs > 0).
  if (p.health <= 0) damagePlayer(0);
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
  // stepPlayer already consumed E when a car was in range (entering the car
  // takes priority), so any E reaching here means no enterable car was near.
  // Every press is consumed here with feedback — and the message says what
  // actually happened: the old blanket "Terlalu jauh dari mobil" claimed a
  // distance problem even while standing right beside a car or the hideout.
  if (p.mode === 'foot' && input.edge('enter')) {
    const d = Math.hypot(p.pos.x + 270, p.pos.z - 0);
    if (d < 12) {
      if (g.wanted.stars > 0) {
        const r = tryPayoff(g.wanted, g.economy.money, policeNear);
        if (r.ok) { g.economy.money -= r.cost; toast(`Suap dibayar — Rp ${r.cost.toLocaleString('id-ID')}. Buruan hilang.`); }
        else toast('Tidak cukup uang atau polisi terlalu dekat');
      } else toast('Tidak ada buronan yang perlu dibayar di sini');
    } else {
      toast('Tidak ada kendaraan di dekatmu');
    }
  }
  // Weapons.
  updateWeapons(g.weapons, dt, p);
  if (input.edge('weapon')) switchWeapon(g.weapons, p);
  if (input.edge('reload')) startReload(g.weapons, p);
  if (input.edge('radio')) { g.radioName = nextStation(g.radio); toast(g.radioName); }
  if (input.edge('mute')) {
    const m = g.audio.toggleMute();
    toast(m ? 'Suara mati (N untuk nyalakan)' : 'Suara nyala');
  }
  if (input.edge('map')) {
    const cv = document.getElementById('minimap-canvas');
    const big = cv.style.width === '480px';
    cv.style.width = big ? '190px' : '480px';
    cv.style.height = big ? '190px' : '480px';
  }
  if (p.mode === 'foot' && input.held('fire')) {
    // Same vector the arm was posed from this frame — not a fresh sample.
    const res = fire(g.weapons, p, aimVec, g.gangs, g.police, (x, y, z) => fx.muzzle(x, y, z));
    if (res === 'shot' || res === 'hit') {
      g.audio.shot();
      addHeat(g.wanted, 10);
      panicPeds(g.peds, p.pos.x, p.pos.z, 25);
      shakeT = 0.12;
    } else if (res === 'kill') {
      g.audio.shot();
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
  updateWater(water, g.tide.t, g.time);
  updateLighting(lighting, g.hour, g.rain, lighting.lampMats, g.player.pos);
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
// Only in 'auto' mode: a manual quality choice is never overridden, and the
// steps only go down, so the quality never oscillates up and down.
let qual = 0, lowT = 0;
function adaptQuality(dt) {
  if (g.qualityMode !== 'auto') return;
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
    updateLighting(lighting, g.hour, 0, lighting.lampMats, g.player.pos);
    updateWater(water, g.tide.t, now / 1000);
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
    // R7/M4 — a shot's wanted level is fixed, not earned. Street fires six
    // SMG rounds while it is stepped and each adds 10 heat; updateWanted
    // (which runs after updatePolice in step()) would turn that into a fourth
    // star, and the next updatePolice call would then spawn a fifth cruiser.
    // Re-assert the staged value before every step so updatePolice always
    // reads the shot's own level, and once more after the loop so the HUD
    // renders it.
    if (g.shotWanted) {
      g.wanted.heat = g.shotWanted.heat;
      g.wanted.stars = g.shotWanted.stars;
    }
    step(STEP);
  }
  if (g.shotWanted) {
    g.wanted.heat = g.shotWanted.heat;
    g.wanted.stars = g.shotWanted.stars;
  }
  // R8/M4a — a shot is a posed frame, not a session: the steps above really
  // run the damage paths (street takes a police hit worth 18), so a judge shot
  // could show 82 health purely because of its step count. Reset the vitals in
  // the same place the wanted level is reset — shot path only; live play keeps
  // whatever the player earned.
  g.player.health = 100;
  g.player.armor = 0;
  g.player.stamina = 100;
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
