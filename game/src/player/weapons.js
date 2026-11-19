// Shooting on foot: hitscan against gangs and police, with ammo, reload,
// spread, and recoil. Driving + shooting is out of scope — get out and fight.
import { WEAPONS } from '../config.js';
import { clamp } from '../random.js';

export function createWeapons() {
  return { current: 'pistol', lastShot: 0, reloading: 0, recoil: 0 };
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
}
// fire: aimDir is the camera forward (x, z normalized). Returns 'shot'|'dry'|'reload'|null.
export function fire(w, player, aimDir, gangs, police, fx) {
  const spec = WEAPONS[w.current];
  if (w.reloading > 0 || w.lastShot > 0) return null;
  if (player.ammo[w.current] <= 0) { startReload(w, player); return 'dry'; }
  w.lastShot = 1 / spec.rof;
  player.ammo[w.current]--;
  w.recoil = Math.min(1, w.recoil + 0.35);
  // Muzzle flash at the player's shoulder.
  const mx = player.pos.x + aimDir.x * 1.2, mz = player.pos.z + aimDir.z * 1.2;
  if (fx) fx(mx, player.pos.y + 1.4, mz);
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
