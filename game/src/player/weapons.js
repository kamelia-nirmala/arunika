// Shooting on foot: hitscan against gangs and police, with ammo, reload,
// spread, and recoil. Driving + shooting is out of scope — get out and fight.
import * as THREE from 'three';
import { WEAPONS } from '../config.js';
import { clamp } from '../random.js';

export function createWeapons() {
  return { current: 'pistol', lastShot: 0, reloading: 0, recoil: 0, tracers: [], impacts: [] };
}
export function switchWeapon(w, player) {
  const order = ['pistol', 'shotgun', 'smg'];
  const i = (order.indexOf(w.current) + 1) % order.length;
  w.current = order[i];
  w.reloading = 0;
}
export function startReload(w, player) {
  const spec = WEAPONS[w.current];
  if (w.reloading > 0 || player.ammo[w.current] >= spec.mag) return;
  if (player.reserve[w.current] <= 0) return;
  w.reloading = spec.reload;
}
// Fade out and remove tracer / impact meshes spawned by fire().
function decayFxList(list, dt, scene) {
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    e.life -= dt;
    if (e.life <= 0) {
      if (scene) scene.remove(e.m);
      e.m.geometry.dispose(); e.m.material.dispose();
      list.splice(i, 1);
    } else if (e.m.material.transparent) {
      e.m.material.opacity = clamp(e.life / e.max, 0, 1) * e.peak;
    }
  }
}
export function updateWeapons(w, dt, player) {
  if (w.reloading > 0) {
    w.reloading -= dt;
    if (w.reloading <= 0) {
      const spec = WEAPONS[w.current];
      const need = spec.mag - player.ammo[w.current];
      const take = Math.min(need, player.reserve[w.current]);
      player.ammo[w.current] += take;
      player.reserve[w.current] -= take;
    }
  }
  w.recoil = Math.max(0, w.recoil - dt * 6);
  w.lastShot -= dt;
  const scene = player.mesh && player.mesh.group ? player.mesh.group.parent : null;
  if (w.tracers) decayFxList(w.tracers, dt, scene);
  if (w.impacts) decayFxList(w.impacts, dt, scene);
}
// A thin glowing line from the muzzle to the shot's end point.
function spawnTracer(w, player, from, to) {
  const scene = player.mesh && player.mesh.group ? player.mesh.group.parent : null;
  if (!scene) return;
  const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (len < 0.5) return;
  const geo = new THREE.BoxGeometry(0.05, 0.05, 1);
  geo.translate(0, 0, 0.5);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffe9a8, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(from);
  m.lookAt(to.x, to.y, to.z);
  m.scale.set(1, 1, len);
  scene.add(m);
  w.tracers.push({ m, life: 0.09, max: 0.09, peak: 0.9 });
}
// A brief spark where a shot lands on a target.
function spawnImpact(w, player, at) {
  const scene = player.mesh && player.mesh.group ? player.mesh.group.parent : null;
  if (!scene) return;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.95 });
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat);
  m.position.set(at.x, at.y, at.z);
  scene.add(m);
  w.impacts.push({ m, life: 0.22, max: 0.22, peak: 0.95 });
}
// fire: aimDir is the camera forward (x, z normalized). Returns 'shot'|'dry'|'reload'|null.
export function fire(w, player, aimDir, gangs, police, fx) {
  const spec = WEAPONS[w.current];
  if (w.reloading > 0 || w.lastShot > 0) return null;
  if (player.ammo[w.current] <= 0) { startReload(w, player); return 'dry'; }
  w.lastShot = 1 / spec.rof;
  player.ammo[w.current]--;
  w.recoil = Math.min(1, w.recoil + 0.35);
  // Hit: nearest gang within range and inside a narrow cone.
  // The aim direction is the camera forward: renormalise its (x, z) part
  // first. Without that, the camera's downward pitch shrinks the dot
  // product (0.975 at the default pitch) below the 0.985 threshold, so a
  // perfectly aimed shot could never hit anything.
  const al = Math.hypot(aimDir.x, aimDir.z) || 1;
  const ax = aimDir.x / al, az = aimDir.z / al;
  let best = null, bd = spec.range;
  for (const g of gangs.list) {
    const dx = g.pos.x - player.pos.x, dz = g.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > spec.range) continue;
    const dot = (dx * ax + dz * az) / (d || 1);
    if (dot > 0.985 && d < bd) { bd = d; best = g; }
  }
  // Muzzle flash AT THE BARREL TIP, not the shoulder: the gun's muzzle
  // anchor (child of the gun, child of the aiming arm) gives the true
  // world position, so the flash follows the hand wherever it points.
  const mv = new THREE.Vector3();
  if (player.mesh && player.mesh.muzzle) player.mesh.muzzle.getWorldPosition(mv);
  else mv.set(player.pos.x + ax * 1.2, player.pos.y + 1.4, player.pos.z + az * 1.2);
  if (fx) fx(mv.x, mv.y, mv.z);
  // Recoil + visible flash on the gun itself (set here so the frame the
  // shot fires on already shows it; stepPlayer decays both afterwards).
  player.recoil = 1;
  player.flashT = 0.06; // gameplay flash stays short (~0.06 s)
  if (player.mesh && player.mesh.flashSprite) {
    const s = 0.75 + Math.random() * 0.3;
    player.mesh.flashSprite.scale.set(s, s, 1);
    player.mesh.flashSprite.material.opacity = 1;
  }
  // Tracer from the barrel tip to the hit point (or max range on a miss),
  // plus a spark where the shot lands.
  const end = best
    ? new THREE.Vector3(best.pos.x, best.pos.y + 1.2, best.pos.z)
    : new THREE.Vector3(mv.x + ax * spec.range, mv.y - spec.range * 0.04, mv.z + az * spec.range);
  spawnTracer(w, player, mv, end);
  if (best) spawnImpact(w, player, end);
  if (best) {
    const killed = best.hp - spec.dmg <= 0;
    best.hp -= spec.dmg;
    if (killed) {
      const i = gangs.list.indexOf(best);
      gangs.scene.remove(best.mesh);
      gangs.list.splice(i, 1);
    }
    return killed ? 'kill' : 'hit';
  }
  return 'shot';
}
