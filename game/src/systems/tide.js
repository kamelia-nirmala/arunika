// Jam Pasang (Tide Clock): one variable that changes the world. High tide
// opens the boat channel; low tide opens the mud shortcut the police cannot
// follow. Two missions only start inside a tide window.
import { TIDE } from '../config.js';
import { clamp } from '../random.js';

export function createTide() {
  return { t: 0.68, elapsed: 0, high: false, low: false, crossed: null };
}
// Tide value 0..1, sinusoidal over TIDE.period seconds. Starts at 0.68:
// sin(0.4115) = 0.4, so 0.5 + 0.45 * 0.4 = 0.68.
export function updateTide(td, dt) {
  td.elapsed += dt;
  const prev = td.t;
  td.t = 0.5 + 0.45 * Math.sin((td.elapsed / TIDE.period) * Math.PI * 2 + 0.4115);
  td.crossed = null;
  if (prev < TIDE.high && td.t >= TIDE.high) td.crossed = 'high';
  if (prev > TIDE.low && td.t <= TIDE.low) td.crossed = 'low';
  td.high = td.t >= TIDE.high;
  td.low = td.t <= TIDE.low;
  return td;
}
export function tidePercent(td) { return Math.round(td.t * 100); }
export function tideRising(td) {
  return Math.cos((td.elapsed / TIDE.period) * Math.PI * 2 + 0.4115) > 0;
}
// Set the tide to an exact value (screenshot staging): pick the elapsed
// time whose sinusoid equals it, so the next update keeps it there.
export function setTide(td, value) {
  const s = clamp((value - 0.5) / 0.45, -1, 1);
  td.elapsed = (Math.asin(s) - 0.4115) * TIDE.period / (Math.PI * 2);
  td.t = value;
  td.high = value >= TIDE.high;
  td.low = value <= TIDE.low;
}
export function tideLabel(td) {
  if (td.t >= TIDE.high) return 'PASANG';
  if (td.t <= TIDE.low) return 'SURUT';
  return 'TENANG';
}
