// Wanted: heat points from crimes, star thresholds, and the cooldown that
// lets the player slip away — break line of sight, then stars bleed off.
import { WANTED } from '../config.js';
import { clamp } from '../random.js';

export function createWanted() {
  return { heat: 0, stars: 0, losT: 0, coolT: 0 };
}
export function addHeat(w, n) {
  w.heat = Math.min(200, w.heat + n);
  w.losT = 0;
}
export function starsFor(heat) {
  let s = 0;
  for (let i = 0; i < WANTED.thresholds.length; i++) if (heat >= WANTED.thresholds[i]) s = i + 1;
  return s;
}
// policeNear: any police unit within 60 m. dt seconds passed.
export function updateWanted(w, dt, policeNear) {
  const before = w.stars;
  w.stars = starsFor(w.heat);
  if (!policeNear && w.stars > 0) {
    w.losT += dt;
    if (w.losT > WANTED.losBreak * w.stars) {
      w.coolT += dt;
      if (w.coolT >= 12) {
        w.coolT = 0;
        w.heat = Math.max(0, w.heat - 20);
        w.stars = starsFor(w.heat);
        w.losT = 0;
      }
    }
  } else w.coolT = 0;
  return w.stars !== before;
}
// Pay off the heat at a hideout: 250 x stars^2, instant, not while police are close.
export function payoffCost(stars) { return 250 * stars * stars; }
export function tryPayoff(w, money, policeNear) {
  const cost = payoffCost(w.stars);
  if (w.stars === 0 || policeNear || money < cost) return { ok: false, cost };
  w.heat = 0; w.stars = 0; w.losT = 0;
  return { ok: true, cost };
}
