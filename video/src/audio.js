// The soundtrack: an original score and its sound effects, synthesised in an OfflineAudioContext.
// No samples: the piano is additive (inharmonic partials, two detuned strings per note, a hammer),
// the guitar is a Karplus–Strong plucked string, the strings are detuned ensembles with their own
// vibrato, and the drum kit is synthesised piece by piece. Timing and velocity are humanised from a
// seeded generator, so every render is identical. Music time runs at 120 BPM: a beat is 0.5 s.

const BEAT = 0.5;
const BAR = 2;
const STEP = BEAT / 4;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Voicings as MIDI notes.
const CHORDS = {
  Am: [57, 60, 64, 71], F: [53, 57, 60, 64], Dm: [50, 57, 60, 65], E: [52, 56, 59, 64],
  C: [48, 55, 60, 64], G: [55, 59, 62, 69], Fmaj9: [53, 57, 64, 67],
};
const ROOT = { Am: 45, F: 41, Dm: 38, E: 40, C: 36, G: 43, Fmaj9: 41 };
const HERO = ['Am', 'G', 'F', 'C', 'G'];
const CLOUD = ['C', 'G', 'Am'];
const PROBLEM = ['Am', 'F', 'Dm', 'E'];
const GROOVE = ['F', 'C', 'G', 'Am'];

// The hook, as [beat, note, beats] per bar, over F C G Am. Phrase A asks, phrase B answers.
const HOOK_A = [
  [[0, 72, 1.5], [1.5, 69, 0.5], [2, 72, 1], [3, 74, 1]],
  [[0, 76, 2.5], [2.5, 74, 0.5], [3, 72, 1]],
  [[0, 74, 1.5], [1.5, 71, 0.5], [2, 74, 1], [3, 79, 1]],
  [[0, 76, 3], [3, 74, 0.5], [3.5, 72, 0.5]],
];
const HOOK_B = [
  [[0, 81, 1.5], [1.5, 79, 0.5], [2, 77, 1], [3, 76, 1]],
  [[0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 2]],
  [[0, 74, 1], [1, 76, 1], [2, 79, 1.5], [3.5, 76, 0.5]],
  [[0, 76, 4]],
];

// Drum patterns on a 16-step bar: [step, velocity].
const BEATS = {
  // The drops: a syncopated pop groove with ghost notes and an open hat.
  drop: {
    kick: [[0, 1], [6, 0.8], [8, 0.95], [11, 0.6]],
    snare: [[4, 1], [7, 0.18], [12, 1], [15, 0.22]],
    clap: [[4, 0.7], [12, 0.7]],
    hat: [[0, 0.7], [2, 0.5], [3, 0.25], [4, 0.6], [6, 0.5], [8, 0.7], [10, 0.5], [11, 0.25], [12, 0.6]],
    open: [[14, 0.6]],
  },
  // The hero after the hit: kick, rimshot and eighth hats.
  hero: {
    kick: [[0, 0.85], [7, 0.5], [8, 0.75]],
    rim: [[12, 0.7]],
    hat: [[0, 0.5], [2, 0.35], [4, 0.45], [6, 0.35], [8, 0.5], [10, 0.35], [12, 0.45], [14, 0.4]],
  },
  // NEAR AI Cloud: half time.
  half: {
    kick: [[0, 0.95], [3, 0.4], [10, 0.7]],
    snare: [[8, 0.9], [15, 0.15]],
    hat: [[0, 0.55], [2, 0.4], [4, 0.5], [5, 0.2], [6, 0.4], [8, 0.55], [10, 0.4], [12, 0.5], [13, 0.2], [14, 0.4]],
  },
  // The gap: a nervous rimshot and closed hats, no kick yet.
  tense: {
    rim: [[4, 0.55], [12, 0.55], [14, 0.25]],
    hat: [[0, 0.4], [2, 0.3], [3, 0.2], [4, 0.35], [6, 0.3], [8, 0.4], [10, 0.3], [11, 0.2], [12, 0.35], [14, 0.3]],
  },
  // The gap's second half: the kick arrives as a heartbeat.
  heart: {
    kick: [[0, 0.9], [2, 0.5], [8, 0.85]],
    rim: [[4, 0.6], [12, 0.6]],
    hat: [[0, 0.45], [2, 0.35], [4, 0.4], [6, 0.35], [8, 0.45], [10, 0.35], [12, 0.4], [14, 0.35]],
  },
};

// Sections, in music seconds (each on a bar line), matching the picture.
const S = {
  hit: 4, heroBuild: 8, cloud: 10, problem: 16, heart: 20, build: 22, slam1: 24, slam2: 26, drop: 28,
  breakFrom: 46, drop2: 48, proof: 66, finale: 72, end: 78,
};

export async function renderSoundtrack(duration, sfx, sampleRate = 48000) {
  const sr = sampleRate;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sr), sr);
  const R = rng(20261114);
  const hum = (t, amount = 0.007) => t + (R() - 0.5) * 2 * amount;
  const vel = (v, spread = 0.12) => v * (1 - spread + R() * spread * 2);

  const noise = ctx.createBuffer(2, sr * 3, sr);
  for (let c = 0; c < 2; c++) { const d = noise.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1; }

  // ---------- buses ----------
  // Headroom: the mix sits well under the limiter; the final loudness is set when it is muxed.
  const MIX = 0.25;
  const master = ctx.createGain(); master.gain.value = MIX;
  const warmth = ctx.createWaveShaper();
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(1.6 * x) / Math.tanh(1.6); }
  warmth.curve = curve; warmth.oversample = '2x';
  const lowCut = ctx.createBiquadFilter(); lowCut.type = 'highpass'; lowCut.frequency.value = 30; lowCut.Q.value = 0.7;
  const air = ctx.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 15500; air.Q.value = 0.5;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16; glue.ratio.value = 2; glue.knee.value = 12; glue.attack.value = 0.02; glue.release.value = 0.3;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -3; limit.ratio.value = 20; limit.knee.value = 0; limit.attack.value = 0.002; limit.release.value = 0.1;
  master.connect(lowCut).connect(warmth).connect(air).connect(glue).connect(limit).connect(ctx.destination);
  master.gain.setValueAtTime(MIX, 0);
  master.gain.setValueAtTime(MIX, duration - 2.6);
  master.gain.linearRampToValueAtTime(0, duration - 0.05);

  const music = ctx.createGain();
  const duck = ctx.createGain();
  const sweep = ctx.createBiquadFilter(); sweep.type = 'lowpass'; sweep.frequency.value = 18000; sweep.Q.value = 0.7;
  music.connect(duck).connect(sweep).connect(master);
  // Drums get their own glue: a little compression and a touch of room.
  const drums = ctx.createGain(); drums.gain.value = 0.9;
  const kitComp = ctx.createDynamicsCompressor();
  kitComp.threshold.value = -14; kitComp.ratio.value = 3; kitComp.knee.value = 6; kitComp.attack.value = 0.006; kitComp.release.value = 0.12;
  drums.connect(kitComp).connect(master);
  const fx = ctx.createGain(); fx.gain.value = 0.7; fx.connect(master);

  // A hall: early reflections and a long, darkening stereo tail.
  const verb = ctx.createConvolver();
  const irLen = Math.floor(sr * 3.8), ir = ctx.createBuffer(2, irLen, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < irLen; i++) {
      const x = i / irLen;
      const k = 0.15 + 0.8 * x;
      lp += ((R() * 2 - 1) - lp) * (1 - k);
      d[i] = lp * Math.pow(1 - x, 2.6) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
    }
    for (const [ms, g] of [[11, 0.6], [17, 0.45], [23, 0.4], [31, 0.3], [43, 0.22]]) d[Math.floor((ms + c * 3) * sr / 1000)] += g;
  }
  verb.buffer = ir;
  const verbIn = ctx.createGain(); const verbOut = ctx.createGain(); verbOut.gain.value = 0.5;
  const verbHP = ctx.createBiquadFilter(); verbHP.type = 'highpass'; verbHP.frequency.value = 220;
  verbIn.connect(verbHP).connect(verb).connect(verbOut).connect(master);

  const dIn = ctx.createGain();
  const dl = ctx.createDelay(1), dr = ctx.createDelay(1); dl.delayTime.value = 0.375; dr.delayTime.value = 0.375;
  const fb = ctx.createGain(); fb.gain.value = 0.32;
  const dTone = ctx.createBiquadFilter(); dTone.type = 'lowpass'; dTone.frequency.value = 2600;
  const merge = ctx.createChannelMerger(2); const dOut = ctx.createGain(); dOut.gain.value = 0.28;
  dIn.connect(dl); dl.connect(dr); dr.connect(dTone).connect(fb).connect(dl);
  dl.connect(merge, 0, 0); dr.connect(merge, 0, 1); merge.connect(dOut).connect(sweep);
  dOut.connect(verbIn);

  // ---------- helpers ----------
  const send = (node, bus, amount) => { const g = ctx.createGain(); g.gain.value = amount; node.connect(g).connect(bus); };
  const pan = v => { const p = ctx.createStereoPanner(); p.pan.value = v; return p; };
  const noiseSrc = (t, dur) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(Math.max(0, t), R() * 2, dur + 0.05); return s; };
  const osc = (type, f, t, dur, detune = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, Math.max(0, t)); o.detune.value = detune; o.start(Math.max(0, t)); o.stop(t + dur + 0.05); return o; };
  const play = (buffer, t, out) => { const s = ctx.createBufferSource(); s.buffer = buffer; s.connect(out); s.start(Math.max(0, t)); return s; };
  const env = (g, t, peak, decay) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + decay); };

  // ---------- the piano: additive, inharmonic, two strings per note ----------
  const pianoCache = new Map();
  function pianoBuffer(note) {
    if (pianoCache.has(note)) return pianoCache.get(note);
    const f = mtof(note), len = Math.floor(sr * (note < 55 ? 5 : note < 72 ? 4 : 3));
    const buf = ctx.createBuffer(2, len, sr), L = buf.getChannelData(0), Rt = buf.getChannelData(1);
    const B = 0.0003 * Math.pow(2, (note - 60) / 18);
    const tau1 = Math.max(0.7, 4.2 - (note - 36) * 0.055);
    for (let p = 1; p <= 16; p++) {
      const fp = f * p * Math.sqrt(1 + B * p * p);
      if (fp > 11000) break;
      const amp = 1 / Math.pow(p, 1.15) * (p === 1 ? 0.9 : 1);
      const tau = tau1 / (1 + 0.45 * (p - 1));
      for (const sgn of [-1, 1]) {
        const w = (2 * Math.PI * fp * (1 + sgn * 0.00045)) / sr, c2 = 2 * Math.cos(w), ph = R() * Math.PI * 2;
        let y1 = Math.sin(ph - w), y2 = Math.sin(ph - 2 * w), e = amp * 0.5;
        const decay = Math.exp(-1 / (tau * sr)), gl = sgn < 0 ? 0.62 : 0.38, gr = 1 - gl;
        for (let i = 0; i < len; i++) {
          const y = c2 * y1 - y2; y2 = y1; y1 = y;
          const v = y * e; e *= decay;
          L[i] += v * gl; Rt[i] += v * gr;
        }
      }
    }
    let lp = 0;
    const hl = Math.floor(sr * 0.02);
    for (let i = 0; i < hl; i++) { lp += ((R() * 2 - 1) - lp) * 0.08; const k = 0.5 * (1 - i / hl) ** 2; L[i] += lp * k; Rt[i] += lp * k; }
    const att = Math.floor(sr * 0.002);
    let peak = 0;
    for (let i = 0; i < len; i++) { if (i < att) { L[i] *= i / att; Rt[i] *= i / att; } const fade = i > len - sr * 0.3 ? (len - i) / (sr * 0.3) : 1; L[i] *= fade; Rt[i] *= fade; peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rt[i])); }
    for (let i = 0; i < len; i++) { L[i] /= peak; Rt[i] /= peak; }
    pianoCache.set(note, buf);
    return buf;
  }
  function piano(t, note, v = 0.7, dur = 4, p = 0) {
    t = hum(t); v = vel(v);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400 + 7000 * v * v; lp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.3 * Math.pow(v, 1.4);
    g.gain.setValueAtTime(0.3 * Math.pow(v, 1.4), t + dur); g.gain.setTargetAtTime(0, t + dur, 0.25);
    const pn = pan(p + (note - 64) * 0.008);
    play(pianoBuffer(note), t, lp); lp.connect(g).connect(pn).connect(music);
    send(pn, verbIn, 0.32);
  }
  const chordOnPiano = (t, notes, v = 0.5, dur = 2, roll = 0.018) => notes.forEach((n, i) => piano(t + i * roll, n, v * (i === notes.length - 1 ? 1.08 : 0.92), dur));

  // ---------- plucked strings: Karplus–Strong with fractional tuning ----------
  const pluckCache = new Map();
  function pluckBuffer(note) {
    if (pluckCache.has(note)) return pluckCache.get(note);
    const f = mtof(note), len = Math.floor(sr * 2.4), y = new Float32Array(len);
    const N = sr / f - 0.5, Ni = Math.floor(N), frac = N - Ni, a = (1 - frac) / (1 + frac);
    const rho = Math.pow(10, -3 / (2.2 * f));
    let lp = 0;
    const exc = new Float32Array(Ni + 2);
    for (let i = 0; i < Ni + 2; i++) { lp += ((R() * 2 - 1) - lp) * 0.55; exc[i] = lp; }
    const pos = Math.max(1, Math.round(Ni * 0.2));
    for (let i = 0; i < Ni; i++) y[i] = exc[i] - (i >= pos ? exc[i - pos] : 0);
    let apIn = 0, apOut = 0;
    for (let n = Ni; n < len; n++) {
      const avg = 0.5 * (y[n - Ni] + (n - Ni - 1 >= 0 ? y[n - Ni - 1] : 0)) * rho;
      const out = a * avg + apIn - a * apOut; apIn = avg; apOut = out;
      y[n] = out;
    }
    let peak = 0; for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i]));
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (y[i] / peak) * (i > len - sr * 0.2 ? (len - i) / (sr * 0.2) : 1);
    pluckCache.set(note, buf);
    return buf;
  }
  function pluck(t, note, v = 0.6, p = 0, delay = 0.25) {
    t = hum(t, 0.006); v = vel(v, 0.15);
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 220; body.Q.value = 1; body.gain.value = 3;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400 + 4000 * v;
    const g = ctx.createGain(); g.gain.value = 0.2 * v;
    const pn = pan(p);
    play(pluckBuffer(note), t, body); body.connect(lp).connect(g).connect(pn).connect(music);
    send(pn, verbIn, 0.25); if (delay) send(pn, dIn, delay);
  }

  // ---------- strings: detuned ensembles with their own vibrato ----------
  function strings(t, notes, dur, v = 1, bright = 2600, attack = 0.5) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright; lp.Q.value = 0.3;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03 * v, t + attack);
    g.gain.setValueAtTime(0.03 * v, t + dur); g.gain.setTargetAtTime(0, t + dur, 0.35);
    hp.connect(lp).connect(g).connect(music); send(g, verbIn, 0.6);
    notes.forEach((n, i) => {
      for (let k = 0; k < 3; k++) {
        const o = osc('sawtooth', mtof(n), t, dur + 1.6, (k - 1) * 6 + (R() - 0.5) * 4);
        const lfo = osc('sine', 4.6 + R() * 0.9, t - R() * 0.3, dur + 1.8);
        const depth = ctx.createGain(); depth.gain.value = 5 + R() * 4;
        lfo.connect(depth).connect(o.detune);
        o.connect(pan((k - 1) * 0.45 + (i - 1.5) * 0.08)).connect(hp);
      }
    });
  }
  function swell(end, notes, dur, v = 1) {
    const t = end - dur;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(700, t); lp.frequency.exponentialRampToValueAtTime(4200, end);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04 * v, end - 0.02); g.gain.linearRampToValueAtTime(0, end + 0.05);
    lp.connect(g).connect(music); send(g, verbIn, 0.5);
    for (const n of notes) for (let k = 0; k < 3; k++) {
      const o = osc('sawtooth', mtof(n), t, dur + 0.1, (k - 1) * 7);
      const lfo = osc('sine', 5 + R(), t, dur), depth = ctx.createGain(); depth.gain.value = 6; lfo.connect(depth).connect(o.detune);
      o.connect(pan((k - 1) * 0.4)).connect(lp);
    }
  }

  // ---------- bass ----------
  function bass(t, note, dur, v = 0.8) {
    t = hum(t, 0.004); v = vel(v, 0.08);
    const f = mtof(note), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(900 + 500 * v, t); lp.frequency.setTargetAtTime(420, t + 0.01, 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * v, t + 0.006);
    g.gain.setTargetAtTime(0.2 * v, t + 0.02, 0.15); g.gain.setTargetAtTime(0, t + dur, 0.04);
    lp.connect(g).connect(music);
    osc('triangle', f, t, dur + 0.2).connect(lp);
    const sub = osc('sine', f, t, dur + 0.2), sg = ctx.createGain(); sg.gain.value = 0.6; sub.connect(sg).connect(g);
  }

  // ---------- the drum kit ----------
  function kick(t, v = 0.9) {
    v = vel(v, 0.06);
    const o = osc('sine', 150, t, 0.6);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.05); o.frequency.exponentialRampToValueAtTime(45, t + 0.35);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.0 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    // A soft clip on the body gives the kick weight on small speakers.
    const sat = ctx.createWaveShaper(); sat.curve = curve;
    o.connect(sat).connect(g).connect(drums);
    const n = noiseSrc(t, 0.02), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.8;
    const ng = ctx.createGain(); env(ng, t, 0.22 * v, 0.014);
    n.connect(bp).connect(ng).connect(drums);
    duck.gain.setValueAtTime(1, t - 0.002); duck.gain.linearRampToValueAtTime(0.7, t + 0.015); duck.gain.setTargetAtTime(1, t + 0.05, 0.1);
  }
  function snare(t, v = 0.8) {
    t = hum(t, 0.004); v = vel(v);
    const n = noiseSrc(t, 0.3), bp = ctx.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = 1400;
    const g = ctx.createGain(); env(g, t, 0.5 * v, 0.2);
    n.connect(bp).connect(g).connect(pan(0.05)).connect(drums); send(g, verbIn, 0.3 * v);
    for (const [f, a] of [[185, 0.4], [330, 0.18]]) {
      const b = osc('triangle', f * 1.15, t, 0.15); b.frequency.exponentialRampToValueAtTime(f, t + 0.03);
      const bg = ctx.createGain(); env(bg, t, a * v, 0.11); b.connect(bg).connect(drums);
    }
  }
  function clap(t, v = 0.7) {
    t = hum(t, 0.003); v = vel(v);
    const n = noiseSrc(t, 0.3), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    for (const k of [0, 0.01, 0.021]) { g.gain.linearRampToValueAtTime(0.4 * v, t + k + 0.001); g.gain.linearRampToValueAtTime(0.08 * v, t + k + 0.008); }
    g.gain.setTargetAtTime(0, t + 0.03, 0.05);
    n.connect(bp).connect(g).connect(pan(-0.08)).connect(drums); send(g, verbIn, 0.35);
  }
  function rim(t, v = 0.6) {
    t = hum(t, 0.004); v = vel(v);
    const o = osc('triangle', 1700, t, 0.05), g = ctx.createGain(); env(g, t, 0.28 * v, 0.035);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 3;
    o.connect(bp).connect(g).connect(pan(-0.15)).connect(drums); send(g, verbIn, 0.4);
    const n = noiseSrc(t, 0.02), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
    const ng = ctx.createGain(); env(ng, t, 0.12 * v, 0.012); n.connect(hp).connect(ng).connect(drums);
  }
  // Hi-hats the classic way: six detuned square waves at inharmonic ratios, band-passed high.
  function hat(t, v = 0.5, open = false) {
    t = hum(t, 0.005); v = vel(v, 0.18);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain(); env(g, t, (open ? 0.12 : 0.1) * v, open ? 0.32 : 0.05);
    for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) osc('square', 40 * r, t, open ? 0.4 : 0.08).connect(bp);
    bp.connect(hp).connect(g).connect(pan(0.28)).connect(drums);
  }
  function tom(t, note, v = 0.7) {
    t = hum(t, 0.004); v = vel(v);
    const o = osc('sine', mtof(note) * 1.4, t, 0.5); o.frequency.exponentialRampToValueAtTime(mtof(note), t + 0.05);
    const g = ctx.createGain(); env(g, t, 0.55 * v, 0.42);
    o.connect(g).connect(pan((note - 40) * -0.04)).connect(drums); send(g, verbIn, 0.3);
    const n = noiseSrc(t, 0.03), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
    const ng = ctx.createGain(); env(ng, t, 0.12 * v, 0.03); n.connect(lp).connect(ng).connect(drums);
  }
  function crash(t, v = 0.8) {
    const n = noiseSrc(t, 3), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5200;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.13 * v, t); g.gain.setTargetAtTime(0, t + 0.02, 0.7);
    n.connect(hp).connect(g).connect(pan(0.2)).connect(drums); send(g, verbIn, 0.3);
    for (const r of [3.1, 4.7, 6.3, 7.9]) { const o = osc('square', 120 * r, t, 1.4), og = ctx.createGain(); og.gain.setValueAtTime(0.012 * v, t); og.gain.setTargetAtTime(0, t + 0.01, 0.35); o.connect(og).connect(hp); }
  }
  // Play a pattern over bars.
  function groove(from, to, name, v = 1, { skipLastBeat = false } = {}) {
    const pat = BEATS[name];
    for (let t = from; t < to - 0.01; t += BAR) {
      const last = skipLastBeat && t + BAR >= to - 0.01;
      const swing = s => (s % 2 ? 0.022 : 0);
      for (const [s, k] of pat.kick ?? []) if (!(last && s >= 12)) kick(t + s * STEP, k * v);
      for (const [s, k] of pat.snare ?? []) if (!(last && s >= 12)) snare(t + s * STEP + swing(s), k * v);
      for (const [s, k] of pat.clap ?? []) if (!(last && s >= 12)) clap(t + s * STEP, k * v);
      for (const [s, k] of pat.rim ?? []) if (!(last && s >= 12)) rim(t + s * STEP + swing(s), k * v);
      for (const [s, k] of pat.hat ?? []) if (!(last && s >= 12)) hat(t + s * STEP + swing(s), k * v);
      for (const [s, k] of pat.open ?? []) if (!(last && s >= 12)) hat(t + s * STEP, k * v, true);
    }
  }
  // A tom fill over the last beat (or two) before a downbeat.
  function fill(end, beats = 1, v = 0.8) {
    const steps = beats * 4, start = end - beats * BEAT;
    const notes = [50, 50, 47, 47, 45, 45, 41, 41];
    for (let i = 0; i < steps; i++) {
      const n = notes[Math.floor((i / steps) * notes.length)];
      if (i % 4 === 3 && i === steps - 1) snare(start + i * STEP, v);
      else tom(start + i * STEP, n, v * (0.75 + 0.25 * (i / steps)));
    }
  }
  function timpaniRoll(from, to, note = 33) {
    for (let t = from; t < to - 0.01; t += STEP) {
      const p = (t - from) / (to - from);
      const o = osc('sine', mtof(note), t, 0.4), g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1 + 0.4 * p * p, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(drums); send(g, verbIn, 0.3);
    }
  }
  function snareRoll(from, to, top = 0.7) {
    let t = from;
    while (t < to - 0.01) { const p = (t - from) / (to - from); snare(t, 0.15 + top * p * p); t += p < 0.5 ? BEAT / 2 : STEP; }
  }
  function cymbalSwell(end, dur = 1.6, v = 1) {
    const t = end - dur, n = noiseSrc(t, dur);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(2500, t); hp.frequency.exponentialRampToValueAtTime(6500, end);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14 * v, end - 0.01); g.gain.linearRampToValueAtTime(0, end);
    n.connect(hp).connect(g).connect(fx); send(g, verbIn, 0.5);
  }
  // A hit: a deep drum, a cymbal and a full chord on piano and strings.
  function hit(t, chord, v = 1) {
    const o = osc('sine', 66, t, 2.4); o.frequency.exponentialRampToValueAtTime(36, t + 1.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8 * v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    o.connect(g).connect(drums);
    const n = noiseSrc(t, 0.8), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1600, t); lp.frequency.exponentialRampToValueAtTime(150, t + 0.6);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.35 * v, t); ng.gain.setTargetAtTime(0, t + 0.01, 0.2);
    n.connect(lp).connect(ng).connect(drums); send(ng, verbIn, 0.7);
    kick(t, 1);
    crash(t, 0.9 * v);
    if (chord) {
      const notes = CHORDS[chord];
      chordOnPiano(t, [ROOT[chord] + 12, ...notes, notes[2] + 12], 0.95 * v, 2.2, 0.006);
      strings(t, [ROOT[chord] + 12, ...notes], BAR - 0.2, 1.5 * v, 3200, 0.04);
    }
  }

  // ---------- parts ----------
  const chordAt = (list, start, t) => list[Math.floor((t - start) / BAR) % list.length];
  function melody(start, phrase, v = 0.8, octave = 0, double = true) {
    phrase.forEach((bar, b) => bar.forEach(([beat, n, len], i) => {
      const t = start + b * BAR + beat * BEAT;
      piano(t, n + octave, v * (i === 0 ? 1.05 : 0.95), len * BEAT + 0.3, 0.05);
      if (double) pluck(t, n + octave + 12, v * 0.55, 0.25, 0.35);
    }));
  }
  function arpeggio(t, c, v = 0.55, pattern = [0, 2, 1, 3, 2, 1, 3, 2]) {
    const notes = CHORDS[c];
    pattern.forEach((k, i) => pluck(t + i * BEAT / 2 + (i % 2 ? 0.02 : 0), notes[k] + 12, v * (i % 4 === 0 ? 1.1 : 0.85), i % 2 ? 0.35 : -0.3, 0.2));
  }
  function band(from, to, list, start, { beat = 'drop', drumV = 1, lead = null, strengthen = 1, fills = true } = {}) {
    for (let t = from; t < to - 0.01; t += BAR) {
      const c = chordAt(list, start, t), notes = CHORDS[c];
      strings(t, [ROOT[c] + 12, ...notes], BAR, 0.9 * strengthen, 2400 + 600 * strengthen, 0.35);
      chordOnPiano(t, notes, 0.42, 1.2); chordOnPiano(t + BEAT * 1.5, notes.slice(1), 0.34, 0.9);
      arpeggio(t, c, 0.5 * strengthen);
      for (const [b, len, oct] of [[0, 1.2, 0], [1.5, 0.45, 12], [2, 0.9, 0], [3.5, 0.45, 0]]) bass(t + b * BEAT, ROOT[c] + oct, len * BEAT, 0.85);
    }
    if (beat) groove(from, to, beat, drumV, { skipLastBeat: fills });
    if (beat && fills) {
      // A short fill at the end of every four bars, and before the section ends.
      for (let t = from + BAR * 4; t < to - 0.01; t += BAR * 4) fill(t, 0.5, 0.6 * drumV);
      fill(to, 1, 0.85 * drumV);
    }
    if (lead) lead();
  }

  // ---------- the score ----------
  // Hero: solo piano and strings; the hook enters, with a beat, as the mark lands.
  for (let t = 0; t < S.cloud; t += BAR) {
    const c = HERO[Math.floor(t / BAR)], notes = CHORDS[c];
    strings(t, [ROOT[c] + 12, ...notes], BAR, t < S.hit ? 1.0 : 0.9, t < S.hit ? 1700 : 2200, t < 1 ? 1.2 : 0.4);
    if (t < S.hit) {
      piano(t, ROOT[c] + 12, 0.72, 2.2);
      [1, 2, 3, 2].forEach((k, i) => piano(t + BEAT * (i + 0.5) + 0.25, notes[k] + 12, 0.52, 1.4));
    }
  }
  hat(S.hit - BAR, 0.25); hat(S.hit - BEAT * 3, 0.3); hat(S.hit - BEAT * 2, 0.35); hat(S.hit - BEAT, 0.4);
  cymbalSwell(S.hit, 1.8, 1);
  swell(S.hit, CHORDS.G, 2.0, 0.8);
  fill(S.hit, 1, 0.7);
  hit(S.hit, 'F', 0.85);
  for (let t = S.hit; t < S.heroBuild; t += BAR) {
    const c = HERO[Math.floor(t / BAR)], notes = CHORDS[c];
    bass(t, ROOT[c], BEAT * 1.5, 0.75); bass(t + BEAT * 1.75, ROOT[c], BEAT * 0.5, 0.5); bass(t + BEAT * 2, ROOT[c] + 7, BEAT * 1.5, 0.6);
    if (t > S.hit) chordOnPiano(t, notes, 0.4, 1.6);
  }
  groove(S.hit, S.heroBuild, 'hero', 0.95);
  melody(S.hit, HOOK_A.slice(0, 2), 0.78, 0, false);
  for (let k = 0; k < 4; k++) arpeggio(S.hit + k * BEAT * 4, HERO[2 + Math.floor(k / 2)], 0.4, k % 2 ? [3, 2, 1, 2] : [0, 2, 1, 3]);
  // Build into the dive: four-on-the-floor tightening into a roll.
  for (let t = S.heroBuild; t < S.cloud - 0.01; t += BEAT) { kick(t, 0.6 + 0.3 * ((t - S.heroBuild) / 2)); hat(t + BEAT / 2, 0.5, true); }
  timpaniRoll(S.heroBuild, S.cloud, 31);
  swell(S.cloud, [55, 59, 62, 67, 71], BAR, 1.1);
  snareRoll(S.heroBuild + BEAT * 2, S.cloud, 0.7);
  cymbalSwell(S.cloud, 1.2, 0.8);

  // NEAR AI Cloud: the band in half time.
  crash(S.cloud, 0.8);
  band(S.cloud, S.problem, CLOUD, S.cloud, { beat: 'half', drumV: 0.9, strengthen: 0.85 });

  // The gap: minor, a piano ostinato, strings, a nervous rimshot; a heartbeat, then the build.
  for (let t = S.problem; t < S.slam1; t += BAR) {
    const c = chordAt(PROBLEM, S.problem, t), notes = CHORDS[c];
    strings(t, [ROOT[c] + 12, ...notes], BAR, 0.8 + 0.4 * ((t - S.problem) / 8), 1600 + ((t - S.problem) / 8) * 1400, 0.3);
    for (let k = 0; k < 8; k++) piano(t + k * BEAT / 2, (k % 2 ? notes[0] : ROOT[c] + 12), k % 4 === 0 ? 0.5 : 0.36, 0.45, -0.1);
    piano(t, notes[3] + 12, 0.42, 1.8, 0.2);
    bass(t, ROOT[c], BAR * 0.95, 0.55);
  }
  groove(S.problem, S.heart, 'tense', 1);
  groove(S.heart, S.build, 'heart', 1);
  for (let t = S.build; t < S.slam1 - 0.01; t += BEAT / 2) { kick(t, 0.45 + 0.45 * ((t - S.build) / 2)); hat(t, 0.4 + 0.3 * ((t - S.build) / 2)); }
  timpaniRoll(S.build, S.slam1, 33);
  snareRoll(S.build + BEAT * 2, S.slam1, 0.8);
  swell(S.slam1, [48, 52, 55, 60, 64], BAR, 1.3);
  cymbalSwell(S.slam1, 1.6, 1);

  // The turn: two hits, opening to major, toms between them.
  hit(S.slam1, 'C', 1);
  for (const [b, n] of [[1, 67], [2, 72], [3, 76]]) piano(S.slam1 + b * BEAT, n, 0.5, 1.5);
  [[1.5, 0.5], [2.5, 0.5], [3, 0.6], [3.5, 0.7]].forEach(([b, k]) => kick(S.slam1 + b * BEAT, k));
  cymbalSwell(S.slam2, 1.2, 0.9);
  hit(S.slam2, 'G', 0.95);
  for (const [b, n] of [[1, 71], [2, 74], [3, 79]]) piano(S.slam2 + b * BEAT, n, 0.5, 1.2);
  fill(S.drop, 2, 0.9);
  swell(S.drop, CHORDS.F, BAR / 2, 1);

  // Chapter one: the full band with the beat, and the hook.
  crash(S.drop, 1);
  band(S.drop, S.breakFrom, GROOVE, S.drop, {
    lead: () => { melody(S.drop, HOOK_A); melody(S.drop + BAR * 4, HOOK_B); piano(S.drop + BAR * 8, 72, 0.7, 2); },
  });
  crash(36, 0.6); crash(42, 0.5);

  // Breakdown: the band drops away to piano and a filtered kick, then chapter two.
  chordOnPiano(S.breakFrom, CHORDS.F, 0.55, 2, 0.05);
  [[0.5, 72], [1, 74], [1.5, 76], [2.5, 79], [3, 77]].forEach(([b, n]) => piano(S.breakFrom + b * BEAT, n, 0.5, 0.8));
  strings(S.breakFrom, [41 + 12, ...CHORDS.F], BAR, 0.8, 1600, 0.3);
  for (let k = 0; k < 4; k++) kick(S.breakFrom + k * BEAT, 0.45);
  for (let k = 0; k < 8; k++) hat(S.breakFrom + k * BEAT / 2 + BEAT / 4, 0.3 + 0.05 * k);
  swell(S.drop2, [53, 57, 60, 65, 69], BAR, 1.2);
  timpaniRoll(S.breakFrom + BAR / 2, S.drop2, 29);
  snareRoll(S.breakFrom + BAR / 2, S.drop2, 0.75);
  cymbalSwell(S.drop2, 1.4, 0.9);
  crash(S.drop2, 1);
  band(S.drop2, S.proof, GROOVE, S.drop2, {
    strengthen: 1.15, drumV: 1.05,
    lead: () => {
      melody(S.drop2, HOOK_A, 0.85); melody(S.drop2 + BAR * 4, HOOK_B, 0.85); piano(S.drop2 + BAR * 8, 76, 0.75, 2);
      for (let k = 0; k < 4; k++) strings(S.drop2 + BAR * 4 + k * BAR, [[81], [79], [79], [76]][k], BAR, 1.1, 4200, 0.25);
    },
  });
  crash(56, 0.6); crash(62, 0.5);

  // Proof: three hits with kicks between them, then the last build.
  [['Am', 69], ['F', 72], ['G', 74]].forEach(([c, n], i) => {
    const t = S.proof + i * BAR;
    hit(t, c, i === 2 ? 1 : 0.88);
    piano(t + BEAT * 2, n, 0.6, 1.4); piano(t + BEAT * 3, n + 3 - (i === 1 ? 1 : 0), 0.5, 1);
    if (i < 2) { kick(t + BEAT * 2, 0.6); kick(t + BEAT * 3.5, 0.5); hat(t + BEAT * 2.5, 0.4); hat(t + BEAT * 3, 0.4); }
  });
  timpaniRoll(S.proof + BAR * 2, S.finale, 31);
  snareRoll(S.proof + BAR * 2 + BEAT * 2, S.finale - BEAT, 0.8);
  fill(S.finale, 1, 0.95);
  swell(S.finale, [53, 57, 60, 64, 69], BAR, 1.3);
  cymbalSwell(S.finale, 1.6, 1);

  // Finale: the full band and the hook once more, landing on the end card.
  crash(S.finale, 1);
  band(S.finale, S.end, GROOVE, S.finale, { strengthen: 1.2, drumV: 1.1, lead: () => melody(S.finale, HOOK_A.slice(0, 3), 0.9) });
  hit(S.end, null, 0.9);
  chordOnPiano(S.end, [41, 53, 57, 64, 67, 72], 0.75, 5.5, 0.03);
  piano(S.end, 76, 0.8, 5.5, 0.1);
  strings(S.end, [41, 53, 57, 64, 67, 76], duration - S.end, 1.3, 2800, 0.6);
  bass(S.end, 29, 4, 0.7);
  [[2, 79], [2.5, 81], [3, 84], [4, 88]].forEach(([b, n]) => pluck(S.end + b * BEAT, n, 0.4, 0.3, 0.4));

  // ---------- sound effects from the picture ----------
  for (const e of sfx) {
    const t = e.t;
    if (t < 0 || t > duration) continue;
    if (e.type === 'whoosh') {
      const n = noiseSrc(t - 0.32, 0.7), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(400, t - 0.32); bp.frequency.exponentialRampToValueAtTime(2200, t); bp.frequency.exponentialRampToValueAtTime(500, t + 0.32);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t - 0.32); g.gain.exponentialRampToValueAtTime(0.16, t - 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      const p = ctx.createStereoPanner(); p.pan.setValueAtTime(0.6, t - 0.32); p.pan.linearRampToValueAtTime(-0.6, t + 0.32);
      n.connect(bp).connect(g).connect(p).connect(fx); send(g, verbIn, 0.2);
    } else if (e.type === 'tick') {
      const n = noiseSrc(t, 0.02), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000 + R() * 1500; bp.Q.value = 1.5;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * (0.7 + R() * 0.3), t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      n.connect(bp).connect(g).connect(fx);
    } else if (e.type === 'pop') {
      pluck(t, 84 + Math.floor(R() * 3) * 2, 0.35 * (e.v ?? 1), (R() - 0.5) * 0.6, 0.1);
    } else if (e.type === 'stamp') {
      tom(t, 38, 0.55 * (e.v ?? 1));
      const n = noiseSrc(t, 0.05), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 1;
      const g = ctx.createGain(); env(g, t, 0.14 * (e.v ?? 1), 0.04); n.connect(bp).connect(g).connect(fx);
    } else if (e.type === 'chime') {
      piano(t, 88, 0.45, 1.2, 0.3); piano(t + 0.09, 95, 0.4, 1.2, 0.35);
    } else if (e.type === 'shimmer') {
      [79, 84, 88, 91, 96].forEach((n, k) => pluck(t + k * 0.055, n, 0.35, -0.4 + k * 0.2, 0.3));
    }
  }

  return ctx.startRendering();
}

// 16-bit PCM WAV bytes from an AudioBuffer.
export function wavBytes(buffer) {
  const ch = buffer.numberOfChannels, len = buffer.length, rate = buffer.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(out.buffer);
}
