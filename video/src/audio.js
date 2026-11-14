// The soundtrack: an original score and its sound effects, synthesised with the Web Audio API
// in an OfflineAudioContext. Everything is seeded, so every render is identical.
// Music time runs at 120 BPM: a beat is 0.5 s and a bar is 2 s.

const BEAT = 0.5;
const BAR = 2;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Chords as MIDI notes. Minor and tense for the problem, major and open once the yield pays.
const CHORDS = {
  Am: [57, 60, 64, 71], F: [53, 57, 60, 64], Dm: [50, 57, 60, 65], E: [52, 56, 59, 64],
  C: [48, 55, 60, 64], G: [55, 59, 62, 69], Fmaj9: [53, 57, 64, 67],
};
const PROBLEM = ['Am', 'F', 'Dm', 'E'];
const GROOVE = ['F', 'C', 'G', 'Am'];
const ROOT = { Am: 45, F: 41, Dm: 38, E: 40, C: 36, G: 43, Fmaj9: 41 };

// Sections, in music seconds (each on a bar line).
const S = {
  hit: 4, heroBuild: 8, cloud: 10, problem: 16, build: 22, slam1: 24, slam2: 26, drop: 28,
  breakFrom: 46, drop2: 48, proof: 66, finale: 72, end: 78,
};
const HERO = ['F', 'Am', 'C', 'G'];
const CLOUD = ['C', 'G', 'Am'];

export async function renderSoundtrack(duration, sfx, sampleRate = 48000) {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const R = rng(20261114);

  const noise = ctx.createBuffer(2, sampleRate * 3, sampleRate);
  for (let c = 0; c < 2; c++) { const d = noise.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1; }

  // ---------- buses ----------
  const master = ctx.createGain(); master.gain.value = 0.8;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18; glue.ratio.value = 2.5; glue.knee.value = 10; glue.attack.value = 0.015; glue.release.value = 0.25;
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -4; limit.ratio.value = 20; limit.knee.value = 0; limit.attack.value = 0.002; limit.release.value = 0.08;
  // A low cut keeps the sub from piling up under the kick and bass.
  const lowCut = ctx.createBiquadFilter(); lowCut.type = 'highpass'; lowCut.frequency.value = 32; lowCut.Q.value = 0.7;
  master.connect(lowCut).connect(glue).connect(limit).connect(ctx.destination);
  master.gain.setValueAtTime(0.8, 0);
  master.gain.setValueAtTime(0.8, duration - 2.6);
  master.gain.linearRampToValueAtTime(0, duration - 0.05);

  // Music runs through a sidechain duck (pumped by the kick) and a low-pass that the breakdowns sweep.
  const music = ctx.createGain();
  const duck = ctx.createGain();
  const sweep = ctx.createBiquadFilter(); sweep.type = 'lowpass'; sweep.frequency.value = 18000; sweep.Q.value = 0.8;
  music.connect(duck).connect(sweep).connect(master);
  const drums = ctx.createGain(); drums.gain.value = 0.9; drums.connect(master);
  const fx = ctx.createGain(); fx.gain.value = 0.85; fx.connect(master);

  // Reverb: a generated stereo impulse response.
  const verb = ctx.createConvolver();
  const irLen = Math.floor(sampleRate * 3.4), ir = ctx.createBuffer(2, irLen, sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < irLen; i++) { const x = i / irLen; d[i] = (R() * 2 - 1) * Math.pow(1 - x, 3.2) * (i < 200 ? i / 200 : 1); }
  }
  verb.buffer = ir;
  const verbIn = ctx.createGain(); const verbOut = ctx.createGain(); verbOut.gain.value = 0.42;
  const verbLP = ctx.createBiquadFilter(); verbLP.type = 'lowpass'; verbLP.frequency.value = 6500;
  verbIn.connect(verbLP).connect(verb).connect(verbOut).connect(master);

  // Ping-pong delay at a dotted eighth.
  const dIn = ctx.createGain();
  const dl = ctx.createDelay(1), dr = ctx.createDelay(1); dl.delayTime.value = dr.delayTime.value = 0.375;
  const fb = ctx.createGain(); fb.gain.value = 0.38;
  const dTone = ctx.createBiquadFilter(); dTone.type = 'lowpass'; dTone.frequency.value = 3200;
  const merge = ctx.createChannelMerger(2); const dOut = ctx.createGain(); dOut.gain.value = 0.34;
  dIn.connect(dl); dl.connect(dr); dr.connect(dTone).connect(fb).connect(dl);
  dl.connect(merge, 0, 0); dr.connect(merge, 0, 1); merge.connect(dOut).connect(sweep);
  dOut.connect(verbIn);

  // ---------- small helpers ----------
  const env = (g, t, a, peak, d, sustain = 0, r = 0.05, hold = 0) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(sustain, t + a + hold, d / 4);
    if (r) { g.gain.setTargetAtTime(0, t + a + hold + d, r / 4); }
  };
  const noiseSrc = (t, dur) => {
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    s.start(t, R() * 2, dur + 0.05); return s;
  };
  const osc = (type, f, t, dur, detune = 0) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    o.start(t); o.stop(t + dur + 0.05); return o;
  };
  const pan = (v) => { const p = ctx.createStereoPanner(); p.pan.value = v; return p; };
  const send = (node, bus, amount) => { const g = ctx.createGain(); g.gain.value = amount; node.connect(g).connect(bus); };

  // ---------- instruments ----------
  function kick(t, v = 1) {
    const o = osc('sine', 165, t, 0.6);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.0 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g).connect(drums);
    const n = noiseSrc(t, 0.02), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = ctx.createGain(); env(ng, t, 0.001, 0.22 * v, 0.012, 0, 0);
    n.connect(hp).connect(ng).connect(drums);
    // pump the music bus
    duck.gain.setValueAtTime(1, t - 0.002);
    duck.gain.linearRampToValueAtTime(0.42, t + 0.012);
    duck.gain.setTargetAtTime(1, t + 0.04, 0.09);
  }
  function clap(t, v = 1) {
    const n = noiseSrc(t, 0.35);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1350; bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (const k of [0, 0.011, 0.022]) { g.gain.linearRampToValueAtTime(0.55 * v, t + k + 0.001); g.gain.linearRampToValueAtTime(0.12 * v, t + k + 0.009); }
    g.gain.setTargetAtTime(0, t + 0.03, 0.05);
    n.connect(bp).connect(g).connect(drums); send(g, verbIn, 0.22);
    const body = osc('triangle', 185, t, 0.15), bg = ctx.createGain(); env(bg, t, 0.002, 0.18 * v, 0.08, 0, 0);
    body.connect(bg).connect(drums);
  }
  function hat(t, v = 1, open = false) {
    const n = noiseSrc(t, open ? 0.3 : 0.06);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = open ? 6500 : 8000;
    const g = ctx.createGain(); env(g, t, 0.001, (open ? 0.12 : 0.1) * v, open ? 0.2 : 0.035, 0, 0);
    const p = pan(open ? 0.15 : -0.18);
    n.connect(hp).connect(g).connect(p).connect(drums);
  }
  function crash(t, v = 1) {
    const n = noiseSrc(t, 2.6);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.2 * v, t); g.gain.setTargetAtTime(0, t + 0.02, 0.55);
    n.connect(hp).connect(g).connect(drums); send(g, verbIn, 0.35);
  }
  function impact(t, v = 1) {
    const o = osc('sine', 78, t, 2.4); o.frequency.exponentialRampToValueAtTime(30, t + 1.6);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.95 * v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 2.3);
    o.connect(g).connect(drums);
    const n = noiseSrc(t, 1.2), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2200, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.8);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.5 * v, t); ng.gain.setTargetAtTime(0, t + 0.01, 0.25);
    n.connect(lp).connect(ng).connect(drums); send(ng, verbIn, 0.8);
    crash(t, 0.8 * v);
  }
  function reverseSwell(end, dur = 1.6, v = 1) {
    const t = end - dur, n = noiseSrc(t, dur);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(1200, t); hp.frequency.exponentialRampToValueAtTime(5000, end);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22 * v, end - 0.01); g.gain.linearRampToValueAtTime(0, end);
    n.connect(hp).connect(g).connect(fx); send(g, verbIn, 0.4);
  }
  function riser(t, dur, v = 1) {
    const n = noiseSrc(t, dur), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(260, t); bp.frequency.exponentialRampToValueAtTime(7500, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3 * v, t + dur - 0.02); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp).connect(g).connect(fx); send(g, verbIn, 0.3);
    const o = osc('sawtooth', 110, t, dur); o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(5000, t + dur);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.05 * v, t + dur - 0.02); og.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(og).connect(fx);
  }
  function snareRoll(from, to) {
    let t = from;
    while (t < to - 0.01) {
      const p = (t - from) / (to - from);
      clap(t, 0.25 + 0.6 * p);
      t += p < 0.5 ? BEAT / 2 : p < 0.8 ? BEAT / 4 : BEAT / 8;
    }
  }
  function pad(t, notes, dur, bright = 1200, v = 1) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(bright * 0.6, t); lp.frequency.linearRampToValueAtTime(bright, t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.055 * v, t + 0.5);
    g.gain.setValueAtTime(0.055 * v, t + dur - 0.1); g.gain.setTargetAtTime(0, t + dur - 0.1, 0.45);
    lp.connect(g).connect(music); send(g, verbIn, 0.55);
    for (const n of notes) for (const d of [-9, 0, 9]) {
      const o = osc(d === 0 ? 'triangle' : 'sawtooth', mtof(n), t, dur + 2, d);
      const og = ctx.createGain(); og.gain.value = d === 0 ? 0.9 : 0.35;
      o.connect(og).connect(lp);
    }
  }
  function keys(t, note, v = 1, dur = 2.6) {
    const f = mtof(note), out = ctx.createGain(); out.gain.value = 0.11 * v;
    out.connect(music); send(out, verbIn, 0.5); send(out, dIn, 0.18);
    for (const [k, a] of [[1, 1], [2, 0.32], [3, 0.12], [4.02, 0.05]]) {
      const o = osc('sine', f * k, t, dur), g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.006); g.gain.setTargetAtTime(0, t + 0.01, dur / (3 + k));
      o.connect(g).connect(out);
    }
  }
  function pluck(t, note, v = 1, p = 0) {
    const f = mtof(note), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(4200, t); lp.frequency.setTargetAtTime(500, t + 0.005, 0.06);
    const g = ctx.createGain(); env(g, t, 0.003, 0.08 * v, 0.22, 0, 0);
    const pn = pan(p);
    lp.connect(g).connect(pn).connect(music); send(pn, dIn, 0.4); send(pn, verbIn, 0.25);
    osc('sawtooth', f, t, 0.4, -5).connect(lp); osc('square', f, t, 0.4, 5).connect(lp);
  }
  function bass(t, note, dur, v = 1, cutoff = 700) {
    const f = mtof(note), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.5;
    lp.frequency.setValueAtTime(cutoff * 1.6, t); lp.frequency.setTargetAtTime(cutoff * 0.55, t + 0.005, 0.07);
    const g = ctx.createGain(); env(g, t, 0.004, 0.2 * v, dur * 0.7, 0.12 * v, 0.06, 0);
    g.gain.setTargetAtTime(0, t + dur, 0.02);
    lp.connect(g).connect(music);
    osc('sawtooth', f, t, dur + 0.1).connect(lp);
    const sub = osc('sine', f / 2, t, dur + 0.1), sg = ctx.createGain(); sg.gain.value = 0.45; sub.connect(sg).connect(g);
  }
  function bell(t, note, v = 1) {
    const f = mtof(note), out = ctx.createGain(); out.gain.value = 0.07 * v; out.connect(music); send(out, verbIn, 0.6); send(out, dIn, 0.3);
    for (const [k, a, d] of [[1, 1, 1.6], [2.76, 0.4, 0.7], [5.4, 0.18, 0.35]]) {
      const o = osc('sine', f * k, t, d * 2), g = ctx.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.003); g.gain.setTargetAtTime(0, t + 0.004, d / 3);
      o.connect(g).connect(out);
    }
  }

  // ---------- the score ----------
  const chordAt = (list, start, t) => list[Math.floor((t - start) / BAR) % list.length];

  function groove(from, to, { lift = false, start = from, list = GROOVE, kick: kv = 1, arp = true, bassV = 0.9 } = {}) {
    for (let t = from; t < to - 0.01; t += BAR) {
      const c = chordAt(list, start, t), notes = CHORDS[c];
      pad(t, notes, BAR, lift ? 2600 : 2000, 0.9);
      for (let b = 0; b < 4; b++) {
        const tb = t + b * BEAT;
        if (kv) kick(tb, kv);
        if (kv && b % 2 === 1) clap(tb, 0.85 * kv);
        hat(tb + BEAT / 2, 0.75, true);
        for (let q = 0; q < 4; q++) if (q !== 2) hat(tb + q * BEAT / 4, q === 0 ? 0.35 : 0.5);
        bass(tb, ROOT[c], BEAT / 2 * 0.85, bassV);
        bass(tb + BEAT / 2, ROOT[c] + 12, BEAT / 2 * 0.8, bassV * 0.83);
      }
      if (arp) {
        const seq = [notes[0] + 12, notes[1] + 12, notes[2] + 12, notes[3] + 12, notes[2] + 24, notes[3] + 12, notes[1] + 12, notes[2] + 12];
        for (let k = 0; k < 16; k++) pluck(t + k * BEAT / 4, seq[k % 8] + (lift && k % 4 === 3 ? 12 : 0), k % 4 === 0 ? 1 : 0.7, k % 2 ? 0.3 : -0.3);
      }
    }
  }
  const motif = [[0, 76], [1.5, 74], [3, 72], [4, 67], [6, 69], [7, 72]];

  // Hero: a dark pad, felt keys, a swell into the mark landing.
  for (let t = 0; t < S.hit; t += BAR) {
    const notes = CHORDS[chordAt(HERO, 0, t)];
    pad(t, notes, BAR, 650, 0.85);
    keys(t + BEAT, notes[2] + 12, 0.7); keys(t + BEAT * 3, notes[3] + 12, 0.5);
  }
  riser(1.2, S.hit - 1.2, 0.6);
  reverseSwell(S.hit, 1.8, 1);
  impact(S.hit, 1);
  // Hero, after the hit: a light pulse under the wordmark.
  for (let t = S.hit; t < S.heroBuild; t += BAR) {
    const c = chordAt(HERO, 0, t), notes = CHORDS[c];
    pad(t, notes, BAR, 1400, 0.95);
    kick(t, 0.8); kick(t + BEAT * 2, 0.7);
    for (let k = 0; k < 8; k++) { hat(t + k * BEAT / 2 + BEAT / 4, 0.4); bass(t + k * BEAT / 2, ROOT[c] + 12, BEAT / 2 * 0.8, 0.5, 450); }
    for (let k = 0; k < 8; k++) pluck(t + k * BEAT / 2, [notes[0] + 12, notes[2] + 12, notes[3] + 12, notes[1] + 24][k % 4], 0.6, k % 2 ? 0.35 : -0.35);
  }
  // Build into the dive.
  pad(S.heroBuild, CHORDS.G, BAR, 1800, 1);
  for (let t = S.heroBuild; t < S.cloud; t += BEAT) kick(t, 0.6 + 0.3 * ((t - S.heroBuild) / 2));
  riser(S.heroBuild, S.cloud - S.heroBuild, 1);
  snareRoll(S.heroBuild + BAR / 2, S.cloud);

  // NEAR AI Cloud: a medium groove, no claps yet.
  crash(S.cloud, 1);
  groove(S.cloud, S.problem, { list: CLOUD, kick: 0.7, bassV: 0.7 });

  // The gap: minor, a clock of hats, then a heartbeat and the build.
  for (let t = S.problem; t < S.slam1; t += BAR) {
    const c = chordAt(PROBLEM, S.problem, t), notes = CHORDS[c];
    pad(t, notes, BAR, 900 + ((t - S.problem) / 8) * 800, 1);
    keys(t, notes[1] + 12, 0.8); keys(t + BEAT * 1.5, notes[2] + 12, 0.55); keys(t + BEAT * 3, notes[3] + 12, 0.45);
    for (let k = 0; k < 8; k++) bass(t + k * BEAT / 2, ROOT[c] + 12, BEAT / 2 * 0.8, 0.55, 380);
    for (let k = 0; k < 16; k++) hat(t + k * BEAT / 4, k % 4 === 2 ? 0.55 : 0.28);
    if (t >= 20 && t < S.build) { kick(t, 0.75); kick(t + BEAT * 2, 0.6); }
  }
  for (let t = S.build; t < S.slam1; t += BEAT / 2) kick(t, 0.5 + 0.4 * ((t - S.build) / 2));
  riser(S.build, S.slam1 - S.build, 1);
  snareRoll(S.build + BAR / 2, S.slam1);

  // The turn: two impacts, the music opening to major.
  impact(S.slam1, 1);
  pad(S.slam1, CHORDS.C, BAR, 1600, 1.1); keys(S.slam1, 72, 1); keys(S.slam1, 76, 0.7);
  reverseSwell(S.slam2, 1.4, 1);
  impact(S.slam2, 0.9);
  pad(S.slam2, CHORDS.G, BAR, 1800, 1.1); keys(S.slam2, 71, 1); keys(S.slam2, 74, 0.7);
  riser(S.slam2 + BEAT * 2, BEAT * 2, 0.7);

  // Chapter one: the drop.
  crash(S.drop, 1);
  groove(S.drop, S.breakFrom, { start: S.drop });
  crash(36, 0.8); crash(42, 0.7);

  // Breakdown, then chapter two.
  for (let t = S.breakFrom; t < S.drop2; t += BEAT / 4) hat(t, 0.4);
  pad(S.breakFrom, CHORDS.F, BAR, 1400, 1);
  sweep.frequency.setValueAtTime(18000, S.breakFrom - 0.01);
  sweep.frequency.exponentialRampToValueAtTime(700, S.breakFrom + 1.0);
  sweep.frequency.exponentialRampToValueAtTime(18000, S.drop2 - 0.02);
  for (let k = 0; k < 8; k++) pluck(S.breakFrom + k * BEAT / 2, [65, 69, 72, 76][k % 4], 0.8, k % 2 ? 0.3 : -0.3);
  riser(S.breakFrom + BAR / 2, BAR * 0.75, 0.8);
  crash(S.drop2, 1);
  groove(S.drop2, S.proof, { lift: true, start: S.drop2 });
  for (let t = S.drop2 + BAR * 2; t < S.proof - BAR; t += BAR * 4) for (const [b, n] of motif) bell(t + b * BEAT, n, 0.9);
  crash(56, 0.8); crash(62, 0.7);

  // Proof: three hits, drums out, then the build to the finale.
  [['Am', 69], ['F', 72], ['G', 74]].forEach(([c, n], i) => {
    const t = S.proof + i * BAR;
    impact(t, i === 2 ? 1 : 0.85);
    pad(t, CHORDS[c], BAR, 1500 + i * 300, 1.1);
    keys(t, n, 1); keys(t + BEAT, n + 3, 0.6);
  });
  riser(S.proof + BAR * 2, BAR, 1);
  snareRoll(S.proof + BAR * 2 + BEAT * 2, S.finale);

  // Finale, then the end card.
  crash(S.finale, 1);
  groove(S.finale, S.end, { lift: true, start: S.finale });
  for (const [b, n] of motif) bell(S.finale + b * BEAT, n + 12, 0.7);
  impact(S.end, 1);
  pad(S.end, CHORDS.Fmaj9, duration - S.end, 2200, 1.2);
  for (const [b, n] of [[0, 65], [0.5, 69], [1, 72], [1.5, 76], [2, 79]]) keys(S.end + b * BEAT, n, 0.9, 4);
  bass(S.end, 41, 3, 0.8, 500);

  // ---------- sound effects from the picture ----------
  for (const e of sfx) {
    const t = e.t;
    if (t < 0 || t > duration) continue;
    if (e.type === 'whoosh') {
      const n = noiseSrc(t - 0.32, 0.7), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(500, t - 0.32); bp.frequency.exponentialRampToValueAtTime(3200, t); bp.frequency.exponentialRampToValueAtTime(700, t + 0.32);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t - 0.32); g.gain.exponentialRampToValueAtTime(0.32, t - 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      const p = ctx.createStereoPanner(); p.pan.setValueAtTime(0.7, t - 0.32); p.pan.linearRampToValueAtTime(-0.7, t + 0.32);
      n.connect(bp).connect(g).connect(p).connect(fx); send(g, verbIn, 0.15);
    } else if (e.type === 'click') {
      const o = osc('square', 2300, t, 0.03), g = ctx.createGain(); env(g, t, 0.001, 0.07, 0.012, 0, 0);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
      o.connect(lp).connect(g).connect(fx);
      const n = noiseSrc(t, 0.02), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
      const ng = ctx.createGain(); env(ng, t, 0.001, 0.12, 0.008, 0, 0); n.connect(hp).connect(ng).connect(fx);
    } else if (e.type === 'tick') {
      const n = noiseSrc(t, 0.02), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500 + R() * 1500; bp.Q.value = 2;
      const g = ctx.createGain(); env(g, t, 0.001, 0.09 * (0.7 + R() * 0.3), 0.01, 0, 0); n.connect(bp).connect(g).connect(fx);
    } else if (e.type === 'pop') {
      const o = osc('sine', 540, t, 0.16); o.frequency.exponentialRampToValueAtTime(920, t + 0.06);
      const g = ctx.createGain(); env(g, t, 0.003, 0.12 * (e.v ?? 1), 0.07, 0, 0); o.connect(g).connect(fx); send(g, verbIn, 0.15);
    } else if (e.type === 'stamp') {
      const o = osc('sine', 150, t, 0.3); o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * (e.v ?? 1), t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(g).connect(fx);
      const n = noiseSrc(t, 0.05), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.2;
      const ng = ctx.createGain(); env(ng, t, 0.001, 0.25 * (e.v ?? 1), 0.03, 0, 0); n.connect(bp).connect(ng).connect(fx); send(ng, verbIn, 0.2);
    } else if (e.type === 'chime') {
      bell(t, 88, 1.1); bell(t + 0.08, 95, 0.8);
    } else if (e.type === 'shimmer') {
      for (let k = 0; k < 6; k++) bell(t + k * 0.06, [84, 88, 91, 95, 96, 100][k], 0.5);
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
