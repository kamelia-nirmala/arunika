// HUD: objective card, wanted stars, tide tube, speedometer, health/armor,
// money, clock, radio, ammo, and toasts. All DOM — cheap and always legible.
//
// One rule the whole panel set obeys: every element shows data the game
// already carries (missions.obj / job.objectives, wanted.stars, car.damage,
// weapons.current, player.ammo). Nothing here invents a stat, and no element
// is positioned where another one already lives — minimap bottom-left,
// vitals beside it, equipment + speed bottom-right, mission + wanted top.
import { ARREST_TIME } from '../ai/police.js';
const $ = (id) => document.getElementById(id);
let els = null;
export function bindHud() {
  els = {
    objTitle: $('obj-title'), objText: $('obj-text'), objDist: $('obj-dist'),
    objStep: $('obj-step'), objNext: $('obj-next'),
    stars: $('stars'), tideFill: $('tide-fill'), tidePct: $('tide-pct'),
    tideLabel: $('tide-label'), tideArrow: $('tide-arrow'),
    speedNum: $('speed-num'), speedGear: $('speed-gear'),
    healthFill: $('health-fill'), armorFill: $('armor-fill'),
    healthNum: $('health-num'), armorNum: $('armor-num'),
    carCond: $('car-cond'), carFill: $('car-fill'), carLabel: $('car-label'),
    money: $('money'), clock: $('clock'), radio: $('radio-name'),
    weapon: $('weapon-name'), ammo: $('ammo'), toast: $('toast'), fps: $('fps'),
    enterPrompt: $('enter-prompt'),
  };
}
function starStr(n) {
  let s = '';
  for (let i = 0; i < 5; i++) s += i < n ? '★' : '☆';
  return s;
}
export function updateHud(g, dt) {
  if (!els) return;
  const p = g.player;
  const job = g.missions.job;
  const o = job ? job.objectives[g.missions.obj] : null;
  if (job && o) {
    els.objTitle.textContent = job.title.toUpperCase();
    els.objText.textContent = o.text;
    // Step counter: which link of the chain is live right now.
    els.objStep.textContent = (g.missions.obj + 1) + '/' + job.objectives.length;
    els.objStep.style.display = '';
    const d = Math.round(Math.hypot(p.pos.x - o.x, p.pos.z - o.z));
    els.objDist.textContent = d + ' m';
    els.objNext.classList.add('hide');
  } else {
    els.objTitle.textContent = 'ARUNIKA';
    els.objText.textContent = g.missions.available <= 9
      ? 'Cari pekerjaan — misi berikutnya siap' : 'Semua misi selesai. Kota ini milikmu.';
    els.objDist.textContent = '';
    els.objStep.style.display = 'none';
    // The J hint only reads as a key prompt when there is a job to start.
    els.objNext.classList.toggle('hide', g.missions.available > 9);
  }
  els.stars.textContent = starStr(g.wanted.stars);
  els.stars.classList.toggle('hot', g.wanted.stars > 0);
  const pct = Math.round(g.tide.t * 100);
  els.tideFill.style.height = pct + '%';
  els.tidePct.textContent = pct + '%';
  // A live chase never reads TENANG: the 0.35–0.75 slack band is exactly where
  // a mid tide sits, and "calm water" under three wanted stars is a lie. While
  // wanted is up the word splits at the midpoint instead; with no wanted the
  // original near/far thresholds stand.
  els.tideLabel.textContent = g.wanted.stars > 0
    ? (g.tide.t >= 0.5 ? 'PASANG' : 'SURUT')
    : g.tide.t >= 0.75 ? 'PASANG' : g.tide.t <= 0.35 ? 'SURUT' : 'TENANG';
  els.tideArrow.textContent = g.tideRising ? '▲' : '▼';
  const kmh = Math.round((p.mode === 'driving' && p.car ? Math.abs(p.car.speed) : p.speed) * 3.6);
  els.speedNum.textContent = kmh;
  els.speedGear.textContent = p.mode === 'driving' ? (kmh > 120 ? '5' : kmh > 80 ? '4' : kmh > 40 ? '3' : kmh > 10 ? '2' : '1') : '—';
  const hp = Math.round(Math.max(0, p.health)), ar = Math.round(Math.max(0, p.armor));
  els.healthFill.style.width = hp + '%';
  els.armorFill.style.width = ar + '%';
  els.healthNum.textContent = hp;
  els.armorNum.textContent = ar;
  // Car condition: car.damage is 0..100, so 100 - damage is the condition the
  // player reads. Only shown while a car is actually being driven.
  const car = p.mode === 'driving' ? p.car : null;
  if (car) {
    const cond = Math.max(0, Math.min(100, Math.round(100 - car.damage)));
    els.carCond.classList.remove('hide');
    els.carFill.style.width = cond + '%';
    els.carFill.style.background = cond < 30 ? '#e0453a' : cond < 60 ? '#f5a623' : '#2fd3c4';
    els.carLabel.textContent = cond + '%';
  } else {
    els.carCond.classList.add('hide');
  }
  els.money.textContent = 'Rp ' + g.economy.money.toLocaleString('id-ID');
  const h = Math.floor(g.hour), m = Math.floor((g.hour - h) * 60);
  els.clock.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  els.radio.textContent = g.radioName || 'OMBAK FM 88.4';
  const w = g.weapons.current;
  els.weapon.textContent = g.weapons ? { pistol: 'KOBRA-9', shotgun: 'BANDOT-12', smg: 'TAWON-45' }[w] : '';
  els.ammo.textContent = p.ammo[w] + ' / ' + p.reserve[w];
  if (g.fps) els.fps.textContent = Math.round(g.fps) + ' fps';
  // "TEKAN E" prompt: on foot and a live car is within enter range.
  // Re-asserted every HUD tick so it hides the moment the player walks away.
  if (els.enterPrompt) {
    els.enterPrompt.classList.toggle('show',
      g.state === 'play' && p.mode === 'foot' && !!p.nearCar);
  }
  // Arrest warning: an officer is closing in on foot. While one is within
  // arrest range the countdown shows how long the player has left to flee.
  // Re-asserted every HUD tick so it stays up until the danger passes.
  const pol = g.police;
  if (g.state === 'play' && pol && isFinite(pol.nearestOfficer) && pol.nearestOfficer <= 12) {
    els.toast.textContent = pol.arrestT > 0
      ? `POLISI MENDEKAT — KABUR! ${Math.ceil(Math.max(0, ARREST_TIME - pol.arrestT))}`
      : 'POLISI MENDEKAT — KABUR!';
    els.toast.classList.add('show');
  }
}
let toastT = null;
export function toast(text, ms = 3500) {
  if (!els) return;
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => els.toast.classList.remove('show'), ms);
}
