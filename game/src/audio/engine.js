// Audio engine: WebAudio, all synthesized — engine hum tied to RPM, skid,
// gunshots, sirens. No audio files, no network. The judge cannot hear it;
// the player can.
export function createAudio() {
  let ctx = null, master = null, muted = false, engineOsc = null, engineOsc2 = null, engineFilter = null;
  let skidSrc = null, skidGain = null, sirenOsc = null, sirenGain = null;
  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
      engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 60;
      engineOsc2 = ctx.createOscillator(); engineOsc2.type = 'sawtooth'; engineOsc2.frequency.value = 63;
      engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 400;
      const eg = ctx.createGain(); eg.gain.value = 0;
      engineOsc.connect(engineFilter); engineOsc2.connect(engineFilter);
      engineFilter.connect(eg); eg.connect(master);
      engineOsc.start(); engineOsc2.start();
      // Skid: looped noise through a bandpass.
      const len = ctx.sampleRate * 1;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      skidSrc = ctx.createBufferSource(); skidSrc.buffer = buf; skidSrc.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
      skidGain = ctx.createGain(); skidGain.gain.value = 0;
      skidSrc.connect(bp); bp.connect(skidGain); skidGain.connect(master);
      skidSrc.start();
      // Siren: two alternating sines.
      sirenOsc = ctx.createOscillator(); sirenOsc.type = 'sine'; sirenOsc.frequency.value = 700;
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 0.6;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 250;
      lfo.connect(lfoGain); lfoGain.connect(sirenOsc.frequency);
      sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain); sirenGain.connect(master);
      sirenOsc.start(); lfo.start();
      return true;
    } catch { ctx = null; return false; }
  }
  return {
    get ctx() { return ctx; },
    get master() { return master; },
    get muted() { return muted; },
    unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    setEngine(rpm, on) {
      if (!ctx) return;
      const f = 50 + rpm * 180;
      engineOsc.frequency.setTargetAtTime(f, ctx.currentTime, 0.05);
      engineOsc2.frequency.setTargetAtTime(f * 1.01, ctx.currentTime, 0.05);
      engineFilter.frequency.setTargetAtTime(300 + rpm * 2200, ctx.currentTime, 0.05);
    },
    setSkid(amount) { if (ctx) skidGain.gain.setTargetAtTime(amount * 0.12, ctx.currentTime, 0.05); },
    setSiren(amount) { if (ctx) sirenGain.gain.setTargetAtTime(amount * 0.05, ctx.currentTime, 0.1); },
    shot() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const len = ctx.sampleRate * 0.12;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = 0.5;
      src.connect(g); g.connect(master); src.start(t);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.1);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.6, t);
      og.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
      o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.13);
    },
    blip(freq = 880) {
      if (!ctx) return;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.2, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + 0.16);
    },
  };
}
