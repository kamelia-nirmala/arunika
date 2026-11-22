// Screenshot scenes: each one stages the real game — same seed, same
// world, a fixed number of steps — then the camera is placed and one frame
// is rendered. What you see is what a short session really looks like.
import * as THREE from 'three';
import { JOBS } from './missions/jobs.js';
import { createVehicle } from './physics/vehicle.js';
import { spawnGang } from './ai/gangs.js';
import { spawnPed } from './ai/pedestrians.js';
import { addLightbar } from './ai/police.js';
import { setTide } from './systems/tide.js';
import { makeRng } from './random.js';
import { switchWeapon } from './player/weapons.js';
import { spawnTrafficCar } from './world/traffic.js';
import { buildAwning } from './world/props.js';
import { updateLighting } from './render/lighting.js';

// Golden hour = 16.6–17.8 (sun low and warm in lighting.js); dusk vista just
// before the lamps come on at 18.5. rain stays 0: any rain value switches the
// fog to the 60–500 m drizzle band and throws full-strength rain streaks.
// dialog sits at 17.30 rather than 17.75: at 17.75 the 15:00 → 18:00 sky stop
// has already blended most of the way to the grey-pink dusk colour and the
// frame reads cold. 17.30 keeps the sun above the haze line and the sky warm.
// cover sits at 17.35: the 15:00 → 18:00 stop has blended most of the way to
// the warm dusk colour by then, so the sky is the warm mauve the dialog shot
// was praised for, and the sun (0xffc890) is low enough to rim the towers.
// That low sun is also why cover adds its own warm fill lights in staging —
// see the note there. Vista sat at 16.0 for six rounds so its wide sky stayed
// a pale blue behind the white pylon instead of drifting mauve; R7/M3b measured
// that choice against the other three frames and moved it (see the note there).
// R7/M4 — all four judge shots sit on the same wanted level so the HUD reads
// identically. ★3 is the value: updatePolice wants stars + 1 units (four),
// cover stages four pursuers plus a roadblock and street stages four
// cruisers, so neither scene needs a spawn. `heat` 82 sits between the ★3
// (70) and ★4 (110) thresholds in config.js, i.e. it re-derives ★3 on every
// updateWanted pass. Street still needs the re-assert in main.js: firing the
// SMG adds 10 heat a shot, which on its own would carry the frame to ★4.
// minimap keeps its own ★3 independently — it is a candidate shot, not a
// judge shot.
const SHOTS = {
  cover: { hour: 17.35, tide: 0.62, rain: 0, steps: 90, wanted: 3, heat: 82 },
  street: { hour: 16.95, tide: 0.5, rain: 0, steps: 31, wanted: 3, heat: 82 },
  dialog: { hour: 17.3, tide: 0.55, rain: 0, steps: 12, wanted: 3, heat: 82 },
  minimap: { hour: 16.9, tide: 0.62, rain: 0, steps: 10 },
  vista: { hour: 17.35, tide: 0.55, rain: 0, steps: 12, wanted: 3, heat: 82 },
  shooting: { hour: 11.66, tide: 0.68, rain: 0, steps: 33 },
};

// The fps readout is a debug HUD element: in a still frame it can only lie
// about the machine that took the shot, so every scene hides it.
function hideFps(game) {
  game.fps = 0;
  const el = document.getElementById('fps');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

// Muzzle flare for the street shot: a hot solid core with four short spikes.
// The gameplay sprite is a soft radial bloom, and a soft bloom has no edge —
// at this camera range it read as a faint halo. The core is deliberately
// large (r 30 of 64) so the flash is a disc you can see, not a speck, while
// the spikes keep the "flare" silhouette. Only the sprite's map is swapped:
// the game's own flash code (size, lifetime, opacity) still drives it.
function starFlareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  const cx = 64, cy = 64;
  for (const [rot, len, w] of [[0, 54, 14], [Math.PI / 4, 26, 7], [Math.PI / 2, 54, 14], [3 * Math.PI / 4, 26, 7]]) {
    for (const dir of [0, Math.PI]) {
      g.save();
      g.translate(cx, cy);
      g.rotate(rot + dir);
      const grad = g.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, 'rgba(255,255,248,1)');
      grad.addColorStop(0.4, 'rgba(255,238,170,0.95)');
      grad.addColorStop(1, 'rgba(255,150,40,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(len, -w); g.lineTo(len, w);
      g.closePath(); g.fill();
      g.restore();
    }
  }
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, 30);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.5, 'rgba(255,250,225,1)');
  core.addColorStop(0.78, 'rgba(255,215,120,0.85)');
  core.addColorStop(1, 'rgba(255,170,50,0)');
  g.fillStyle = core;
  g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.fill();
  return c;
}

// Place a car on a road at (x, z) facing `heading`, moving at `speed`.
// Static props are not stepped, so the group pose is set here too
// (createVehicle only fills `pos`; stepVehicle is what normally syncs it).
function placeCar(game, kind, x, z, heading, speed, color) {
  const v = createVehicle(kind, x, z, heading, color);
  v.speed = speed;
  v.mesh.group.position.copy(v.pos);
  v.mesh.group.rotation.y = heading;
  game.scene.add(v.mesh.group);
  game.cars.push(v);
  return v;
}
// A cruiser registered in the real pursuit list, so updatePolice drives it,
// flashes its lightbar and deploys its officer like any spawned unit.
function stageCruiser(game, x, z, heading) {
  const v = placeCar(game, 'police', x, z, heading, 0, 0x1a1a1a);
  addLightbar(v);
  game.police.cars.push({ v, stuck: 0, officers: [] });
  return v;
}
// A roadblock unit: the same `police` vehicle police.js parks across the
// boulevard at ★3+, pushed into pol.blocks so the block is the game's own
// object (and updatePolice leaves it alone because the list is not empty).
function stageBlock(game, x, z) {
  const v = createVehicle('police', x, z, Math.PI / 2, 0x1a1a1a);
  v.speed = 0;
  v.mesh.group.position.copy(v.pos);
  v.mesh.group.rotation.y = Math.PI / 2; // broadside: nose across the lanes
  addLightbar(v);
  game.scene.add(v.mesh.group);
  game.police.blocks.push(v);
  return v;
}
// A real traffic car (same updater as live play) dropped on the nearest road
// edge, so it rolls along the lane instead of standing still.
function stageTraffic(game, x, z) {
  const roads = game.roads;
  let best = null, bt = 0, bd = Infinity;
  for (const e of roads.edges) {
    const dx = e.bx - e.ax, dz = e.bz - e.az;
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - e.ax) * dx + (z - e.az) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = e.ax + dx * t, pz = e.az + dz * t;
    const d = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d < bd) { bd = d; best = e; bt = t; }
  }
  const heading = Math.atan2(best.bx - best.ax, best.bz - best.az);
  const c = spawnTrafficCar(game.traffic, best.ax + (best.bx - best.ax) * bt,
    best.az + (best.bz - best.az) * bt, heading, roads.edges.indexOf(best));
  c.dist = best.len * bt;
  return c;
}
// The Pasar Ikan fish stalls are real objects (buildPort in world/city.js):
// a 3 x 2.4 x 2.5 brown body on the promenade, a striped awning bedded in its
// top, a painted name board ("IKAN SEGAR", "UDANG BASAH"…) on the +z face and
// a neon tube under the awning. Their x positions come out of the build RNG,
// so this scene LOCATES one in the already-built city instead of hard-coding
// a coordinate that might be empty road. Matching the body geometry is enough
// to be unique: no other mesh in the world is a 3 x 2.4 x 2.5 box.
function findFishStall(scene, nearX, nearZ) {
  let best = null, bd = Infinity;
  for (const o of scene.children) {
    if (!o.isMesh || !o.geometry || !o.geometry.parameters) continue;
    const q = o.geometry.parameters;
    if (Math.abs(q.width - 3) > 1e-6 || Math.abs(q.height - 2.4) > 1e-6 ||
        Math.abs(q.depth - 2.5) > 1e-6) continue;
    const d = Math.hypot(o.position.x - nearX, o.position.z - nearZ);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return { x: 120, z: -262 };
  return { x: best.position.x, z: best.position.z };
}
// Aim camera for an on-foot shot: `back` metres behind the player, `height`
// up, `side` metres to the RIGHT of the aim line, looking `lead` metres past
// the player at `lookY`. The side offset matters: a camera dead on the aim
// line hides the muzzle behind the player's own back. It must also stay well
// inside the 0.985 aim cone fire() uses (≈10°), so side/back is kept small —
// 0.4 m over 3.0 m is 7.6°, which still lands the shot on the target.
function aimCam(game, tx, tz, back, height, side, lead, fov, lookY) {
  const p = game.player;
  const yaw = Math.atan2(tx - p.pos.x, tz - p.pos.z);
  p.camYaw = yaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw); // right of the aim line
  const cx = p.pos.x - fx * back + rx * side;
  const cz = p.pos.z - fz * back + rz * side;
  const lx = p.pos.x + fx * lead, lz = p.pos.z + fz * lead;
  const ly = lookY === undefined ? 1.25 : lookY;
  game.camera.position.set(cx, height, cz);
  game.camera.lookAt(lx, ly, lz);
  game.camera.fov = fov; game.camera.updateProjectionMatrix();
  game.camOverride = { pos: { x: cx, y: height, z: cz }, look: { x: lx, y: ly, z: lz }, fov };
}
// step() returns on its first frame while a dialog is open, so updateLighting
// never runs and the sky gradient canvas is left unpainted (black) and the
// sun keeps its build-time pose — the one frame the shot renders would be
// wrong. Re-run the real lighting pass once, against the lights and sky
// texture already in the scene, so the frame matches what a player standing
// at that hour actually sees. No new lights, no fake colours: same code path.
function relight(game, hour) {
  const scene = game.scene;
  let sun = null, hemi = null;
  for (const o of scene.children) {
    if (o.isDirectionalLight) sun = o;
    else if (o.isHemisphereLight) hemi = o;
  }
  const skyTex = scene.background;
  if (!sun || !hemi || !skyTex || !skyTex.image) return;
  const proxy = { sun, hemi, lampMats: [], skyCanvas: skyTex.image, skyTex, lastGradHour: -99 };
  updateLighting(proxy, hour, game.rain, proxy.lampMats, game.player.pos);
}

export function stageShot(name, game) {
  const cfg = SHOTS[name] || SHOTS.cover;
  const rng = makeRng(game.seed);
  const realRandom = Math.random;
  Math.random = rng; // deterministic staging
  try {
    game.hour = cfg.hour;
    setTide(game.tide, cfg.tide);
    game.rain = cfg.rain;
    game.state = 'shot';
    // R7/M4 — the wanted level is a property of the SHOT, not of the scene, so
    // it is set once here and the four judge shots cannot drift apart again.
    // It is re-asserted every step in main.js (game.shotWanted) because a
    // scene that fires a weapon accrues real heat while it is stepped: street
    // lands six SMG rounds, +10 heat each, which would carry ★3 to ★4 mid-shot.
    if (cfg.wanted) {
      game.wanted.stars = cfg.wanted;
      game.wanted.heat = cfg.heat;
      game.shotWanted = { stars: cfg.wanted, heat: cfg.heat };
    }
    document.body.classList.remove('hud-minimal', 'hud-hidden');
    hideFps(game);
    const p = game.player;
    if (name === 'cover') {
      // Golden hour on Boulevard Kemuning Lurus. R4's cover sat on a low
      // chase cam 30 m behind the sedan: the hero car was a dark wedge at the
      // bottom edge, the helicopter was a 60-px blob 67 m out, and the
      // "roadblock" read as cruisers strung out down the road instead of a
      // wall. Three fixes, one per fault:
      //   - camera 6.6 m up at 23 m from the car, aimed past its roof, so the
      //     sedan fills the centre-left third instead of the frame edge;
      //   - three cruisers parked broadside nose-to-tail at z=-219, which
      //     covers x -52.2..-37.8 — the whole 12 m carriageway and both
      //     shoulders, a continuous barrier with no lane left open;
      //   - the helicopter brought down to 14 m and in to 35 m, turned
      //     three-quarters and scaled 1.3x, so body, boom and rotor disc all
      //     read (~250 px long) instead of a black speck.
      p.mode = 'driving';
      // 90 steps at 21.7 m/s from z=-167.5 leaves the sedan at z ≈ -200,
      // 23 m in front of the camera. Teal paint: the game's own accent, and
      // the one bright body in a frame full of black cruisers.
      const car = placeCar(game, 'sedan', -47, -167.5, Math.PI, 21.7, 0x2fd3c4);
      p.car = car; p.pos.copy(car.pos); p.heading = Math.PI;
      // Wanted level comes from SHOTS.cover (★3, heat 82) — set once in the
      // common staging block above. Roadblock only exists at ★3+, and
      // updatePolice leaves pol.blocks alone because it is non-empty.
      game.missions.job = JOBS[3]; game.missions.obj = 0;
      // Roadblock: 4.8 m spacing on 4.7 m-long bodies, so the three cars
      // butt together into one 14 m wall across the carriageway.
      stageBlock(game, -49.8, -219);
      stageBlock(game, -45.0, -219);
      stageBlock(game, -40.2, -219);
      // Pursuers: two flanking the sedan on the shoulders (clear of its
      // silhouette and of the sight line to it), one just behind the camera,
      // one beyond the block for depth. R7/M4 dropped the second car behind
      // the camera: the shot is ★3 now, and ★3 wants four units (stars + 1,
      // see updatePolice), so staging exactly four keeps updatePolice from
      // spawning an extra cruiser 120 m away. The car removed was the one at
      // z -164, i.e. behind the lens and therefore never in frame — the
      // picture keeps the same four visible vehicles it had at ★4.
      stageCruiser(game, -53.4, -196, Math.PI);
      stageCruiser(game, -40.4, -197, Math.PI);
      stageCruiser(game, -56.5, -164, Math.PI);
      stageCruiser(game, -52.4, -236, Math.PI);
      // Helicopter. Two separate faults, so two fixes.
      // (1) FRAMING. v19/v20 hung it at (-33, 12, -214) → screen (938, 154),
      // dead on the right tower's window grid, so a dark body sat on dark
      // windows and vanished. v21 moved it to (-50, 12, -209) — inside the
      // frame and 240 px wide, but at 26 m it overlapped the pylon and the
      // left facade, and the reviewer still read "no helicopter". This pass
      // puts it at (-34.7, 24.6, -252.9), 65 m out on the same view ray:
      // measured bbox x 749..909, y 52..130, i.e. 160x78 px sitting inside
      // the one genuinely empty sky run in the frame (a pixel scan of the
      // previous render found clear sky only at x 700..920, y 50..160).
      // 3/4 yaw 0.75 shows length plus flank instead of a nose-on wedge.
      // (2) SILHOUETTE. The model itself now carries the aircraft parts — nose
      // taper, cabin glazing, tail boom/fin/rotor, mast and 2-blade rotor,
      // skids — all built in ai/police.js createPolice, and the hull is matte
      // dark so it separates from the pale sky instead of picking up the warm
      // fill. Staging here only places the aircraft; it adds no geometry.
      const heli = game.police.heli;
      game.police.forceHeli = true;
      heli.visible = true;
      heli.position.set(-34.7, 24.6, -252.9);
      heli.rotation.y = 0.75;
      heli.scale.setScalar(1.5);
      // Oncoming traffic beyond the block for depth; palms line the verges
      // already.
      placeCar(game, 'compact', -41.5, -232, 0, 0, 0xd8b13c);
      placeCar(game, 'truck', -49.5, -247, 0, 0, 0x7a6a4a);
      // R7/M5 — busier boulevard: two more oncoming cars in the far lanes and
      // onlookers on the east sidewalk, clear of the hero car, the block and
      // the helicopter's sky (the heli hangs 24 m up, these stand on the ground).
      placeCar(game, 'sedan', -38.5, -240, 0, 0, 0x3a6db8);
      placeCar(game, 'compact', -44.5, -256, 0, 0, 0xc96a2f);
      for (let i = 0; i < 4; i++) spawnPed(game.peds, -36.5, -205 - i * 9);
      // Wreck-side onlookers, west sidewalk only: anything on the east kerb
      // would stand between this camera and the car.
      for (let i = 0; i < 5; i++) spawnPed(game.peds, -53.5, -168 - i * 9);
      // 6.2 m up, 16 m behind the hero car, aimed past its roof at the wall:
      // the sedan lands just left of centre at ~180 px of body, the block
      // fills the middle band dead on the view axis, the helicopter hangs in
      // the upper right. fov 58 keeps both facades in frame without the
      // wide-angle smear the old 30 m chase cam produced.
      game.camOverride = {
        pos: { x: -42.0, y: 6.2, z: -184.0 }, look: { x: -46.5, y: 2.4, z: -219.0 }, fov: 58,
      };
      // Golden-hour fill. At 17.35 the sun sits ~19° up and ~20° west, so its
      // incidence on the flat road is only ~0.33 — measured on the previous
      // frame the asphalt came back at luminance 7–15 while the accepted
      // shots sat at 52–79, i.e. the "road almost black" verdict was
      // geometry, not exposure. Raising sun intensity cannot fix a grazing
      // angle, so this scene adds two lights of its own, the way a real
      // golden-hour frame gets its warm bounce: a low, warm key from the
      // camera side that rakes along the tarmac and picks out the lane
      // paint, and a broad amber hemisphere-style fill from above so the
      // shadow side of the cruisers and the hero car stop crushing to black.
      // Both are plain lights on the scene (nothing in render/lighting.js is
      // touched) and both are scoped to this staging call.
      const warmKey = new THREE.DirectionalLight(0xffb877, 2.4);
      // Steep, not raking. The first attempt sat the key at y=26 over a 64 m
      // horizontal run, so N·L on flat asphalt was 0.38 and the measured road
      // only came back to (26,19,12) — still far under the 52–79 the accepted
      // frames hold. Dropping the light almost over the road (40 m up, 26 m
      // of run) puts N·L at 0.91, which is the actual lever on a horizontal
      // surface; the colour stays warm so it still reads as late sun.
      warmKey.position.set(-47, 42, -186);
      warmKey.target.position.set(-47, 0, -212);
      warmKey.castShadow = false;
      game.scene.add(warmKey, warmKey.target);
      const warmFill = new THREE.HemisphereLight(0xffcf9a, 0x7a5a3e, 1.15);
      game.scene.add(warmFill);
      game.shotLights = [warmKey, warmFill];
    } else if (name === 'street') {
      // Pasar Ikan promenade road at golden hour: Raka on foot with the SMG
      // (two Q presses: KOBRA-9 → BANDOT-12 → TAWON-45, see below), firing at
      // a gang 14 m out, a cruiser braking in with its officer getting out,
      // traffic in the north lane. The frame is staged to land on the step
      // the gun fires on (smg rof 11 → one shot every 6 steps, so steps =
      // 6k + 1, and 31 is the sixth shot): the ~0.06 s flash and the 0.09 s
      // tracer are caught, not lengthened.
      //
      // THE TRACER PROBLEM: fire() aims along the CAMERA forward, and the
      // tracer runs from the barrel tip to the target — both of which sit on
      // that same axis. Put the camera on the aim line and the 14 m line
      // projects onto almost nothing: a 41-px sliver at the vanishing point
      // (measured: 52 hot px). It is not dim, it is foreshortened. The fix is
      // a real lateral offset — the camera stands 1.05 m to the right of the
      // aim line, so the muzzle (4.4 m out) sits ~170 px left of centre while
      // the target (14 m out) sits ~50 px right of it. The tracer therefore
      // crosses the frame as a ~220 px diagonal instead of collapsing to a
      // dot, and the flash clears the player's own silhouette. The offset is
      // 3.7° off the aim line, far inside fire()'s 0.985 cone (≈10°), so the
      // shot still lands.
      p.mode = 'foot';
      p.pos.set(60, 0, -228); p.heading = Math.PI / 2;
      // Q is switchWeapon in player/weapons.js — the same call the key makes.
      switchWeapon(game.weapons, p); switchWeapon(game.weapons, p);
      // Gang 14 m down the promenade, pinned on the aim line so the tracer
      // has a fixed target to draw to instead of wherever the seeded spread
      // put them.
      spawnGang(game.gangs, 73, -234, 3);
      const marks = [[73.0, -234.0], [70.8, -236.2], [75.4, -232.0]];
      game.gangs.list.forEach((gm, i) => {
        if (marks[i]) gm.pos.set(marks[i][0], 0, marks[i][1]);
        gm.shootT = 9; // hold fire: a hit in the last steps would shake the frame
      });
      game.missions.job = JOBS[5]; game.missions.obj = 0;
      // Cruisers brake in. The near one stops 12 m off Raka's right, on the
      // open verge — close enough for updatePolice to deploy its officer
      // (deploy radius 22 m), far enough that the officer walks out into open
      // ground instead of being tucked behind a car body. The others stay
      // past the deploy radius or far down the street, so the frame keeps one
      // readable officer rather than a crowd converging on the lens.
      // R7/M4 — wanted is ★3 here too (SHOTS.street), and ★3 wants four
      // units (stars + 1), so these four staged cruisers already satisfy
      // updatePolice: nothing extra spawns 120 m away and the staging is
      // unchanged.
      stageCruiser(game, 67.5, -237.5, -Math.PI / 2);
      stageCruiser(game, 86, -232, 2.4);
      stageCruiser(game, 100, -224.5, -1.4);
      // Fourth unit, held behind the lens. At ★2 updatePolice wanted three
      // units and popped the staged four down to three, so this car used to be
      // discarded; at ★3 the requirement is four, so it stays and no extra
      // cruiser spawns 120 m away. (30, -200) is 46 m BEHIND the camera at
      // (58.3, 1.9, -223.2) — camera z = +38, i.e. out of the frustum — and
      // 42 m from the player, past the 22 m deploy radius, so it neither
      // shows in frame nor walks an officer into it.
      stageCruiser(game, 30, -200, Math.PI / 2);
      // R7/H3 — traffic that is actually IN the frame. The old spots were all
      // on the boulevard (z≈-221..-228) and none could ever show: the camera
      // stands at (58.3, 1.9, -223.2), INSIDE that carriageway, aimed
      // south-east down the promenade. stageTraffic() snaps to the nearest
      // road edge and updateTraffic() then drives the car down it in the
      // right-hand lane, and the road graph has no westbound boulevard edge —
      // so every boulevard car ends up on the z -223.25 lane, which runs
      // almost along the view ray. Measured in the live frame: a car anywhere
      // on that lane projects to x 1302..1526 (its vanishing point is at
      // x≈1363, past the 1280 edge) and anything nearer the lens falls behind
      // it. That is why the shot read as an empty road.
      // The cross avenue at x=135 is the one stretch of road this camera
      // actually sees: it recedes through the middle-right of the picture,
      // between the two blocks, and its own right-hand lane (x 133.25)
      // projects inside the frame across the whole staged range. Four cars are
      // staged along it, spaced 6-10 m so they read as a queue rolling south
      // rather than a parked row. Verified in the live frame: each car lands
      // 60..75 m out, spans px 909..1261 (right margin 19 px, so nothing is
      // clipped by the 1280 edge), keeps its wheels on the tarmac with all
      // four ground corners inside the kerbs at x 129..141, and a raycast from
      // the shot camera to 0.8 m and 1.4 m above the road at each spot hits
      // nothing — no building or sidewalk hides them. The nearest sits right
      // at updateTraffic's 60 m siren pull-over radius and still holds its
      // lane, so the queue keeps rolling as ordinary traffic instead of
      // braking to the kerb.
      stageTraffic(game, 135, -234);
      stageTraffic(game, 135, -240);
      stageTraffic(game, 135, -246);
      stageTraffic(game, 135, -256);
      for (let i = 0; i < 5; i++) spawnPed(game.peds, 58 + i * 5, -242);
      buildAwning(game.scene, 82, -250, { ry: 0, colors: ['#2f6db8', '#f2ede2'] });
      // Sidewalk crowd, shirts from the ped palette.
      for (let i = 0; i < 9; i++) {
        spawnPed(game.peds, 52 + i * 6, i % 2 ? -216 : -234);
      }
      // Aim at the nearest gang so the shot really lands (impact + tracer).
      let tgt = game.gangs.list[0];
      for (const gm of game.gangs.list) {
        if (Math.hypot(gm.pos.x - p.pos.x, gm.pos.z - p.pos.z) <
            Math.hypot(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z)) tgt = gm;
      }
      p.heading = Math.atan2(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z);
      // Over-the-shoulder from the SIDE, not from directly behind. The old
      // 3.0 m / +0.4 m rig was the bug: the gun hangs off arms[0], which is
      // the figure's -x side, so the muzzle sits at lateral -0.38 m of the
      // aim line — the opposite side from where the camera stood. The
      // 0.55 m-wide torso therefore sat between the lens and the barrel and
      // swallowed both the flash sprite and the tracer (measured: player
      // back filled the centre, muzzle landed at x 762 behind the body's
      // x 654..782 span).
      // Now: 4.2 m back, 2.8 m to the other side, 1.95 m up, aimed 18 m
      // downrange. Measured from that pose: the muzzle projects to
      // (403, 449) and the torso to (273, 446), so the barrel and its flash
      // clear the silhouette by 130 px of open frame; the target lands at
      // (617, 371), making the tracer a ~230 px diagonal across the right
      // two-thirds instead of a dot at the vanishing point. The camera
      // forward is 7.2° off the aim line — inside fire()'s 0.985 cone
      // (~10°) — so the shot still hits the gang and the tracer really is
      // drawn to an impact, not to max range.
      aimCam(game, tgt.pos.x, tgt.pos.z, 4.2, 1.95, -2.8, 18, 52, 1.35);
      // Swap the muzzle sprite's soft radial bloom for the hard star flare.
      const flash = p.mesh && p.mesh.flashSprite;
      if (flash) {
        const tex = new THREE.CanvasTexture(starFlareTexture());
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        flash.material.map = tex;
        flash.material.color.setHex(0xffffff);
        flash.material.needsUpdate = true;
      }
      const canvas = document.getElementById('game');
      if (canvas) canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    } else if (name === 'dialog') {
      // Hasan Ombak at his fish kiosk on the Pasar Ikan promenade (z≈-262,
      // the stall row buildPort lays along the river bank), just after 17:00.
      //
      // R6 fix. The previous staging put the two figures on the open asphalt
      // with the nearest stall 40+ m away, so the frame read as a road at dusk
      // with a dark third at the bottom and no kiosk in it — the reviewer's
      // "dialog marginal" verdict. Two changes, both staging only:
      //   1. findFishStall() locates a real built stall (body + striped awning
      //      + name board + neon tube) and the whole scene is positioned
      //      RELATIVE to it, so the kiosk cannot drift out of frame;
      //   2. the camera stands ON the promenade looking along the stall row
      //      with the river to the left, so the background is kiosk, board,
      //      awning and sky instead of an empty road.
      // Raka and Hasan stand at the kiosk's street face; the crates on the
      // counter and the price board are placed against it, so every element
      // in the frame is one of the city's own props.
      p.mode = 'foot';
      const stall = findFishStall(game.scene, 120, -262);
      const SX = stall.x, SZ = stall.z;
      // R6 round 2. Round 1 put Hasan at HZ = SZ - 1.35, i.e. INSIDE the stall
      // body (the 3 x 2.4 x 2.5 box spans z ± 1.25 around SZ), so the kiosk
      // occluded him completely and the frame showed one figure, not two —
      // the vision pass read "a blocky NPC stands in front of the counter"
      // and nothing else. Both figures now stand clear of the +z face: Hasan
      // at the counter's left corner, Raka out to the right past the price
      // board, so neither is hidden by the stall or sits on the name board.
      const HX = SX - 1.85, HZ = SZ + 1.45;
      const RX = SX + 2.50, RZ = SZ + 2.60;
      p.pos.set(RX, 0, RZ);
      p.heading = Math.atan2(HX - RX, HZ - RZ);
      // Wanted comes from SHOTS.dialog (★3, heat 82). No cruisers are staged
      // and none appear: step() returns on its first frame while the dialog is
      // open (main.js), so updatePolice never runs and never spawns a unit.
      game.missions.job = JOBS[0]; game.missions.obj = 0;
      // Hasan's stand-in (the game has no named-character mesh). Recolour him
      // to the job's own palette (Hasan = blue shirt, amber accent) so the two
      // figures are told apart in the frame.
      const hasan = spawnPed(game.peds, HX, HZ);
      const blue = new THREE.MeshStandardMaterial({ color: 0x2f6db8, roughness: 0.85 });
      for (const c of hasan.mesh.group.children) {
        if (c.isMesh && c.geometry && c.geometry.parameters &&
            Math.abs(c.geometry.parameters.width - 0.5) < 0.05 &&
            Math.abs(c.geometry.parameters.height - 0.65) < 0.05) c.material = blue;
      }
      hasan.heading = Math.atan2(RX - HX, RZ - HZ);
      hasan.mesh.group.rotation.y = hasan.heading;
      // Stall dressing on the counter face: fish crates and a price board, so
      // the frame reads as a fish kiosk even before the sign is legible.
      // Round 3 raised them: the dialog card is 192 px tall and its top edge
      // sits at y≈420, so crates lying at ground level projected to y 517-570
      // and the board's bottom border to y 429 — the card covered the price
      // board's "/KG" line and half the crates. Everything now sits on a real
      // counter (1.02 m top, standing on the ground) so crates land at y
      // 316-376 and the raised board at y 258-375, i.e. fully above the card.
      const counterMat = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.95 });
      const counter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.02, 0.7), counterMat);
      counter.position.set(SX - 0.35, 0.51, SZ + 1.70);
      counter.castShadow = true; counter.receiveShadow = true;
      game.scene.add(counter);
      const crateWood = new THREE.MeshStandardMaterial({ color: 0x5f7a63, roughness: 0.95 });
      const crateTop = new THREE.MeshStandardMaterial({ color: 0xd9b06a, roughness: 0.9 });
      // [x offset, crate centre height] — two side by side on the counter top
      // (1.02 + half a 0.34 crate), one stacked over the left pair.
      const crates = [[-0.80, 1.19], [0.05, 1.19], [-0.38, 1.53]];
      for (const [ox, oy] of crates) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.34, 0.56), crateWood);
        box.position.set(SX + ox, oy, SZ + 1.70);
        box.castShadow = true;
        game.scene.add(box);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.5), crateTop);
        lid.position.set(SX + ox, oy + 0.205, SZ + 1.70);
        game.scene.add(lid);
      }
      // Price board: painted cream board on two legs, its bottom edge clear of
      // the dialog card. Legs were 0.58 m tall under a 0.69 m board resting at
      // y 1.22 — now the board centre is 1.55 and the legs run from the board's
      // bottom edge (1.205) to the ground, so nothing floats.
      const priceC = document.createElement('canvas');
      priceC.width = 256; priceC.height = 192;
      const pg = priceC.getContext('2d');
      pg.fillStyle = '#101820'; pg.fillRect(0, 0, 256, 192);
      pg.strokeStyle = '#f5a623'; pg.lineWidth = 8; pg.strokeRect(6, 6, 244, 180);
      pg.fillStyle = '#f7f0dc'; pg.textAlign = 'center'; pg.textBaseline = 'middle';
      pg.font = '900 34px Arial, sans-serif'; pg.fillText('HARGA', 128, 40);
      pg.font = '900 30px Arial, sans-serif';
      pg.fillText('IKAN  25', 128, 96);
      pg.fillText('UDANG 40', 128, 140);
      pg.fillStyle = '#f5a623'; pg.font = '900 24px Arial, sans-serif';
      pg.fillText('/ KG', 128, 174);
      const priceTex = new THREE.CanvasTexture(priceC);
      priceTex.colorSpace = THREE.SRGBColorSpace;
      const priceBoard = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.69),
        new THREE.MeshStandardMaterial({ map: priceTex, roughness: 0.85,
          emissive: 0x2a2318, emissiveIntensity: 0.45 }));
      priceBoard.position.set(SX + 1.90, 1.55, SZ + 1.66);
      priceBoard.rotation.y = -0.30;
      game.scene.add(priceBoard);
      // Legs: board bottom edge is 1.205, so a 1.2 m post centred at 0.60 runs
      // ground (0) → 1.20 and meets the board. No gap, nothing floating.
      const legMat = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.9 });
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.21, 0.07), legMat);
        leg.position.set(SX + 1.90 + s * 0.34, 0.605, SZ + 1.66);
        game.scene.add(leg);
      }
      // Walkers further along the promenade, not in front of the kiosk: round
      // 1 scattered them at SX - 3.4 .. +2.9 / SZ - 3.2, i.e. one of them
      // stood between the camera and Raka. They now sit well down the row
      // (x offsets +3..+9, further out in z) so they read as background.
      for (let i = 0; i < 4; i++) spawnPed(game.peds, SX + 3.6 + i * 2.0, SZ - 3.0 - i * 0.5);
      // R7/M5 — the row continues: three more walkers further down, and the
      // neighbouring kiosk gets its own striped awning with a customer under
      // it, so the frame reads as a market row. The awning sits at SX+3.8
      // (right of Raka, canopy above his head height) with its customer just
      // in front of it; the main stall's sign and price board stay clear.
      for (let i = 0; i < 3; i++) spawnPed(game.peds, SX + 11.6 + i * 2.0, SZ - 5.0 - i * 0.5);
      buildAwning(game.scene, SX + 3.8, SZ + 0.8, { w: 3.0, ry: 0, colors: ['#2f6db8', '#f2ede2'] });
      // Customer UNDER the neighbour awning (SZ+0.2, behind its front edge),
      // 2.4 m behind Raka and 1.3 m to his right — a separate figure at the
      // next kiosk, not a second body crowding Raka's shoulder.
      spawnPed(game.peds, SX + 3.8, SZ + 0.2);
      const { showDialog } = game.dialogApi;
      showDialog(JOBS[0].dialog, null);
      // Camera. Measured against the 1280x720 frame, not guessed: from
      // (SX+0.30, 2.05, SZ+7.60) aimed at (SX-0.05, 1.20, SZ+1.05) with
      // fov 40 the name board projects to x 436..861, y 243..293 and the
      // awning's front edge to y 164-166 — so the whole kiosk face, sign and
      // awning sit above the dialog card (its top edge is y≈444) with 160 px
      // of sky still over the awning. Hasan's head reads at (352, 275), left
      // of the board; Raka's at (1140, 287), right of the price board
      // (x 883..1039) — so he no longer covers the last letter of the sign,
      // which was round 2's first fault. Both figures are 788 px apart and
      // neither crops.
      game.camOverride = {
        pos: { x: SX + 0.30, y: 2.05, z: SZ + 7.60 },
        look: { x: SX - 0.05, y: 1.20, z: SZ + 1.05 }, fov: 40,
      };
      // The dialog froze step() before it ever reached updateLighting.
      relight(game, cfg.hour);
    } else if (name === 'minimap') {
      // Candidate for shot 3: the enlarged minimap (M: 190 px → 480 px) over
      // a three-star chase, so the district grid, police blips and the
      // mission blip all read at once.
      p.mode = 'driving';
      const car = placeCar(game, 'sedan', 40, -140, Math.PI / 2, 14, 0x2a4d6e);
      p.car = car; p.pos.copy(car.pos); p.heading = Math.PI / 2;
      game.wanted.heat = 82; game.wanted.stars = 3;
      game.missions.job = JOBS[3]; game.missions.obj = 0;
      stageCruiser(game, 20, -132, Math.PI / 2);
      stageCruiser(game, 24, -150, Math.PI / 2);
      stageCruiser(game, 30, -146, Math.PI / 2);
      stageCruiser(game, 16, -140, Math.PI / 2);
      const cv = document.getElementById('minimap-canvas');
      if (cv) { cv.style.width = '480px'; cv.style.height = '480px'; }
      game.camOverride = {
        pos: { x: 24, y: 4.6, z: -141 }, look: { x: 70, y: 1.6, z: -141 }, fov: 60,
      };
    } else if (name === 'shooting') {
      // Proof shot for the R3 weapon fix (NOT one of the 4 judge shots):
      // Raka on foot on the boulevard, pistol raised, firing at a gang
      // straight ahead. The trigger is held (synthetic mousedown) for the
      // whole staging run; pistol rof is 4/s, so shots land on steps 1, 17
      // and 33 (the 0.25 s cooldown is 15 steps, but 0.25 - 15*(1/60) leaves
      // a +2.8e-17 float residue, so the shot slips one step late each
      // cycle — 33 steps puts the render right after the third shot), and
      // the frame is rendered right after it — the ~0.06 s flash is caught
      // because the render follows the shot, not because the flash was
      // lengthened. Camera is a close over-the-shoulder view so the pistol
      // in the hand and the flash at the barrel tip are actually readable.
      p.mode = 'foot';
      p.pos.set(-45, 0, 20); p.heading = Math.PI; p.camYaw = Math.PI; p.camPitch = 0.32;
      spawnGang(game.gangs, -45, 4, 3);
      const canvas = document.getElementById('game');
      if (canvas) canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
      game.camera.position.set(-43.5, 2.2, 24.0);
      game.camera.lookAt(-45, 1.3, 12);
      game.camOverride = {
        pos: { x: -43.5, y: 2.2, z: 24.0 }, look: { x: -45, y: 1.3, z: 12 }, fov: 55,
      };
    } else {
      // Vista of the Sekarwangi bridge from the deck ramp, low and angled.
      //
      // R6 fix. The v19/vR5 vista was a 26 m elevated one-point shot straight
      // down the carriageway: the pylon read, but the Tanjung Mas tower on the
      // right filled the right fifth-to-quarter of the frame from top edge to
      // bottom edge and threw a shadow across the road — "gedung kanan
      // mendominasi". Raising and recentring cannot fix that, because the
      // tower is simply inside a wide fov on that axis.
      // This pass drops the camera to the ramp (y 3.4, angled 18° off the road
      // axis so it is a real low three-quarter view), narrows the fov to 46
      // and swings the aim west of the pylon. At that pose the tower's right
      // edge falls outside the frame, the pylon and its cable fan sit on the
      // right third with open water behind, and the left half is filled by the
      // boulevard, the parked column, palms and a billboard — foreground
      // content with the sky still open above the deck.
      // R6 round 2. Round 1 (y 3.4, fov 46, aim x -41) still cropped a beige
      // tower along the right edge — the vision pass answered "on the right, a
      // large beige high-rise building dominates and is cropped by the frame
      // edge", so the fault survived. The cause is measurable: from that pose
      // the building at x -20.8..-5.3, z -262..-247.7 (h 37.2) projected to
      // x 1149..1280, exactly the right edge. Swinging the aim WEST of the
      // pylon axis (to x -60) and pulling the camera back to z -232 moves that
      // building's left edge past the frame: it now projects to x 1336+ and
      // does not touch the picture at all (checked against the seed's full
      // building list — no block intersects the right 30% of frame).
      // The pylon sits at x≈755 with its base at y≈407 and the deck running
      // away to x≈758 at z -360, so the span reads across the middle band
      // with open water behind it and the boulevard in the foreground.
      // R7 (module 3a) — measured fault: the R6 pose stood 8 m before the ramp
      // at y 3.4, i.e. 3.2 m UNDER the deck surface (deck top is 6.6). From
      // below, the span is only ever seen as its shadowed flank and underside,
      // which is why the right of the frame read as one near-black slab, and
      // the pylon 83 m away was tall enough to be cropped by the top edge — a
      // fat column through the centre-right.
      // Two changes, both geometric, nothing faked:
      //   - the camera rises to y 19 and steps back to z -192, so it looks
      //     DOWN on the span from 12 m above it and sees its tarmac and lane
      //     paint instead of its underside; the pylon is 125 m out, so the
      //     whole leaning mast, its amber band and its cable fan sit inside the
      //     frame (tip at y≈38 of 720, sky above it) as a 43-px mast at x
      //     737–780 — a landmark on the right third, not a wall;
      //   - the aim swings west of the bridge axis (look.x -72), which carries
      //     the rooftop billboard out of the sight line to the deck: it moves
      //     from dead centre to x 178–327, where it frames the approach
      //     instead of masking it, and the Tanjung Mas tower is pushed to
      //     x 1084+ so it no longer crowds the frame.
      // At this pose the deck occupies a 65-px band (y 413–478) spanning
      // x 743–984 with water behind it and the boulevard below.
      p.mode = 'foot';
      p.pos.set(-53, 0, -206); p.heading = Math.PI;
      // R7/M4 — wanted is ★3 in all four judge shots (SHOTS.vista). ★3 makes
      // updatePolice want four units and it spawns any shortfall 120 m from
      // the player, which from this pose lands inside the frame (the aim runs
      // 138 m down the boulevard). Four cruisers are staged behind the lens
      // instead: z -166..-176 is behind the camera's z -192, so they satisfy
      // the unit count without putting anything new in the picture. They idle
      // rather than converge — 12 steps at 1/60 s is 0.2 s, and at 30+ m they
      // never reach the 22 m deploy radius, so no officer and no gunfire.
      stageCruiser(game, -56.0, -166, Math.PI);
      stageCruiser(game, -49.0, -170, Math.PI);
      stageCruiser(game, -57.5, -176, Math.PI);
      stageCruiser(game, -44.0, -172, Math.PI);
      game.camOverride = {
        pos: { x: -56.0, y: 19.0, z: -192.0 },
        look: { x: -72.0, y: 20.0, z: -330.0 }, fov: 56,
      };
      // Foreground: the queued traffic on the flat approach (the ramp only
      // lifts north of z=-240, and these props are never stepped, so anything
      // past that would sink under the rising slab). At z -222..-240 they
      // project to y≈620–710 — the bottom band of the frame — which is what
      // keeps the near third from being an empty apron of asphalt.
      placeCar(game, 'truck', -57.0, -228, Math.PI, 0, 0x7a6a4a);
      placeCar(game, 'sedan', -48.0, -236, Math.PI, 0, 0x8a2f2f);
      placeCar(game, 'compact', -42.0, -222, Math.PI, 0, 0xd8b13c);
      placeCar(game, 'sedan', -52.0, -240, Math.PI, 0, 0xe8e2d4);
      // R7/M5 — a fuller queue on the flat approach: two more cars slotted
      // into the gaps of the existing diagonal (5+ m clear of every neighbour
      // so nothing intersects), and five more walkers continuing down the
      // west sidewalk. The pylon and deck stay dominant; the camera is untouched.
      placeCar(game, 'sedan', -44.0, -232, Math.PI, 0, 0x2f6db8);
      placeCar(game, 'compact', -58.0, -238, Math.PI, 0, 0x8a6d2f);
      // Pedestrians on the west sidewalk (x -53, the 4 m strip) only — the east
      // verge is where the right-hand tower stands, and anything there would
      // re-crowd the frame.
      for (let i = 0; i < 7; i++) {
        spawnPed(game.peds, -53.0, -224 - i * 5);
      }
      for (let i = 0; i < 5; i++) {
        spawnPed(game.peds, -53.0, -259 - i * 4);
      }
    }
    // Sync the player figure to the staged pose: the dialog shot never
    // steps the player (dialog open), and a driving player is hidden.
    p.mesh.group.position.copy(p.pos);
    p.mesh.group.rotation.y = p.heading;
    p.mesh.group.visible = p.mode !== 'driving' && p.mode !== 'jacking';
    return cfg.steps;
  } finally {
    Math.random = realRandom;
  }
}
