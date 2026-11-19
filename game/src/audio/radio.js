// Radio: three procedural stations, each a tiny step sequencer (kick, bass,
// lead) in a different style. OMBAK FM 88.4 is the default.
const STATIONS = [
  { name: 'OMBAK FM 88.4', bpm: 96, wave: 'square', scale: [0, 3, 5, 7, 10],
    root: 110, kick: [1, 0, 0, 1, 0, 0, 1, 0], bass: [0, 0, 3, 0, 5, 0, 3, 7] },
  { name: 'RELAY 101.7', bpm: 118, wave: 'sawtooth', scale: [0, 2, 3, 7, 8],
    root: 98, kick: [1, 0, 1, 0, 1, 0, 1, 0], bass: [0, 0, 0, 3, 0, 0, 5, 3] },
  { name: 'KARAT AM 630', bpm: 72, wave: 'triangle', scale: [0, 2, 4, 7, 9],
    root: 131, kick: [1, 0, 0, 0, 0, 0, 1, 0], bass: [0, 7, 0, 5, 0, 3, 0, 2] },
];
export function createRadio(audio) {
  return { audio, station: 0, step: 0, nextT: 0, on: false };
}
function noteFreq(root, scale, degree) {
  const oct = Math.floor(degree / scale.length);
  const st = scale[((degree % scale.length) + scale.length) % scale.length];
  return root * Math.pow(2, (oct * 12 + st) / 12);
}
export function radioTick(r, ctx, master, now) {
  if (!r.on || !ctx) return;
  // If the tab was hidden, rAF stopped and nextT fell far behind: snap it
  // to now instead of scheduling hundreds of missed notes at once.
  if (r.nextT < now - 0.5) r.nextT = now;
  const st = STATIONS[r.station];
  const stepDur = 60 / st.bpm / 2;
  while (r.nextT < now + 0.15) {
    const s = r.step % 8;
    if (st.kick[s]) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(120, r.nextT);
      o.frequency.exponentialRampToValueAtTime(40, r.nextT + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, r.nextT);
      g.gain.exponentialRampToValueAtTime(0.01, r.nextT + 0.14);
      o.connect(g); g.connect(master); o.start(r.nextT); o.stop(r.nextT + 0.15);
    }
    const deg = st.bass[s];
    if (deg !== undefined) {
      const o = ctx.createOscillator(); o.type = st.wave;
      o.frequency.value = noteFreq(st.root, st.scale, deg);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, r.nextT);
      g.gain.exponentialRampToValueAtTime(0.01, r.nextT + stepDur);
      o.connect(g); g.connect(master); o.start(r.nextT); o.stop(r.nextT + stepDur);
    }
    r.step++;
    r.nextT += stepDur;
  }
}
export function radioName(r) { return STATIONS[r.station].name; }
export function nextStation(r) {
  r.station = (r.station + 1) % STATIONS.length;
  r.step = 0;
  return STATIONS[r.station].name;
}
