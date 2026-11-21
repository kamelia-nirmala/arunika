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
// see the note there. Vista drops to 16.0 so its wide sky stays a
// pale blue (179,195,200) behind the white pylon instead of drifting mauve.
const SHOTS = {
  cover: { hour: 17.35, tide: 0.62, rain: 0, steps: 90 },
  street: { hour: 16.95, tide: 0.5, rain: 0, steps: 31 },
  dialog: { hour: 17.3, tide: 0.55, rain: 0, steps: 12 },
  minimap: { hour: 16.9, tide: 0.62, rain: 0, steps: 10 },
  vista: { hour: 16.0, tide: 0.55, rain: 0, steps: 12 },
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
      game.wanted.heat = 118; game.wanted.stars = 4;
      game.missions.job = JOBS[3]; game.missions.obj = 0;
      // Roadblock: 4.8 m spacing on 4.7 m-long bodies, so the three cars
      // butt together into one 14 m wall across the carriageway.
      stageBlock(game, -49.8, -219);
      stageBlock(game, -45.0, -219);
      stageBlock(game, -40.2, -219);
      // Pursuers: two flanking the sedan on the shoulders (clear of its
      // silhouette and of the sight line to it), two more just behind the
      // camera so the ★4 unit count is satisfied without a third car
      // crowding the hero, one beyond the block for depth. ★4 wants five
      // units (stars + 1), so staging exactly five keeps updatePolice from
      // dropping an extra cruiser 120 m away.
      stageCruiser(game, -53.4, -196, Math.PI);
      stageCruiser(game, -40.4, -197, Math.PI);
      stageCruiser(game, -56.5, -164, Math.PI);
      stageCruiser(game, -33.0, -164, Math.PI);
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
      // (2) SILHOUETTE. The stock mesh is a slab body plus one rotor plate —
      // at any distance that renders as a signboard, which is exactly what
      // the vision pass called it. The parts that make an aircraft legible
      // at 65 m are added below, and the hull is repainted matte dark so it
      // separates from the pale sky instead of picking up the warm fill
      // (it measured 129,116,101 against a 163,140,118 sky: no contrast).
      const heli = game.police.heli;
      game.police.forceHeli = true;
      heli.visible = true;
      heli.position.set(-34.7, 24.6, -252.9);
      heli.rotation.y = 0.75;
      heli.scale.setScalar(1.5);
      const hullMat = new THREE.MeshStandardMaterial({ color: 0x151e2a, roughness: 0.85, metalness: 0.08 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0e13, roughness: 0.9, metalness: 0.05 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x2b4a63, roughness: 0.3, metalness: 0.1 });
      // Index 0 is the body, 1 the main rotor (see ai/police.js createPolice).
      const heliParts = heli.children.filter((c) => c.isMesh);
      if (heliParts[0]) heliParts[0].material = hullMat;
      if (heliParts[1]) heliParts[1].material = darkMat;
      const addHeliBox = (w, h, d, x, y, z, mat) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        b.position.set(x, y, z);
        heli.add(b);
      };
      addHeliBox(0.55, 0.55, 4.4, 0, 0.05, 5.4, hullMat);   // tail boom
      addHeliBox(0.16, 1.2, 1.0, 0, 0.6, 7.4, hullMat);     // tail fin
      addHeliBox(0.1, 1.3, 0.18, 0.42, 0.6, 7.4, darkMat);  // tail rotor
      addHeliBox(2.46, 0.52, 1.7, 0, 0.28, 2.0, glassMat);  // cabin glazing band
      addHeliBox(7.6, 0.14, 0.42, 0, 1.16, 0, darkMat);     // rotor blade, darker than the hull
      for (const sx of [-1, 1]) addHeliBox(0.15, 0.15, 3.6, sx * 0.95, -1.05, 0.3, darkMat); // skids
      // Oncoming traffic beyond the block for depth; palms line the verges
      // already.
      placeCar(game, 'compact', -41.5, -232, 0, 0, 0xd8b13c);
      placeCar(game, 'truck', -49.5, -247, 0, 0, 0x7a6a4a);
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
      game.wanted.heat = 45; game.wanted.stars = 2;
      game.missions.job = JOBS[5]; game.missions.obj = 0;
      // Cruisers brake in. The near one stops 12 m off Raka's right, on the
      // open verge — close enough for updatePolice to deploy its officer
      // (deploy radius 22 m), far enough that the officer walks out into open
      // ground instead of being tucked behind a car body. The others stay
      // past the deploy radius or far down the street, so the frame keeps one
      // readable officer rather than a crowd converging on the lens.
      stageCruiser(game, 67.5, -237.5, -Math.PI / 2);
      stageCruiser(game, 86, -232, 2.4);
      stageCruiser(game, 100, -224.5, -1.4);
      stageCruiser(game, 122, -228, -1.9);
      stageTraffic(game, 96, -225);
      stageTraffic(game, 40, -225);
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
      // Hasan Ombak at his fish kiosk on the Pasar Ikan promenade, 17:18:
      // close two-shot with Raka in profile, the stall roofs under the warm
      // sky, the river behind. Raka is turned toward Hasan so his face reads;
      // the camera sits low and level so the sky band above the stall roofs
      // is the top third of the frame instead of a dark wall.
      p.mode = 'foot';
      p.pos.set(126.6, 0, -255.4);
      p.heading = Math.atan2(129.2 - 126.6, -257.4 + 255.4);
      game.missions.job = JOBS[0]; game.missions.obj = 0;
      // Hasan's stand-in (the game has no named-character mesh) at his mark
      // behind the kiosk counter, plus the crowd along the promenade.
      spawnPed(game.peds, 129.2, -257.4);
      for (let i = 0; i < 5; i++) spawnPed(game.peds, 118 + i * 4, -261 + (i % 2) * 3);
      const { showDialog } = game.dialogApi;
      showDialog(JOBS[0].dialog, null);
      game.camOverride = {
        pos: { x: 124.0, y: 2.05, z: -250.2 }, look: { x: 128.6, y: 1.55, z: -257.6 }, fov: 48,
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
      // Vista from 26 m above the boulevard, 165 m short of the pylon.
      // R4/v19 shot this from 2.6 m at z=-224 — practically under the deck —
      // so a black slab filled the middle third, the pylon ran off the top of
      // the frame and no water showed. Geometry for this frame, from the
      // bridge's own numbers: deck y=6 / z=-240..-390, pylon base y=6 at
      // z=-315 rising to y=76. From (−45, 26, −150) the pylon spans 6.9°
      // below the horizon (base) to 16.9° above (top) — the whole 70 m mast
      // and its 16 cables land inside the 62° vertical fov — while the deck
      // only spans 12.5°→4.8°, i.e. a thin band ~13% of the frame height
      // instead of a wall. The river (z −270..−360) sits open behind it and
      // Sagara Hilir's low roofs close the horizon. Nothing tall stands
      // between: the nearest building rows end at z=−225, and the camera
      // looks straight down the 12 m carriageway.
      p.mode = 'foot';
      p.pos.set(-45, 0, -196); p.heading = Math.PI;
      game.camOverride = {
        pos: { x: -45.0, y: 26.0, z: -150.0 }, look: { x: -47.0, y: 12.0, z: -318.0 }, fov: 62,
      };
      // Foreground depth: traffic queued down the boulevard toward the ramp,
      // all on flat road (the ramp only starts at z=-240) and all beyond the
      // frame's bottom edge at z≈-186, so they read as a column, not a crop.
      placeCar(game, 'sedan', -46.5, -190, Math.PI, 0, 0x8a2f2f);
      placeCar(game, 'compact', -39.5, -203, Math.PI, 0, 0xd8b13c);
      placeCar(game, 'truck', -51.0, -218, Math.PI, 0, 0x7a6a4a);
      placeCar(game, 'sedan', -47.0, -232, Math.PI, 0, 0xe8e2d4);
      // Pedestrians on the two sidewalks, never in the road.
      for (let i = 0; i < 8; i++) {
        spawnPed(game.peds, i % 2 ? -55.5 : -34.5, -112 - i * 12);
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
