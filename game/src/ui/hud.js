// HUD: objective card, wanted stars, tide tube, speedometer, health/armor,
// money, clock, radio, ammo, and toasts. All DOM — cheap and always legible.
import { ARREST_TIME } from '../ai/police.js';
const $ = (id) => document.getElementById(id);
let els = null;
export function bindHud() {
  els = {
    objTitle: $('obj-title'), objText: $('obj-text'), objDist: $('obj-dist'),
    stars: $('stars'), tideFill: $('tide-fill'), tidePct: $('tide-pct'),
    tideLabel: $('tide-label'), tideArrow: $('tide-arrow'),
    speedNum: $('speed-num'), speedGear: $('speed-gear'),
    healthFill: $('health-fill'), armorFill: $('armor-fill'),
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
  const o = g.missions.job ? g.missions.job.objectives[g.missions.obj] : null;
  if (g.missions.job && o) {
    els.objTitle.textContent = g.missions.job.title.toUpperCase();
    els.objText.textContent = o.text;
    const d = Math.round(Math.hypot(p.pos.x - o.x, p.pos.z - o.z));
    els.objDist.textContent = d + ' m';
  } else {
    els.objTitle.textContent = 'ARUNIKA';
    els.objText.textContent = g.missions.available <= 9
      ? 'Cari pekerjaan — tekan J untuk misi berikutnya'
      : 'Semua misi selesai. Kota ini milikmu.';
    els.objDist.textContent = '';
  }
  els.stars.textContent = starStr(g.wanted.stars);
  els.stars.style.color = g.wanted.stars > 0 ? '#e0453a' : '#ede6d6';
  const pct = Math.round(g.tide.t * 100);
  els.tideFill.style.height = pct + '%';
  els.tidePct.textContent = pct + '%';
  els.tideLabel.textContent = g.tide.t >= 0.75 ? 'PASANG' : g.tide.t <= 0.35 ? 'SURUT' : 'TENANG';
  els.tideArrow.textContent = g.tideRising ? '▲' : '▼';
  const kmh = Math.round((p.mode === 'driving' && p.car ? Math.abs(p.car.speed) : p.speed) * 3.6);
  els.speedNum.textContent = kmh;
  els.speedGear.textContent = p.mode === 'driving' ? (kmh > 120 ? '5' : kmh > 80 ? '4' : kmh > 40 ? '3' : kmh > 10 ? '2' : '1') : '—';
  els.healthFill.style.width = Math.max(0, p.health) + '%';
  els.armorFill.style.width = Math.max(0, p.armor) + '%';
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
