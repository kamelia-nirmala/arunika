// Police: pursuit cars that chase the player, PIT at ★4+, roadblocks at ★3+,
// and a helicopter at ★4+. Units scale with the wanted level.
//
// ARREST FLOW (R3): a crime only raises the wanted level — it never arrests
// on its own. When a cruiser gets close to an ON-FOOT player it stops and
// its officer(s) get OUT and chase on foot. An arrest happens only when an
// officer stays within ARREST_DIST of the player for ARREST_TIME straight
// (the player can break it by sprinting away). Police only shoot from
// deployed on-foot officers at ★3+, never from inside a moving car.
import * as THREE from 'three';
import { createVehicle, stepVehicle } from '../physics/vehicle.js';
import { clamp, lerp, range } from '../random.js';
import { groundHeight } from '../world/roads.js';
import { resolveCircle } from '../physics/collision.js';

// Arrest tuning: officer run speed sits between the player's walk (4.2) and
// sprint (7.5), so walking away gets you caught but sprinting escapes.
export const ARREST_DIST = 2.6;
export const ARREST_TIME = 3.0;
export const OFFICER_SPEED = 5.2;
export const WARN_DIST = 12;
const DEPLOY_DIST = 22;
const RECALL_DIST = 45;

export function createPolice(scene) {
  // --- Helicopter: built from box primitives, same blocky vernacular as the
  // cars and pedestrians. Forward is -z (the tail boom runs out to +z), so the
  // nose taper, cabin glazing and skids all sit on the -z half. The hull is
  // matte dark on purpose: the cover shot hangs this against a pale golden-hour
  // sky, and a mid-grey body measured ~no contrast there (a signboard, not an
  // aircraft). Reference contract used by updatePolice below: `rotor` is the
  // yaw-spinning main rotor group, `spot` is the searchlight with its target,
  // `heli` is the whole group.
  const heliGeo = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.88, metalness: 0.08 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0e13, roughness: 0.9, metalness: 0.05 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x24435c, roughness: 0.35, metalness: 0.15 });
  const addBox = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    heliGeo.add(m);
    return m;
  };
  // Fuselage: a broad cabin block plus a nose that steps down and narrows, so
  // the front reads as a pointed cockpit rather than a slab end.
  addBox(2.4, 1.6, 4.2, 0, 0, 0.9, hullMat);   // cabin/main body  z -1.2..3.0
  addBox(2.1, 1.35, 1.2, 0, -0.05, -1.5, hullMat); // forward shoulder
  addBox(1.6, 1.05, 1.0, 0, -0.15, -2.5, hullMat); // nose mid
  addBox(1.0, 0.72, 0.8, 0, -0.25, -3.3, hullMat); // nose tip
  addBox(0.42, 0.3, 0.35, 0, -0.34, -3.75, darkMat); // pitot/chine nub
  // Cabin glazing: a dark blue band proud of the hull on both flanks, plus a
  // raked windshield plate between the shoulder and the nose.
  addBox(2.46, 0.62, 2.5, 0, 0.3, 0.1, glassMat);  // side windows band
  addBox(1.55, 0.5, 0.2, 0, 0.42, -1.95, glassMat); // windshield
  // Tail boom, fin, stabiliser, tail rotor.
  const boom = addBox(0.5, 0.5, 4.6, 0, 0.18, 4.9, hullMat); boom.rotation.x = 0.03;
  addBox(0.18, 1.5, 0.95, 0, 0.85, 7.0, hullMat);    // vertical fin
  addBox(1.9, 0.12, 0.55, 0, 0.5, 6.2, darkMat);     // horizontal stabiliser
  addBox(0.12, 1.15, 0.16, 0.34, 0.5, 7.15, darkMat); // tail rotor
  addBox(0.3, 0.3, 0.3, 0.34, 0.5, 7.15, darkMat);   // tail rotor hub
  // Rotor mast + 2-blade main rotor. `rotor` is a Group so updatePolice's
  // `rotation.y += dt * 22` spins the blades, not just a plate.
  addBox(0.3, 0.55, 0.3, 0, 1.0, 0.6, darkMat);      // mast
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.32, 0.6);
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.5), darkMat);
  rotor.add(hub);
  const bladeA = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.1, 0.55), darkMat);
  const bladeB = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 9.4), darkMat);
  for (const b of [bladeA, bladeB]) { b.castShadow = true; rotor.add(b); }
  heliGeo.add(rotor);
  // Landing skids: two long rails on four struts.
  for (const s of [-1, 1]) {
    addBox(0.16, 0.16, 3.4, s * 1.0, -1.22, -0.1, darkMat);
    addBox(0.12, 0.55, 0.12, s * 1.0, -0.95, -1.0, darkMat);
    addBox(0.12, 0.55, 0.12, s * 1.0, -0.95, 0.9, darkMat);
  }
  const spot = new THREE.SpotLight(0xfff2c0, 0, 60, 0.35, 0.4);
  spot.position.set(0, -0.9, -2.0); heliGeo.add(spot);
  heliGeo.add(spot.target);
  heliGeo.visible = false;
  scene.add(heliGeo);
  return { scene, cars: [], heli: heliGeo, rotor, spot, blocks: [], shootT: 0, forceHeli: false,
    // Arrest state, refreshed every update: true only on the frame the
    // arrest completes (the caller consumes it and clears it).
    arrested: false, arrestT: 0, nearestOfficer: Infinity };
}
// Lightbar: red + blue boxes on the roof (exported so a staged cruiser can get one too).
// Each lens gets its own emissive material (NOT the shared cache) because the
// flash below rewrites emissiveIntensity every frame; sharing one material
// would make every cruiser on screen blink in lockstep with the same object.
// The lenses are emissive only — still zero extra lights in the scene.
export function addLightbar(v) {
  // Unmarked staging (createVehicle('police') straight from shots.js or a
  // roadblock) still gets the livery: a cruiser with a bar and no markings
  // reads as a black sedan, which is the fault this pass fixes. Idempotent.
  addCruiserLivery(v);
  const barR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff1505, emissiveIntensity: 0.25, roughness: 0.25 }));
  barR.position.set(-0.4, 1.45, 0);
  const barB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2222ff, emissive: 0x1130ff, emissiveIntensity: 0.25, roughness: 0.25 }));
  barB.position.set(0.4, 1.45, 0);
  v.mesh.group.add(barR, barB);
  v.barR = barR; v.barB = barB;
}
// Door livery: a white panel on each flank with "POLISI" painted on it.
// Painted on canvas the same way world/props.js paints boardFace — no external
// image, no extra light — and mounted on a 2 cm plate so the lettering stands
// proud of the paint instead of z-fighting with it. Idempotent: a cruiser that
// is staged, then reaches updatePolice unchanged, never gets two livery sets.
function liveryPlateFace() {
  // 256x72 canvas for a 1.10 x 0.31 m plate (3.55:1) — bold enough that the
  // word still reads at the 12–20 m the street shot sits at.
  const W = 256, H = 72;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f4f0'; g.fillRect(0, 0, W, H);
  // Blue band along the bottom edge of the door, the way a marked unit carries
  // its livery line; the amber tick at each end keeps it from reading as a
  // blank white rectangle at a distance.
  g.fillStyle = '#1c3f7a'; g.fillRect(0, H - 12, W, 12);
  g.fillStyle = '#f5a623'; g.fillRect(0, H - 12, 10, 12); g.fillRect(W - 10, H - 12, 10, 12);
  g.fillStyle = '#101c2c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 44px Arial, Helvetica, sans-serif';
  g.fillText('POLISI', W / 2, H / 2 - 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}
export function addCruiserLivery(v) {
  if (v.liveryDone) return;
  v.liveryDone = true;
  const spec = v.spec;
  const body = v.mesh.body;
  const face = liveryPlateFace();
  const plateMat = new THREE.MeshStandardMaterial({
    map: face, roughness: 0.72, metalness: 0.05,
    // Faint self-illumination: the door panel is the one bright thing on an
    // otherwise black cruiser at golden hour, and a white panel in shadow
    // alone came back as mid-grey.
    emissive: 0x2a2c2a, emissiveIntensity: 0.55,
  });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f0, roughness: 0.6 });
  // Door band: a white slab down the flank between the bumpers, sitting on the
  // 0.86 m shoulder line, 90 cm high in z so it covers both doors of the sedan
  // body. Sunk 1 cm into the paint so no daylight shows under it.
  for (const s of [-1, 1]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 2.0), whiteMat);
    band.position.set(s * (spec.wid / 2 - 0.02), 0.66, -spec.len * 0.02);
    body.add(band);
    // Marking plate on the front door, 1.5 cm proud of the white band. Yaw
    // ±90° puts the plate's own +x on the viewer's right from either flank, so
    // the word reads left-to-right on both sides.
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.10, 0.31), plateMat);
    plate.position.set(s * (spec.wid / 2 + 0.035), 0.66, spec.len * 0.06);
    plate.rotation.y = s * Math.PI / 2;
    body.add(plate);
  }
}
// On-foot officer: navy uniform, cap, visible at a distance so the player
// can see the arrest coming — same box-figure style as pedestrians.
function buildOfficerMesh() {
  const g = new THREE.Group();
  const navy = new THREE.MeshStandardMaterial({ color: 0x1c2f4a, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d5f, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3), navy);
  torso.position.y = 1.15; torso.castShadow = true; g.add(torso);
  // Contrast for a 1.8 m figure seen from 15-25 m at golden hour: a bright
  // reflective vest band across the chest and a hi-vis stripe down each
  // shoulder. Emissive-but-low, so the vest stays a pale lime rather than a
  // lamp; the uniform underneath stays navy. These are the only two bright
  // marks on the figure, which is what makes the silhouette read as police.
  const hiVis = new THREE.MeshStandardMaterial({
    color: 0xd9f24a, emissive: 0x8ea32a, emissiveIntensity: 0.5, roughness: 0.5,
  });
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.20, 0.33), hiVis);
  vest.position.y = 1.26; g.add(vest);
  for (const s of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.62, 0.32), hiVis);
    strap.position.set(s * 0.19, 1.17, 0); g.add(strap);
  }
  // Reflective silver line just under the vest, the second read at distance.
  const flash = new THREE.Mesh(new THREE.BoxGeometry(0.575, 0.055, 0.335),
    new THREE.MeshStandardMaterial({ color: 0xdfe6ea, emissive: 0x9fb0b8, emissiveIntensity: 0.9, roughness: 0.3 }));
  flash.position.y = 1.09; g.add(flash);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.1, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x0e1a22, roughness: 0.7 }));
  belt.position.y = 0.82; g.add(belt);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.3), skin);
  head.position.y = 1.7; g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x0e1a22, roughness: 0.6 }));
  cap.position.y = 1.9; g.add(cap);
  // Bright cap band: a pale rim round the crown, so the head separates from a
  // dark backdrop and the cap reads as a uniform cap, not a black box.
  const capBand = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.055, 0.38),
    new THREE.MeshStandardMaterial({ color: 0xe8eef0, emissive: 0x8d9aa0, emissiveIntensity: 0.55, roughness: 0.45 }));
  capBand.position.y = 1.945; g.add(capBand);
  // Peaked visor on the front (-z is the figure's forward here: updatePolice
  // sets rotation.y = atan2(dx, dz), so +z faces the target — a visor on the
  // face side is +z).
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x080e14, roughness: 0.55 }));
  visor.position.set(0, 1.855, 0.23); g.add(visor);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.2), navy);
    leg.position.set(s * 0.13, 0.38, 0); g.add(leg); legs.push(leg);
  }
  return { group: g, legs };
}
function spawnOfficer(pol, unit) {
  const v = unit.v;
  const m = buildOfficerMesh();
  // Step out of the driver's side, clear of the car body.
  const sx = Math.cos(v.heading), sz = -Math.sin(v.heading);
  const pos = new THREE.Vector3(v.pos.x + sx * 2.2, 0, v.pos.z + sz * 2.2);
  resolveCircle(pos, 0.4);
  m.group.position.set(pos.x, groundHeight(pos.x, pos.z, 0.5), pos.z);
  pol.scene.add(m.group);
  const o = { mesh: m, pos, heading: v.heading, closeT: 0, unit };
  unit.officers.push(o);
  return o;
}
function removeOfficer(pol, unit, o) {
  pol.scene.remove(o.mesh.group);
  const i = unit.officers.indexOf(o);
  if (i >= 0) unit.officers.splice(i, 1);
}
// Remove every police car and on-foot officer (game reset). Also clears the
// arrest state so a fresh game never starts already-arrested.
export function clearPolice(pol) {
  for (const u of pol.cars) {
    for (const o of [...(u.officers || [])]) removeOfficer(pol, u, o);
    pol.scene.remove(u.v.mesh.group);
  }
  for (const b of pol.blocks) pol.scene.remove(b.mesh.group);
  pol.cars.length = 0; pol.blocks.length = 0;
  pol.arrested = false; pol.arrestT = 0; pol.nearestOfficer = Infinity; pol.shootT = 0;
}
function spawnUnit(pol, player, stars) {
  const a = Math.random() * Math.PI * 2;
  const d = 120;
  const x = player.pos.x + Math.sin(a) * d, z = player.pos.z + Math.cos(a) * d;
  const v = createVehicle('police', x, z, 0, 0x1a1a1a);
  addLightbar(v);
  addCruiserLivery(v);
  pol.scene.add(v.mesh.group);
  pol.cars.push({ v, stuck: 0, officers: [] });
}
export function updatePolice(pol, dt, player, stars, time) {
  const want = stars === 0 ? 0 : stars === 1 ? 0 : stars + 1; // ★2: 2 cars ... ★5: 6 cars
  while (pol.cars.length < want) spawnUnit(pol, player, stars);
  while (pol.cars.length > want) {
    const u = pol.cars.pop();
    for (const o of [...(u.officers || [])]) removeOfficer(pol, u, o);
    pol.scene.remove(u.v.mesh.group);
  }
  // Roadblocks at ★3+: two parked units across the player's road, ahead.
  if (stars >= 3 && pol.blocks.length === 0 && player.mode === 'driving') {
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    for (const s of [-1, 1]) {
      const v = createVehicle('police', player.pos.x + fx * 60 + -fz * s * 3,
        player.pos.z + fz * 60 + fx * s * 3, player.heading + Math.PI / 2, 0x1a1a1a);
      pol.scene.add(v.mesh.group);
      pol.blocks.push(v);
    }
  }
  if (stars < 3) {
    for (const b of pol.blocks) pol.scene.remove(b.mesh.group);
    pol.blocks.length = 0;
  }
  pol.arrestT = 0;
  pol.nearestOfficer = Infinity;
  const onFoot = player.mode === 'foot';
  for (const u of pol.cars) {
    if (!u.officers) u.officers = []; // units staged by shots/tests may lack it
    const v = u.v;
    // Pursuit: aim at the player, lead by half their velocity.
    const tx = player.pos.x + Math.sin(player.heading) * (player.speed || 0) * 0.5;
    const tz = player.pos.z + Math.cos(player.heading) * (player.speed || 0) * 0.5;
    const want = Math.atan2(tx - v.pos.x, tz - v.pos.z);
    let dh = want - v.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const d = Math.hypot(tx - v.pos.x, tz - v.pos.z);
    const inp = {
      throttle: d > 8 ? 1 : 0.3, steer: clamp(-dh * 1.6, -1, 1),
      brake: d < 5, hand: false, surface: 'road',
    };
    // PIT at ★4+: ram the player's rear quarter when alongside.
    if (stars >= 4 && d < 7) inp.steer = clamp(-dh * 2.2, -1, 1);
    // Near an on-foot player the cruiser stops so its officer can get out
    // and chase on foot — police do not arrest (or shoot) from the car.
    // The car stays parked while its officer is out; it resumes the chase
    // only if the player drives away or the officer is recalled.
    const stoppedForArrest = onFoot && d < 25;
    if (stoppedForArrest) { inp.throttle = 0; inp.brake = true; }
    stepVehicle(v, inp, dt, 0.5);
    // Flash the lightbar (spawned units carry barR/barB; a staged cruiser may not).
    // Rhythm: 5 beats a second, each beat a short hot strobe then a dark tail,
    // and the lenses swap owner every beat — a clear red/blue alternation that
    // still reads from across a boulevard. Arrest logic is untouched.
    if (v.barR && v.barB) {
      const ph = time * 5;
      const on = Math.floor(ph) % 2 === 0;      // false → blue owns this beat
      const strobe = (ph % 1) < 0.5 ? 1 : 0.18; // hot half, dim tail
      const HOT = 4.2, DIM = 0.12;
      v.barR.material.emissiveIntensity = on ? HOT * strobe : DIM;
      v.barB.material.emissiveIntensity = on ? DIM : HOT * strobe;
    }
    // Deploy: car close to an on-foot player and slow (or already right on
    // top of them while braking hard) — officer steps out and chases.
    const maxOff = stars >= 4 ? 2 : 1;
    const dAfter = Math.hypot(v.pos.x - player.pos.x, v.pos.z - player.pos.z);
    if (onFoot && dAfter < DEPLOY_DIST && u.officers.length < maxOff &&
        (Math.abs(v.speed) < 5 || dAfter < 8)) {
      spawnOfficer(pol, u);
    }
    // Officers: chase on foot, track the arrest timer, recall if the player
    // drives away or gets far.
    for (const o of [...u.officers]) {
      const od = Math.hypot(o.pos.x - player.pos.x, o.pos.z - player.pos.z);
      if (!onFoot || od > RECALL_DIST) { removeOfficer(pol, u, o); continue; }
      const dx = player.pos.x - o.pos.x, dz = player.pos.z - o.pos.z;
      const len = od || 1;
      o.pos.x += (dx / len) * OFFICER_SPEED * dt;
      o.pos.z += (dz / len) * OFFICER_SPEED * dt;
      o.heading = Math.atan2(dx, dz);
      resolveCircle(o.pos, 0.4);
      o.mesh.group.position.set(o.pos.x, groundHeight(o.pos.x, o.pos.z, 0.5), o.pos.z);
      o.mesh.group.rotation.y = o.heading;
      const swing = Math.sin(time * 11 + o.pos.x) * 0.45;
      o.mesh.legs[0].rotation.x = swing; o.mesh.legs[1].rotation.x = -swing;
      const odAfter = Math.hypot(o.pos.x - player.pos.x, o.pos.z - player.pos.z);
      // Arrest: the officer must STAY close for ARREST_TIME straight.
      // Breaking away drains the timer twice as fast as it builds.
      if (odAfter < ARREST_DIST) o.closeT += dt;
      else o.closeT = Math.max(0, o.closeT - dt * 2);
      pol.arrestT = Math.max(pol.arrestT, o.closeT);
      pol.nearestOfficer = Math.min(pol.nearestOfficer, odAfter);
      if (o.closeT >= ARREST_TIME) pol.arrested = true;
    }
  }
  // Helicopter at ★4+ (or forced for the cover shot): hovers 90 m above the player.
  const heliOn = stars >= 4 || pol.forceHeli;
  pol.heli.visible = heliOn;
  if (heliOn) {
    // A staged (forced) helicopter keeps its staged position; a live one hovers over the player.
    if (!pol.forceHeli) pol.heli.position.set(player.pos.x + 12, 90, player.pos.z + 8);
    pol.rotor.rotation.y += dt * 22;
    pol.spot.target.position.set(player.pos.x, 0, player.pos.z);
    pol.spot.intensity = 900;
  } else pol.spot.intensity = 0;
  // Police fire at ★3+ within 40 m — ONLY from a deployed on-foot officer,
  // never from inside a car: 18 damage per hit, one shot per 1.5 s.
  pol.shootT -= dt;
  if (stars >= 3 && pol.shootT <= 0 && pol.nearestOfficer < 40) {
    // Report the hit; the caller applies the damage once via damagePlayer.
    // (Subtracting health here too dealt 36 per shot instead of 18.)
    pol.shootT = 1.5;
    return true;
  }
  return false;
}
export function policeHeat(pol) { return pol.cars.length; }
